import Fastify from 'fastify';
import cors from '@fastify/cors';
import GtfsRealtimeBindings from 'gtfs-realtime-bindings';
import { loadGtfsData } from './lib/gtfs-loader.js';
import { buildRoutesGeoJSON } from './lib/route-predictor.js';

const SEPTA_VEHICLE_POSITIONS_URL =
  'https://www3.septa.org/gtfsrt/septa-pa-us/Vehicle/rtVehiclePosition.pb';
const POLL_INTERVAL_MS = 5000;

// Set USE_TEST_BUSES=true env var to track random test buses instead of holiday buses
const USE_TEST_BUSES = process.env.USE_TEST_BUSES === 'true';

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

const TRACKED_BUS_IDS = USE_TEST_BUSES ? TEST_BUS_IDS : HOLIDAY_BUS_IDS;
const BUS_ID_LIST = Array.from(TRACKED_BUS_IDS);

function getBusColor(busId) {
  const index = BUS_ID_LIST.indexOf(busId);
  return HOLIDAY_COLORS[index % HOLIDAY_COLORS.length];
}

let holidayBusPositions = [];

async function fetchVehiclePositions() {
  try {
    const response = await fetch(SEPTA_VEHICLE_POSITIONS_URL);
    if (!response.ok) {
      throw new Error(`HTTP error: ${response.status}`);
    }

    const buffer = await response.arrayBuffer();
    const feed = GtfsRealtimeBindings.transit_realtime.FeedMessage.decode(
      new Uint8Array(buffer)
    );

    const positions = [];

    for (const entity of feed.entity) {
      if (entity.vehicle?.vehicle?.id) {
        const vehicleId = entity.vehicle.vehicle.id;

        if (TRACKED_BUS_IDS.has(vehicleId)) {
          const position = entity.vehicle.position;
          const trip = entity.vehicle.trip;

          positions.push({
            busId: vehicleId,
            color: getBusColor(vehicleId),
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
          });
        }
      }
    }

    holidayBusPositions = positions;
    const mode = USE_TEST_BUSES ? 'test' : 'holiday';
    console.log(
      `[${new Date().toISOString()}] Updated positions for ${positions.length} ${mode} buses`
    );
  } catch (error) {
    console.error('Error fetching vehicle positions:', error.message);
  }
}

const fastify = Fastify({ logger: true });

await fastify.register(cors, {
  origin: true,
});

fastify.get('/api/buses', async (request, reply) => {
  return {
    buses: holidayBusPositions,
    lastUpdated: new Date().toISOString(),
  };
});

fastify.get('/api/routes', async (request, reply) => {
  const geojson = buildRoutesGeoJSON(holidayBusPositions, new Date());
  return geojson;
});

fastify.get('/health', async (request, reply) => {
  return { status: 'ok' };
});

async function start() {
  // Load GTFS data
  try {
    await loadGtfsData();
  } catch (error) {
    console.error('Failed to load GTFS data:', error.message);
    console.error('Run `node bin/download-gtfs.js` to download the GTFS data first.');
    process.exit(1);
  }

  // Initial fetch
  await fetchVehiclePositions();

  // Start polling
  setInterval(fetchVehiclePositions, POLL_INTERVAL_MS);

  try {
    await fastify.listen({ port: 3000, host: '0.0.0.0' });
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
}

start();
