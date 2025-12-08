import { getBuses, getRoutes } from '../lib/bus-positions.js';

const geoJSONSchema = {
  type: 'object',
  properties: {
    type: { type: 'string' },
    features: { type: 'array' },
  },
};

const mapDataSchema = {
  querystring: {
    type: 'object',
    properties: {
      test: { type: 'string' },
    },
  },
  response: {
    200: {
      type: 'object',
      required: ['buses', 'routes', 'lastUpdated'],
      properties: {
        buses: geoJSONSchema,
        routes: geoJSONSchema,
        lastUpdated: { type: 'string' },
      },
    },
  },
};

export default async function mapDataRoute(fastify) {
  fastify.get('/api/map-data', { schema: mapDataSchema }, async (request, reply) => {
    const mode = request.query.test === 'true' ? 'test' : 'holiday';
    return {
      buses: getBuses(mode),
      routes: getRoutes(mode),
      lastUpdated: new Date().toISOString(),
    };
  });
}
