#!/usr/bin/env node

import { createWriteStream, createReadStream } from 'node:fs';
import { mkdir, rm, writeFile, rename, readFile } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import unzipper from 'unzipper';
import { parse } from 'csv-parse';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', 'data', 'gtfs');
export const GTFS_URL = 'https://www3.septa.org/developer/google_bus.zip';

const DOWNLOAD_TIMEOUT_MS = 5 * 60 * 1000;

/**
 * Parse a GTFS time string (HH:MM:SS) to seconds since the service day start.
 * GTFS times can exceed 24:00:00 for trips spanning midnight.
 */
export function parseGtfsTime(timeStr) {
  if (!timeStr) return null;
  const parts = timeStr.split(':');
  if (parts.length !== 3) return null;
  const [hours, minutes, seconds] = parts.map(Number);
  if (isNaN(hours) || isNaN(minutes) || isNaN(seconds)) return null;
  return hours * 3600 + minutes * 60 + seconds;
}

async function downloadAndExtract(rawDir) {
  console.log('Downloading GTFS data from SEPTA...');

  const response = await fetch(GTFS_URL, { signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) });
  if (!response.ok) {
    throw new Error(`Failed to download: ${response.status} ${response.statusText}`);
  }

  await rm(rawDir, { recursive: true, force: true });
  await mkdir(rawDir, { recursive: true });

  const zipPath = path.join(rawDir, 'gtfs.zip');
  await pipeline(Readable.fromWeb(response.body), createWriteStream(zipPath));
  console.log('Download complete. Extracting...');

  await createReadStream(zipPath).pipe(unzipper.Extract({ path: rawDir })).promise();
  console.log('Extraction complete.');

  return {
    lastModified: response.headers.get('last-modified'),
    etag: response.headers.get('etag'),
  };
}

/** Stream a GTFS CSV file row by row without holding it all in memory. */
async function eachRow(rawDir, filename, onRow) {
  const parser = createReadStream(path.join(rawDir, filename)).pipe(
    parse({ columns: true, skip_empty_lines: true, trim: true, bom: true })
  );
  for await (const record of parser) {
    onRow(record);
  }
}

// IDs that are plain integers are stored as numbers, which takes far less memory
function compactId(id) {
  return /^[1-9]\d{0,14}$/.test(id) ? Number(id) : id;
}

