import Fastify from 'fastify';
import cors from '@fastify/cors';
import GtfsRealtimeBindings from 'gtfs-realtime-bindings';
import { loadGtfsData } from './lib/gtfs-loader.js';
import { buildRoutesGeoJSON } from './lib/route-predictor.js';

const SEPTA_VEHICLE_POSITIONS_URL =
  'https://www3.septa.org/gtfsrt/septa-pa-us/Vehicle/rtVehiclePosition.pb';
const POLL_INTERVAL_MS = 5000;

// Set USE_MOCK_DATA=true env var to use mock data for testing without live GTFS-RT feed
const USE_MOCK_DATA = process.env.USE_MOCK_DATA === 'true';

const MOCK_POSITIONS = [
  {
    busId: '3090',
    latitude: 40.029748,
    longitude: -75.087722,
    bearing: 45,
    speed: 8.5,
    tripId: '376058', // Route 1 to Parx Casino - Northeast Philly
    routeId: '1',
    directionId: 0,
    startTime: '18:00:00',
    startDate: new Date().toISOString().slice(0, 10).replace(/-/g, ''),
  },
  {
    busId: '3410',
    latitude: 39.944731,
    longitude: -75.174974,
    bearing: 180,
    speed: 5.0,
    tripId: '377814', // Route 17 to 2nd-Market - Center City/South
    routeId: '17',
    directionId: 0,
    startTime: '10:00:00',
    startDate: new Date().toISOString().slice(0, 10).replace(/-/g, ''),
  },
  {
    busId: '3069',
    latitude: 40.017132,
    longitude: -75.154588,
    bearing: 200,
    speed: 7.2,
    tripId: '381868', // Route 23 to 11th-Market - Germantown
    routeId: '23',
    directionId: 0,
    startTime: '14:00:00',
    startDate: new Date().toISOString().slice(0, 10).replace(/-/g, ''),
  },
  {
    busId: '3019',
    latitude: 39.973352,
    longitude: -75.149405,
    bearing: 270,
    speed: 6.0,
    tripId: '392314', // Route 47 to Whitman Plaza - North Philly
    routeId: '47',
    directionId: 0,
    startTime: '11:30:00',
    startDate: new Date().toISOString().slice(0, 10).replace(/-/g, ''),
  },
  {
    busId: '3125',
    latitude: 39.9602,
    longitude: -75.224948,
    bearing: 90,
    speed: 4.5,
    tripId: '394804', // Route 52 to 49th-Woodland - West Philly
    routeId: '52',
    directionId: 0,
    startTime: '15:30:00',
    startDate: new Date().toISOString().slice(0, 10).replace(/-/g, ''),
  },
  {
    busId: '3817',
    latitude: 40.041293,
    longitude: -75.028643,
    bearing: 315,
    speed: 9.0,
    tripId: '402596', // Route 66 to Frankford TC - Far Northeast
    routeId: '66',
    directionId: 0,
    startTime: '10:00:00',
    startDate: new Date().toISOString().slice(0, 10).replace(/-/g, ''),
  },
  {
    busId: '3364',
    latitude: 39.975848,
    longitude: -75.168709,
    bearing: 135,
    speed: 5.5,
    tripId: '385842', // Route 33 to 5th-Market - Fairmount/Spring Garden
    routeId: '33',
    directionId: 0,
    startTime: '19:30:00',
    startDate: new Date().toISOString().slice(0, 10).replace(/-/g, ''),
  },
];

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
  if (USE_MOCK_DATA) {
    holidayBusPositions = MOCK_POSITIONS.map((pos) => ({
      ...pos,
      timestamp: Math.floor(Date.now() / 1000),
    }));
    console.log(
      `[${new Date().toISOString()}] Using mock data: ${holidayBusPositions.length} holiday buses`
    );
    return;
  }

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
