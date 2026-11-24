import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const DATA_DIR = path.join(__dirname, '..', 'data', 'gtfs');

// The schedule is held in compact form (see bin/download-gtfs.js):
//   trips:     { tripId: { routeId, serviceId, shapeId, blockId, headsign } }
//   stopTimes: { tripId: [stopId, stopSequence, arrivalSeconds, ...] }  (flat triples)
//   routes:    { routeId: name riders know it by }
//   stops:     { stopId: { name, lat, lon } }
//   shapes:    { shapeId: [lat, lon, lat, lon, ...] }                   (flat pairs)
let store = null;

const STOP_TIME_FIELDS = 3;

function buildBlocks(trips, stopTimes) {
  // Trips a single vehicle runs back to back share a block within a service
  const blocks = new Map();
  for (const tripId of Object.keys(trips)) {
    const trip = trips[tripId];
    const times = stopTimes[tripId];
    if (!trip.blockId || !times || times.length < STOP_TIME_FIELDS) continue;

    const key = `${trip.serviceId}|${trip.blockId}`;
    let list = blocks.get(key);
    if (!list) {
      list = [];
      blocks.set(key, list);
    }
    list.push({
      tripId,
      start: times[2],
      end: times[times.length - 1],
    });
  }
  for (const list of blocks.values()) {
    list.sort((a, b) => a.start - b.start);
  }
  return blocks;
}

/** Replace the in-memory schedule. Exposed so tests can supply a small one. */
export function setGtfsData({ trips, stopTimes, stops, shapes, routes = {}, meta = null }) {
  store = {
    routes,
    trips,
    stopTimes,
    stops,
    shapes,
    meta,
    blocks: buildBlocks(trips, stopTimes),
    loadedAt: new Date().toISOString(),
  };
}

export async function loadGtfsData(dataDir = DATA_DIR) {
  console.log('Loading GTFS data into memory...');

  const read = async (name) => JSON.parse(await readFile(path.join(dataDir, name), 'utf-8'));

  // Parse one file at a time to keep peak memory down
  const trips = await read('trips.json');
  const stopTimes = await read('stop_times.json');
  const stops = await read('stops.json');
  const shapes = await read('shapes.json');
  let routes = {};
  let meta = null;
  try {
    routes = await read('routes.json');
    meta = await read('meta.json');
  } catch {
    // Older downloads have neither file; route ids are shown as they are
  }

  // Before the compact format each stop time was an object rather than three values
  const [sampleTripId] = Object.keys(stopTimes);
  if (sampleTripId && typeof stopTimes[sampleTripId][0] === 'object') {
    throw new Error('GTFS data is in an old format; run `node bin/download-gtfs.js` again');
  }

  // Swap everything at once so readers never see a mix of old and new
  setGtfsData({ trips, stopTimes, stops, shapes, routes, meta });

  console.log(
    `  Loaded: ${Object.keys(trips).length} trips, ${Object.keys(stops).length} stops, ${Object.keys(shapes).length} shapes` +
      (meta?.feedVersion ? ` (feed ${meta.feedVersion})` : '')
  );
}

export function isGtfsLoaded() {
  return store != null;
}

export function getGtfsInfo() {
  return store ? { ...(store.meta || {}), loadedAt: store.loadedAt } : null;
}

/** The name riders know a route by (e.g. "M1" for route id "M1_BUS"). */
export function getRouteName(routeId) {
  if (routeId == null) return null;
  return store?.routes[routeId] ?? routeId;
}

export function getTrip(tripId) {
  return store?.trips[tripId] ?? null;
}

/** Stop times for a trip in stop order: [{ stopId, stopSequence, arrivalSeconds }] */
export function getStopTimes(tripId) {
  const flat = store?.stopTimes[tripId];
  if (!flat) return null;

  const result = [];
  for (let i = 0; i < flat.length; i += STOP_TIME_FIELDS) {
    result.push({
      stopId: String(flat[i]),
      stopSequence: flat[i + 1],
      arrivalSeconds: flat[i + 2] < 0 ? null : flat[i + 2],
    });
  }
  return result;
}

export function getStop(stopId) {
  return store?.stops[stopId] ?? null;
}

/** Shape as a flat [lat, lon, lat, lon, ...] array */
export function getShape(shapeId) {
  return store?.shapes[shapeId] ?? null;
}

/** The trip the same vehicle is scheduled to run next, if any. */
export function getNextTripInBlock(tripId) {
  const trip = getTrip(tripId);
  if (!trip?.blockId) return null;

  const list = store.blocks.get(`${trip.serviceId}|${trip.blockId}`);
  if (!list) return null;

  const index = list.findIndex((t) => t.tripId === tripId);
  if (index === -1 || index + 1 >= list.length) return null;
  return list[index + 1];
}
