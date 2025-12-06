import Fastify from 'fastify';
import cors from '@fastify/cors';
import { loadGtfsData } from './lib/gtfs-loader.js';
import { startPolling } from './lib/bus-positions.js';
import mapDataRoute from './routes/map-data.js';

const fastify = Fastify({ logger: true });

await fastify.register(cors, {
  origin: true,
});

fastify.register(mapDataRoute);

fastify.get('/health', async (request, reply) => {
  return { status: 'ok' };
});

async function start() {
  try {
    await loadGtfsData();
  } catch (error) {
    console.error('Failed to load GTFS data:', error.message);
    console.error('Run `node bin/download-gtfs.js` to download the GTFS data first.');
    process.exit(1);
  }

  await startPolling();

  try {
    await fastify.listen({ port: 3000, host: '0.0.0.0' });
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
}

start();
