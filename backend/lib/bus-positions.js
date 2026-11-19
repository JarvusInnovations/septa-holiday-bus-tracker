import GtfsRealtimeBindings from 'gtfs-realtime-bindings';
import { buildRoutesGeoJSON } from './route-predictor.js';
import { fetchTripUpdates } from './trip-updates.js';
import { getTrip, getRouteName } from './gtfs-loader.js';
import { getFleet, activeNotice, guessVehicleType, VEHICLE_COLORS } from './fleet.js';
import { formatClock } from './time.js';

const SEPTA_VEHICLE_POSITIONS_URL =
  'https://www3.septa.org/gtfsrt/septa-pa-us/Vehicle/rtVehiclePosition.pb';
const POLL_INTERVAL_MS = 5000;
const FETCH_TIMEOUT_MS = 10000;
const TEST_BUS_COUNT = 6;
const TEST_TROLLEY_COUNT = 4;

// A position older than this is shown as "last seen" rather than live
const STALE_AFTER_SECONDS = 5 * 60;
// How long to keep showing where a vehicle was after it stops reporting
const LAST_SEEN_RETENTION_MS = 18 * 60 * 60 * 1000;

// Vehicle statuses:
//   in_service    - on a trip and reporting fresh positions
//   parked        - reporting, but not on a trip (at a depot, on display, deadheading)
//   last_seen     - not reporting right now; shown at its last known position
//   not_reporting - never seen since the server started; not on the map

const EMPTY_COLLECTION = { type: 'FeatureCollection', features: [] };

function emptyModeData() {
  return { vehicles: [], buses: EMPTY_COLLECTION, routes: EMPTY_COLLECTION };
}

let currentData = { holiday: emptyModeData(), test: emptyModeData() };
let lastSuccessMs = null;

// Last reported position of each tracked vehicle, kept so a vehicle that
// drops out of the feed (e.g. switched off while on display) stays on the map
const lastSeen = new Map();

// Test vehicles, picked at random from whatever is currently in service
let testFleet = [];

function hasPosition(position) {
  return (
    position != null &&
    Number.isFinite(position.latitude) &&
    Number.isFinite(position.longitude) &&
    (position.latitude !== 0 || position.longitude !== 0)
  );
}

/** Pull the fields we use out of a GTFS-RT vehicle entity. */
function readVehicle(entity) {
  const vehicle = entity.vehicle;
  const trip = vehicle.trip;
  const has = (obj, key) => obj != null && Object.prototype.hasOwnProperty.call(obj, key);

  return {
    busId: vehicle.vehicle.id,
    latitude: vehicle.position.latitude,
    longitude: vehicle.position.longitude,
    timestamp: vehicle.timestamp ? Number(vehicle.timestamp) : null,
    tripId: trip?.tripId || null,
    routeId: trip?.routeId || null,
    startDate: trip?.startDate || null,
    // Unset protobuf fields decode to 0, so only trust the value when it was sent
    currentStopSequence: has(vehicle, 'currentStopSequence') ? vehicle.currentStopSequence : null,
  };
}

function pickTestFleet(reporting) {
  const buses = [];
  const trolleys = [];
  const holidayIds = new Set(getFleet().vehicles.map((v) => v.id));

  for (const vehicle of reporting.values()) {
    // Only vehicles on a trip we know the schedule for make useful test subjects
    if (holidayIds.has(vehicle.busId) || !vehicle.tripId || !getTrip(vehicle.tripId)) continue;
    (guessVehicleType(vehicle.busId) === 'trolley' ? trolleys : buses).push(vehicle.busId);
  }

  const shuffle = (arr) => {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  };

  const ids = [
    ...shuffle(buses).slice(0, TEST_BUS_COUNT),
    ...shuffle(trolleys).slice(0, TEST_TROLLEY_COUNT),
  ];
  testFleet = ids.map((id, index) => ({
    id,
    type: guessVehicleType(id),
    district: null,
    name: null,
    color: VEHICLE_COLORS[index % VEHICLE_COLORS.length],
  }));
  console.log(`[Test mode] Selected ${ids.length} test vehicles: ${ids.join(', ')}`);
}

/**
 * Work out the state of every vehicle in a fleet and build the map data.
 *
 * @param {object[]} fleet - vehicles from fleet config
 * @param {Map<string, object>} reporting - vehicles in the current feed, by id
 * @param {number} nowMs
 * @param {Map<string, object>} [memory] - last known positions, updated in place
 */
