import GtfsRealtimeBindings from 'gtfs-realtime-bindings';
import { buildRoutesGeoJSON } from './route-predictor.js';
import { fetchTripUpdates } from './trip-updates.js';

const SEPTA_VEHICLE_POSITIONS_URL =
  'https://www3.septa.org/gtfsrt/septa-pa-us/Vehicle/rtVehiclePosition.pb';
const POLL_INTERVAL_MS = 5000;


// Actual holiday bus IDs (decorated buses)
const HOLIDAY_BUS_IDS = new Set([
  '3090',
  '3410',
  '3069',
  '3019',
  '3125',
  '3817',
  '3364',
  '3160',
]);

// Test bus IDs for development (random buses currently in service)
const TEST_BUS_IDS = new Set([
  '8620', // Route 35
  '3641', // Route 21
  '3369', // Route 20
  '3223', // Route 96
  '3703', // Route 125
  '3761', // Route 58
  '3427', // Route 49
  '3205', // Route 98
]);

// Holiday colors mapped to bus IDs
const HOLIDAY_COLORS = [
  '#e53935', // Red
  '#43a047', // Green
  '#1e88e5', // Blue
  '#fdd835', // Gold
  '#8e24aa', // Purple
  '#00897b', // Teal
  '#f4511e', // Deep Orange
  '#c2185b', // Pink
];

const HOLIDAY_BUS_ID_LIST = Array.from(HOLIDAY_BUS_IDS);
const TEST_BUS_ID_LIST = Array.from(TEST_BUS_IDS);

function getBusColor(busId, mode) {
  const busIdList = mode === 'test' ? TEST_BUS_ID_LIST : HOLIDAY_BUS_ID_LIST;
  const index = busIdList.indexOf(busId);
  return HOLIDAY_COLORS[index % HOLIDAY_COLORS.length];
}

// Store positions and routes for both modes
let currentData = {
  holiday: {
    positions: [],
    routes: { type: 'FeatureCollection', features: [] },
  },
  test: {
    positions: [],
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

        if (TEST_BUS_IDS.has(vehicleId)) {
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
      holiday: { positions: holidayPositions, routes: holidayRoutes },
      test: { positions: testPositions, routes: testRoutes },
    };

    console.log(
      `[${now.toISOString()}] Updated holiday: ${holidayPositions.length} buses, ${holidayRoutes.features.length} features | test: ${testPositions.length} buses, ${testRoutes.features.length} features`
    );
  } catch (error) {
    console.error('Error fetching vehicle positions:', error.message);
  }
}

export function getPositions(mode = 'holiday') {
  return currentData[mode]?.positions || [];
}

export function getRoutes(mode = 'holiday') {
  return currentData[mode]?.routes || { type: 'FeatureCollection', features: [] };
}

export async function startPolling() {
  await fetchVehiclePositions();
  setInterval(fetchVehiclePositions, POLL_INTERVAL_MS);
}
