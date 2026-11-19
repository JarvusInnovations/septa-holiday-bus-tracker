import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { existsSync } from 'fs';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import compress from '@fastify/compress';
import fastifyStatic from '@fastify/static';
import { loadGtfsData, getGtfsInfo } from './lib/gtfs-loader.js';
import { startGtfsRefresh } from './lib/gtfs-refresh.js';
import { startPolling, getFeedAgeSeconds } from './lib/bus-positions.js';
import mapDataRoute from './routes/map-data.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Health checks and 5-second polling would otherwise drown the logs
const fastify = Fastify({ logger: true, disableRequestLogging: true });

await fastify.register(cors, {
  origin: true,
});

await fastify.register(compress);

fastify.register(mapDataRoute);

// Serve static frontend files if public directory exists
const publicDir = join(__dirname, 'public');
if (existsSync(publicDir)) {
  await fastify.register(fastifyStatic, {
    root: publicDir,
    prefix: '/',
  });
}

// Always 200 while the process is up: restarting the pod can't fix a SEPTA
// outage, so feed problems are reported here rather than failing the probe
fastify.get('/health', async (request, reply) => {
  return {
    status: 'ok',
    feedAgeSeconds: getFeedAgeSeconds(),
    gtfs: getGtfsInfo(),
  };
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
  startGtfsRefresh();

  try {
    await fastify.listen({ port: 3000, host: '0.0.0.0' });
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
}

async function shutdown(signal) {
  fastify.log.info(`Received ${signal}, shutting down...`);
  await fastify.close();
  process.exit(0);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

start();
