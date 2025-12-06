import { getPositions, getRoutes } from '../lib/bus-positions.js';

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
        buses: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              busId: { type: 'string' },
              color: { type: 'string' },
              latitude: { type: ['number', 'null'] },
              longitude: { type: ['number', 'null'] },
              bearing: { type: ['number', 'null'] },
              speed: { type: ['number', 'null'] },
              timestamp: { type: ['integer', 'null'] },
              tripId: { type: ['string', 'null'] },
              routeId: { type: ['string', 'null'] },
              directionId: { type: ['integer', 'null'] },
              startTime: { type: ['string', 'null'] },
              startDate: { type: ['string', 'null'] },
            },
          },
        },
        routes: {
          type: 'object',
          properties: {
            type: { type: 'string' },
            features: { type: 'array' },
          },
        },
        lastUpdated: { type: 'string' },
      },
    },
  },
};

export default async function mapDataRoute(fastify) {
  fastify.get('/api/map-data', { schema: mapDataSchema }, async (request, reply) => {
    const mode = request.query.test === 'true' ? 'test' : 'holiday';
    return {
      buses: getPositions(mode),
      routes: getRoutes(mode),
      lastUpdated: new Date().toISOString(),
    };
  });
}
