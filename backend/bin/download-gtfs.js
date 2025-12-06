#!/usr/bin/env node

import { createWriteStream, createReadStream } from 'node:fs';
import { mkdir, rm, writeFile, readdir } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import unzipper from 'unzipper';
import { parse } from 'csv-parse';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', 'data', 'gtfs');
const TEMP_DIR = path.join(DATA_DIR, 'raw');
const GTFS_URL = 'https://www3.septa.org/developer/google_bus.zip';

/**
 * Parse a GTFS time string (HH:MM:SS) to seconds since midnight.
 * GTFS times can exceed 24:00:00 for trips spanning midnight.
 */
function parseGtfsTime(timeStr) {
  if (!timeStr) return null;
  const parts = timeStr.split(':');
  if (parts.length !== 3) return null;
  const [hours, minutes, seconds] = parts.map(Number);
  if (isNaN(hours) || isNaN(minutes) || isNaN(seconds)) return null;
  return hours * 3600 + minutes * 60 + seconds;
}

async function downloadAndExtract() {
  console.log('Downloading GTFS data from SEPTA...');

  const response = await fetch(GTFS_URL);
  if (!response.ok) {
    throw new Error(`Failed to download: ${response.status} ${response.statusText}`);
  }

  // Clean and recreate temp directory
  await rm(TEMP_DIR, { recursive: true, force: true });
  await mkdir(TEMP_DIR, { recursive: true });

  const zipPath = path.join(TEMP_DIR, 'gtfs.zip');
  const fileStream = createWriteStream(zipPath);

  await pipeline(Readable.fromWeb(response.body), fileStream);
  console.log('Download complete. Extracting...');

  // Extract zip
  await createReadStream(zipPath)
    .pipe(unzipper.Extract({ path: TEMP_DIR }))
    .promise();

  console.log('Extraction complete.');
}

async function parseCSV(filename) {
  const filePath = path.join(TEMP_DIR, filename);
  const records = [];

  const parser = createReadStream(filePath).pipe(
    parse({
      columns: true,
      skip_empty_lines: true,
      trim: true,
    })
  );

  for await (const record of parser) {
    records.push(record);
  }

  return records;
}

async function processTrips() {
  console.log('Processing trips.txt...');
  const records = await parseCSV('trips.txt');

  const trips = {};
  for (const r of records) {
    trips[r.trip_id] = {
      routeId: r.route_id,
      serviceId: r.service_id,
      shapeId: r.shape_id || null,
      directionId: r.direction_id ? parseInt(r.direction_id, 10) : null,
      tripHeadsign: r.trip_headsign || null,
      blockId: r.block_id || null,
    };
  }

  console.log(`  Processed ${Object.keys(trips).length} trips`);
  return trips;
}

async function processStopTimes() {
  console.log('Processing stop_times.txt...');
  const records = await parseCSV('stop_times.txt');

  const stopTimes = {};
  for (const r of records) {
    const tripId = r.trip_id;
    if (!stopTimes[tripId]) {
      stopTimes[tripId] = [];
    }
    stopTimes[tripId].push({
      stopId: r.stop_id,
      stopSequence: parseInt(r.stop_sequence, 10),
      arrivalTime: r.arrival_time,
      departureTime: r.departure_time,
      arrivalSeconds: parseGtfsTime(r.arrival_time),
      departureSeconds: parseGtfsTime(r.departure_time),
    });
  }

  // Sort each trip's stops by sequence
  for (const tripId of Object.keys(stopTimes)) {
    stopTimes[tripId].sort((a, b) => a.stopSequence - b.stopSequence);
  }

  console.log(`  Processed stop times for ${Object.keys(stopTimes).length} trips`);
  return stopTimes;
}

async function processStops() {
  console.log('Processing stops.txt...');
  const records = await parseCSV('stops.txt');

  const stops = {};
  for (const r of records) {
    stops[r.stop_id] = {
      name: r.stop_name,
      lat: parseFloat(r.stop_lat),
      lon: parseFloat(r.stop_lon),
    };
  }

  console.log(`  Processed ${Object.keys(stops).length} stops`);
  return stops;
}

async function processShapes() {
  console.log('Processing shapes.txt...');
  const records = await parseCSV('shapes.txt');

  const shapes = {};
  for (const r of records) {
    const shapeId = r.shape_id;
    if (!shapes[shapeId]) {
      shapes[shapeId] = [];
    }
    shapes[shapeId].push({
      lat: parseFloat(r.shape_pt_lat),
      lon: parseFloat(r.shape_pt_lon),
      sequence: parseInt(r.shape_pt_sequence, 10),
      distTraveled: r.shape_dist_traveled ? parseFloat(r.shape_dist_traveled) : null,
    });
  }

  // Sort each shape's points by sequence
  for (const shapeId of Object.keys(shapes)) {
    shapes[shapeId].sort((a, b) => a.sequence - b.sequence);
  }

  console.log(`  Processed ${Object.keys(shapes).length} shapes`);
  return shapes;
}

async function processCalendar() {
  console.log('Processing calendar.txt...');
  const records = await parseCSV('calendar.txt');

  const calendar = {};
  for (const r of records) {
    calendar[r.service_id] = {
      monday: r.monday === '1',
      tuesday: r.tuesday === '1',
      wednesday: r.wednesday === '1',
      thursday: r.thursday === '1',
      friday: r.friday === '1',
      saturday: r.saturday === '1',
      sunday: r.sunday === '1',
      startDate: r.start_date,
      endDate: r.end_date,
    };
  }

  console.log(`  Processed ${Object.keys(calendar).length} service calendars`);
  return calendar;
}

async function processCalendarDates() {
  console.log('Processing calendar_dates.txt...');

  // Check if file exists
  const files = await readdir(TEMP_DIR);
  if (!files.includes('calendar_dates.txt')) {
    console.log('  No calendar_dates.txt found, skipping');
    return {};
  }

  const records = await parseCSV('calendar_dates.txt');

  // Group by service_id
  const calendarDates = {};
  for (const r of records) {
    const serviceId = r.service_id;
    if (!calendarDates[serviceId]) {
      calendarDates[serviceId] = [];
    }
    calendarDates[serviceId].push({
      date: r.date,
      exceptionType: parseInt(r.exception_type, 10), // 1 = added, 2 = removed
    });
  }

  console.log(`  Processed calendar dates for ${Object.keys(calendarDates).length} services`);
  return calendarDates;
}

async function main() {
  try {
    await downloadAndExtract();

    const [trips, stopTimes, stops, shapes, calendar, calendarDates] = await Promise.all([
      processTrips(),
      processStopTimes(),
      processStops(),
      processShapes(),
      processCalendar(),
      processCalendarDates(),
    ]);

    console.log('\nWriting JSON files...');

    await Promise.all([
      writeFile(path.join(DATA_DIR, 'trips.json'), JSON.stringify(trips)),
      writeFile(path.join(DATA_DIR, 'stop_times.json'), JSON.stringify(stopTimes)),
      writeFile(path.join(DATA_DIR, 'stops.json'), JSON.stringify(stops)),
      writeFile(path.join(DATA_DIR, 'shapes.json'), JSON.stringify(shapes)),
      writeFile(path.join(DATA_DIR, 'calendar.json'), JSON.stringify(calendar)),
      writeFile(path.join(DATA_DIR, 'calendar_dates.json'), JSON.stringify(calendarDates)),
    ]);

    // Clean up raw files
    await rm(TEMP_DIR, { recursive: true, force: true });

    console.log('\nGTFS data processing complete!');
    console.log(`Output directory: ${DATA_DIR}`);
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

main();
