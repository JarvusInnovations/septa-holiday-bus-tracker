import GtfsRealtimeBindings from 'gtfs-realtime-bindings';
import { buildRoutesGeoJSON, getUpcomingRoute } from './route-predictor.js';
import { fetchTripUpdates } from './trip-updates.js';

const SEPTA_VEHICLE_POSITIONS_URL =
  'https://www3.septa.org/gtfsrt/septa-pa-us/Vehicle/rtVehiclePosition.pb';
const POLL_INTERVAL_MS = 5000;
const TEST_BUS_COUNT = 8;

// Holiday bus metadata (decorated buses)
const HOLIDAY_BUSES = {
  // Buses:
  '3090': { district: 'Southern', headsign: 'Beetlejuice' },
  // '3410': { district: 'Allegheny', headsign: null },
  '3069': { district: 'Victory', headsign: 'The Best Gift Ever' },
  '3019': { district: 'Callowhill', headsign: 'Santa Paws' },
  // '3125': { district: 'Frontier', headsign: null },
  '3817': { district: 'Midvale', headsign: "National Lampoon's Christmas Vacation" },
  '3364': { district: 'Comly', headsign: 'Christmas in Wonderland' },
  '3160': { district: 'Frankford', headsign: 'Care Bear Party Bus' },
  
  // Trolleys:
  '9034': { district: 'Elmwood', headsign: 'Home Alone' },
  '9087': { district: 'Elmwood', headsign: 'Holiday' },
};

const HOLIDAY_BUS_IDS = new Set(Object.keys(HOLIDAY_BUSES));

// Test bus IDs - dynamically selected on startup
let testBusIds = new Set();
let testBusIdList = [];

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

function getBusColor(busId, mode) {
  const busIdList = mode === 'test' ? testBusIdList : HOLIDAY_BUS_ID_LIST;
  const index = busIdList.indexOf(busId);
  return HOLIDAY_COLORS[index % HOLIDAY_COLORS.length];
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

    // Find buses with valid positions and upcoming stops
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

        // Check if this bus has upcoming stops
        const route = getUpcomingRoute(trip.tripId, position.latitude, position.longitude, now);
        if (route && route.upcomingStops && route.upcomingStops.length > 0) {
          candidateBuses.push(vehicleId);
        }
      }
    }

    // Shuffle and pick up to TEST_BUS_COUNT buses
    for (let i = candidateBuses.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [candidateBuses[i], candidateBuses[j]] = [candidateBuses[j], candidateBuses[i]];
    }

    const selectedBuses = candidateBuses.slice(0, TEST_BUS_COUNT);
    testBusIds = new Set(selectedBuses);
    testBusIdList = selectedBuses;

    console.log(`[Startup] Selected ${selectedBuses.length} random test buses: ${selectedBuses.join(', ')}`);
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
