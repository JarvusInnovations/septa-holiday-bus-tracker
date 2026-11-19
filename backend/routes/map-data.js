import { getMapData } from '../lib/bus-positions.js';

const mapDataSchema = {
  querystring: {
    type: 'object',
    properties: {
      test: { type: 'string' },
    },
  },
};

export default async function mapDataRoute(fastify) {
  fastify.get('/api/map-data', { schema: mapDataSchema }, async (request, reply) => {
    const mode = request.query.test === 'true' ? 'test' : 'holiday';
    // Positions change every few seconds; never let a proxy or browser hold on to them
    reply.header('Cache-Control', 'no-store');
    return getMapData(mode);
  });
}
