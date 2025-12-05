import Fastify from 'fastify';
import cors from '@fastify/cors';
import GtfsRealtimeBindings from 'gtfs-realtime-bindings';
import { loadGtfsData } from './lib/gtfs-loader.js';
import { buildRoutesGeoJSON } from './lib/route-predictor.js';

const SEPTA_VEHICLE_POSITIONS_URL =
  'https://www3.septa.org/gtfsrt/septa-pa-us/Vehicle/rtVehiclePosition.pb';
const POLL_INTERVAL_MS = 5000;

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

        if (HOLIDAY_BUS_IDS.has(vehicleId)) {
          const position = entity.vehicle.position;
          const trip = entity.vehicle.trip;

          positions.push({
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
          });
        }
      }
    }

    holidayBusPositions = positions;
    console.log(
      `[${new Date().toISOString()}] Updated positions for ${positions.length} holiday buses`
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