function round(value, places) {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

async function processTrips(rawDir) {
  console.log('Processing trips.txt...');
  const trips = {};
  await eachRow(rawDir, 'trips.txt', (r) => {
    trips[r.trip_id] = {
      routeId: r.route_id,
      serviceId: r.service_id,
      shapeId: r.shape_id || null,
      blockId: r.block_id || null,
      headsign: r.trip_headsign || null,
    };
  });
  console.log(`  Processed ${Object.keys(trips).length} trips`);
  return trips;
}

async function processRoutes(rawDir) {
  console.log('Processing routes.txt...');
  // routeId -> the name riders know it by
  const routes = {};
  await eachRow(rawDir, 'routes.txt', (r) => {
    routes[r.route_id] = r.route_short_name || r.route_long_name || r.route_id;
  });
  console.log(`  Processed ${Object.keys(routes).length} routes`);
  return routes;
}

async function processStopTimes(rawDir) {
  console.log('Processing stop_times.txt...');

  // tripId -> [stopId, stopSequence, arrivalSeconds, ...] as flat triples.
  // This file has millions of rows, so rows go straight into their final
  // form rather than through an intermediate object per row.
  const stopTimes = {};
  const unsorted = new Set();
  let tripCount = 0;
  await eachRow(rawDir, 'stop_times.txt', (r) => {
    let flat = stopTimes[r.trip_id];
    if (!flat) {
      flat = stopTimes[r.trip_id] = [];
      tripCount++;
    }
    const sequence = parseInt(r.stop_sequence, 10);
    if (flat.length > 0 && sequence < flat[flat.length - 2]) {
      unsorted.add(r.trip_id);
    }
    const arrival = parseGtfsTime(r.arrival_time) ?? parseGtfsTime(r.departure_time);
    flat.push(compactId(r.stop_id), sequence, arrival ?? -1);
  });

  // Rows are normally already in stop order; sort the trips where they weren't
  for (const tripId of unsorted) {
    const flat = stopTimes[tripId];
    const rows = [];
    for (let i = 0; i < flat.length; i += 3) {
      rows.push([flat[i], flat[i + 1], flat[i + 2]]);
    }
    rows.sort((a, b) => a[1] - b[1]);
    stopTimes[tripId] = rows.flat();
  }

  console.log(`  Processed stop times for ${tripCount} trips`);
  return stopTimes;
}

async function processStops(rawDir) {
  console.log('Processing stops.txt...');
  const stops = {};
  await eachRow(rawDir, 'stops.txt', (r) => {
    stops[r.stop_id] = {
      name: r.stop_name,
      lat: parseFloat(r.stop_lat),
      lon: parseFloat(r.stop_lon),
    };
  });
  console.log(`  Processed ${Object.keys(stops).length} stops`);
  return stops;
}

async function processShapes(rawDir) {
  console.log('Processing shapes.txt...');

  const byShape = new Map();
  await eachRow(rawDir, 'shapes.txt', (r) => {
    let points = byShape.get(r.shape_id);
    if (!points) {
      points = [];
      byShape.set(r.shape_id, points);
    }
    points.push([
      parseInt(r.shape_pt_sequence, 10),
      round(parseFloat(r.shape_pt_lat), 6),
      round(parseFloat(r.shape_pt_lon), 6),
    ]);
  });

  // Flatten to [lat, lon, lat, lon, ...] in point order
  const shapes = {};
  for (const [shapeId, points] of byShape) {
    points.sort((a, b) => a[0] - b[0]);
    const flat = [];
    for (const [, lat, lon] of points) {
      flat.push(lat, lon);
    }
    shapes[shapeId] = flat;
  }

  console.log(`  Processed ${byShape.size} shapes`);
  return shapes;
}

async function readFeedVersion(rawDir) {
  let version = null;
  try {
    await eachRow(rawDir, 'feed_info.txt', (r) => {
      version = r.feed_version || version;
    });
  } catch {
    // feed_info.txt is optional
  }
  return version;
}

/**
 * Download SEPTA's schedule and write it to dataDir in the compact JSON form
 * the server loads. Files are written under temporary names and renamed at
 * the end so a failed run never leaves a half-written schedule behind.
 */
export async function downloadGtfs(dataDir = DATA_DIR) {
  const rawDir = path.join(dataDir, 'raw');
  await mkdir(dataDir, { recursive: true });

  try {
    const source = await downloadAndExtract(rawDir);

    const outputs = {
      'routes.json': await processRoutes(rawDir),
      'trips.json': await processTrips(rawDir),
      'stop_times.json': await processStopTimes(rawDir),
      'stops.json': await processStops(rawDir),
      'shapes.json': await processShapes(rawDir),
      'meta.json': {
        ...source,
        feedVersion: await readFeedVersion(rawDir),
        downloadedAt: new Date().toISOString(),
      },
    };

    if (Object.keys(outputs['trips.json']).length === 0 || Object.keys(outputs['stop_times.json']).length === 0) {
      throw new Error('Downloaded schedule has no trips; keeping the existing data');
    }

    console.log('\nWriting JSON files...');
    for (const [name, data] of Object.entries(outputs)) {
      await writeFile(path.join(dataDir, `${name}.tmp`), JSON.stringify(data));
      outputs[name] = null; // let each one be collected as soon as it is written
    }
    for (const name of Object.keys(outputs)) {
      await rename(path.join(dataDir, `${name}.tmp`), path.join(dataDir, name));
    }

    console.log('\nGTFS data processing complete!');
    console.log(`Output directory: ${dataDir}`);
  } finally {
    await rm(rawDir, { recursive: true, force: true });
  }
}

/** What the last successful download recorded about its source file. */
export async function readGtfsMeta(dataDir = DATA_DIR) {
  try {
    return JSON.parse(await readFile(path.join(dataDir, 'meta.json'), 'utf-8'));
  } catch {
    return null;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  downloadGtfs().catch((error) => {
    console.error('Error:', error.message);
    process.exit(1);
  });
}