export function buildModeData(fleet, reporting, nowMs, memory = new Map()) {
  const records = [];

  for (const entry of fleet) {
    const live = reporting.get(entry.id);
    let record;

    if (live) {
      const seenAtMs = live.timestamp ? live.timestamp * 1000 : nowMs;
      memory.set(entry.id, { latitude: live.latitude, longitude: live.longitude, seenAtMs });

      const stale = (nowMs - seenAtMs) / 1000 > STALE_AFTER_SECONDS;
      if (stale) {
        record = { status: 'last_seen', latitude: live.latitude, longitude: live.longitude, seenAtMs };
      } else {
        record = { ...live, status: live.tripId ? 'in_service' : 'parked', seenAtMs };
      }
    } else {
      const remembered = memory.get(entry.id);
      if (remembered && nowMs - remembered.seenAtMs <= LAST_SEEN_RETENTION_MS) {
        record = { status: 'last_seen', ...remembered };
      } else {
        memory.delete(entry.id);
        record = { status: 'not_reporting' };
      }
    }

    records.push({ ...record, busId: entry.id, color: entry.color, entry });
  }

  // Routes and upcoming stops only make sense for vehicles on a trip right now
  const { geojson: routes, trips } = buildRoutesGeoJSON(
    records.filter((r) => r.status === 'in_service'),
    nowMs
  );

  const vehicles = records.map((record) => {
    const trip = trips.get(record.busId);
    return {
      id: record.busId,
      type: record.entry.type,
      district: record.entry.district,
      name: record.entry.name,
      color: record.entry.color,
      status: record.status,
      routeId: record.status === 'in_service' ? getRouteName(record.routeId || trip?.routeId || null) : null,
      destination: record.status === 'in_service' ? trip?.headsign || null : null,
      lastSeen: record.status === 'last_seen' ? formatClock(record.seenAtMs) : null,
    };
  });

  const features = [];
  records.forEach((record, index) => {
    if (record.status === 'not_reporting') return;

    const { id, ...properties } = vehicles[index];
    features.push({
      type: 'Feature',
      geometry: {
        type: 'Point',
        coordinates: [record.longitude, record.latitude],
      },
      properties: {
        busId: id,
        ...properties,
        vehicleType: properties.type,
      },
    });
  });
  const buses = { type: 'FeatureCollection', features };

  return { vehicles, buses, routes };
}

async function fetchVehiclePositions() {
  // Trip updates never throw; a failure there just leaves older predictions in place
  const [response] = await Promise.all([
    fetch(SEPTA_VEHICLE_POSITIONS_URL, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) }),
    fetchTripUpdates(),
  ]);
  if (!response.ok) {
    throw new Error(`HTTP error: ${response.status}`);
  }

  const buffer = await response.arrayBuffer();
  const feed = GtfsRealtimeBindings.transit_realtime.FeedMessage.decode(new Uint8Array(buffer));

  const reporting = new Map();
  for (const entity of feed.entity) {
    if (entity.vehicle?.vehicle?.id && hasPosition(entity.vehicle.position)) {
      const vehicle = readVehicle(entity);
      reporting.set(vehicle.busId, vehicle);
    }
  }

  // Re-pick test vehicles once none of the current ones are on a trip any more
  if (!testFleet.some((v) => reporting.get(v.id)?.tripId)) {
    pickTestFleet(reporting);
  }

  const nowMs = Date.now();
  const holiday = buildModeData(getFleet().vehicles, reporting, nowMs, lastSeen);
  const test = buildModeData(testFleet, reporting, nowMs);

  // Atomic update: replace both modes together
  currentData = { holiday, test };
  lastSuccessMs = nowMs;
}

let consecutiveFailures = 0;

async function poll() {
  try {
    await fetchVehiclePositions();
    if (consecutiveFailures > 0) {
      console.log(`Vehicle positions recovered after ${consecutiveFailures} failed attempts`);
    }
    consecutiveFailures = 0;
  } catch (error) {
    consecutiveFailures++;
    // Log the first failure and then only now and again, not every 5 seconds
    if (consecutiveFailures === 1 || consecutiveFailures % 12 === 0) {
      console.error(`Error fetching vehicle positions (attempt ${consecutiveFailures}):`, error.message);
    }
  }
}

/** Seconds since SEPTA's feed was last read successfully, or null if it never has been. */
export function getFeedAgeSeconds() {
  return lastSuccessMs == null ? null : Math.round((Date.now() - lastSuccessMs) / 1000);
}

/** Everything the frontend needs for one mode ('holiday' or 'test'). */
export function getMapData(mode = 'holiday') {
  const data = currentData[mode] || emptyModeData();
  const fleet = getFleet();
  const isHoliday = mode !== 'test';

  return {
    // No fleet announced yet: the frontend shows a "coming soon" notice instead
    comingSoon: isHoliday && fleet.vehicles.length === 0,
    notice: isHoliday ? activeNotice(fleet, Date.now()) : null,
    vehicles: data.vehicles,
    buses: data.buses,
    routes: data.routes,
    lastUpdated: lastSuccessMs == null ? null : new Date(lastSuccessMs).toISOString(),
    dataAgeSeconds: getFeedAgeSeconds(),
  };
}

export async function startPolling() {
  await poll();

  // Each poll is scheduled only after the previous one finishes, so a slow
  // response can never overlap with (and later overwrite) a newer one
  const loop = async () => {
    await poll();
    setTimeout(loop, POLL_INTERVAL_MS);
  };
  setTimeout(loop, POLL_INTERVAL_MS);
}
