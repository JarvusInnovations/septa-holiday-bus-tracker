import GtfsRealtimeBindings from 'gtfs-realtime-bindings';
import { buildRoutesGeoJSON, getUpcomingRoute } from './route-predictor.js';
import { fetchTripUpdates } from './trip-updates.js';

const SEPTA_VEHICLE_POSITIONS_URL =
  'https://www3.septa.org/gtfsrt/septa-pa-us/Vehicle/rtVehiclePosition.pb';
const POLL_INTERVAL_MS = 5000;
const TEST_BUS_COUNT = 6;
const TEST_TROLLEY_COUNT = 4;

// Palette for vehicle markers: assign one per holiday vehicle, cycled through in test mode
const HOLIDAY_COLORS = [
  '#e53935', '#43a047', '#1e88e5', '#fdd835', '#8e24aa',
  '#00897b', '#f4511e', '#c2185b', '#78909c', '#7cb342',
  '#26c6da',
];

// Holiday vehicle metadata (decorated buses and trolleys), keyed by vehicle ID.
//
// While this is empty no holiday vehicles are tracked and the site runs in
// "coming soon" mode. Keep it in sync with HOLIDAY_VEHICLES in
// frontend/src/holidayVehicles.js.
//
// `headsign` is the decoration theme; leave it null until the theme is known.
const HOLIDAY_BUSES = {
  // Buses:
  '3416': { district: 'Allegheny', headsign: null, color: '#e53935' },
  '3019': { district: 'Callowhill', headsign: null, color: '#1e88e5' },
  '3184': { district: 'Comly', headsign: null, color: '#8e24aa' },
  '3276': { district: 'Frankford', headsign: null, color: '#00897b' },
  '3197': { district: 'Frontier', headsign: null, color: '#c2185b' },
  '4627': { district: 'Germantown', headsign: null, color: '#26c6da' }, // LUCY bus
  '3230': { district: 'Midvale', headsign: null, color: '#fdd835' },
  '3252': { district: 'Southern', headsign: null, color: '#78909c' },
  '3273': { district: 'Victory', headsign: null, color: '#43a047' },

  // Trolleys (IDs start with '9'):
  '9027': { district: 'Elmwood', headsign: null, color: '#f4511e' },
  '9079': { district: 'Woodland', headsign: null, color: '#7cb342' },
};

const HOLIDAY_BUS_IDS = new Set(Object.keys(HOLIDAY_BUSES));

// Test bus IDs - dynamically selected on startup
let testBusIds = new Set();
let testBusIdList = [];

function getBusColor(busId, mode) {
  if (mode === 'test') {
    const index = testBusIdList.indexOf(busId);
    return HOLIDAY_COLORS[index % HOLIDAY_COLORS.length];
  }
  return HOLIDAY_BUSES[busId]?.color || HOLIDAY_COLORS[0];
}

/**
 * Select random buses from the feed that have upcoming stops.
 * Called once on startup to populate testBusIds.
 */
async function selectRandomTestBuses() {
  try {
    // Fetch current vehicle positions and trip updates
    const [response] = await Promise.all([
      fetch(SEPTA_VEHICLE_POSITIONS_URL),
      fetchTripUpdates(),
    ]);
    if (!response.ok) {
      throw new Error(`HTTP error: ${response.status}`);
    }

    const buffer = await response.arrayBuffer();
    const feed = GtfsRealtimeBindings.transit_realtime.FeedMessage.decode(
      new Uint8Array(buffer)
    );

    const now = new Date();
    const candidateBuses = [];
    const candidateTrolleys = [];

    // Find vehicles with valid positions and upcoming stops
    for (const entity of feed.entity) {
      if (entity.vehicle?.vehicle?.id) {
        const vehicleId = entity.vehicle.vehicle.id;
        const position = entity.vehicle.position;
        const trip = entity.vehicle.trip;

        // Skip holiday buses
        if (HOLIDAY_BUS_IDS.has(vehicleId)) {
          continue;
        }

        // Must have position and trip info
        if (!position?.latitude || !position?.longitude || !trip?.tripId) {
          continue;
        }

        // Check if this vehicle has upcoming stops
        const route = getUpcomingRoute(trip.tripId, position.latitude, position.longitude, now);
        if (route && route.upcomingStops && route.upcomingStops.length > 0) {
          // Trolley IDs start with '9'
          if (vehicleId.startsWith('9')) {
            candidateTrolleys.push(vehicleId);
          } else {
            candidateBuses.push(vehicleId);
          }
        }
      }
    }

    // Shuffle helper
    const shuffle = (arr) => {
      for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
      }
      return arr;
    };

    // Pick from each pool
    shuffle(candidateBuses);
    shuffle(candidateTrolleys);
    const selectedBuses = candidateBuses.slice(0, TEST_BUS_COUNT);
    const selectedTrolleys = candidateTrolleys.slice(0, TEST_TROLLEY_COUNT);
    const selectedVehicles = [...selectedBuses, ...selectedTrolleys];

    testBusIds = new Set(selectedVehicles);
    testBusIdList = selectedVehicles;

    console.log(`[Startup] Selected ${selectedBuses.length} test buses and ${selectedTrolleys.length} test trolleys: ${selectedVehicles.join(', ')}`);
  } catch (error) {
    console.error('Error selecting random test buses:', error.message);
  }
}

// Convert positions array to GeoJSON FeatureCollection
function positionsToGeoJSON(positions, mode) {
  return {
    type: 'FeatureCollection',
    features: positions
      .filter((bus) => bus.latitude && bus.longitude)
      .map((bus) => {
        const metadata = mode === 'holiday' ? HOLIDAY_BUSES[bus.busId] : null;
        return {
          type: 'Feature',
          geometry: {
            type: 'Point',
            coordinates: [bus.longitude, bus.latitude],
          },
          properties: {
            busId: bus.busId,
            routeId: bus.routeId,
            color: bus.color,
            bearing: bus.bearing,
            district: metadata?.district || null,
            headsign: metadata?.headsign || null,
            vehicleType: bus.busId.startsWith('9') ? 'trolley' : 'bus',
          },
        };
      }),
  };
}

// Store positions and routes for both modes
let currentData = {
  holiday: {
    buses: { type: 'FeatureCollection', features: [] },
    routes: { type: 'FeatureCollection', features: [] },
  },
  test: {
    buses: { type: 'FeatureCollection', features: [] },
    routes: { type: 'FeatureCollection', features: [] },
  },
};

async function fetchVehiclePositions() {
  try {
    // Fetch vehicle positions and trip updates in parallel
    const [response] = await Promise.all([
      fetch(SEPTA_VEHICLE_POSITIONS_URL),
      fetchTripUpdates(),
    ]);
    if (!response.ok) {
      throw new Error(`HTTP error: ${response.status}`);
    }

    const buffer = await response.arrayBuffer();
    const feed = GtfsRealtimeBindings.transit_realtime.FeedMessage.decode(
      new Uint8Array(buffer)
    );

    const holidayPositions = [];
    const testPositions = [];

    for (const entity of feed.entity) {
      if (entity.vehicle?.vehicle?.id) {
        const vehicleId = entity.vehicle.vehicle.id;
        const position = entity.vehicle.position;
        const trip = entity.vehicle.trip;

        const basePosition = {
          busId: vehicleId,
          latitude: position?.latitude ?? null,
          longitude: position?.longitude ?? null,
          bearing: position?.bearing ?? null,
          speed: position?.speed ?? null,
          timestamp: entity.vehicle.timestamp
            ? Number(entity.vehicle.timestamp)
            : null,
          tripId: trip?.tripId ?? null,
          routeId: trip?.routeId ?? null,
          directionId: trip?.directionId ?? null,
          startTime: trip?.startTime ?? null,
          startDate: trip?.startDate ?? null,
        };

        if (HOLIDAY_BUS_IDS.has(vehicleId)) {
          holidayPositions.push({
            ...basePosition,
            color: getBusColor(vehicleId, 'holiday'),
          });
        }

        if (testBusIds.has(vehicleId)) {
          testPositions.push({
            ...basePosition,
            color: getBusColor(vehicleId, 'test'),
          });
        }
      }
    }

    const now = new Date();
    const holidayRoutes = buildRoutesGeoJSON(holidayPositions, now);
    const testRoutes = buildRoutesGeoJSON(testPositions, now);

    // Atomic update: replace both caches together
    currentData = {
      holiday: {
        buses: positionsToGeoJSON(holidayPositions, 'holiday'),
        routes: holidayRoutes,
      },
      test: {
        buses: positionsToGeoJSON(testPositions, 'test'),
        routes: testRoutes,
      },
    };

    console.log(
      `[${now.toISOString()}] Updated holiday: ${holidayPositions.length} buses, ${holidayRoutes.features.length} features | test: ${testPositions.length} buses, ${testRoutes.features.length} features`
    );
  } catch (error) {
    console.error('Error fetching vehicle positions:', error.message);
  }
}

export function getBuses(mode = 'holiday') {
  return currentData[mode]?.buses || { type: 'FeatureCollection', features: [] };
}

export function getRoutes(mode = 'holiday') {
  return currentData[mode]?.routes || { type: 'FeatureCollection', features: [] };
}

export async function startPolling() {
  // Select random test buses on startup (before first fetch)
  await selectRandomTestBuses();
  await fetchVehiclePositions();
  setInterval(fetchVehiclePositions, POLL_INTERVAL_MS);
}
