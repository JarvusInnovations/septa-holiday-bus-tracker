import { setGtfsData } from '../lib/gtfs-loader.js';
import { setTripUpdatesFromFeed } from '../lib/trip-updates.js';
import { clearRouteCaches } from '../lib/route-predictor.js';

// An out-and-back route along one street: east from A to C, then back west to
// E on the same street. Shape points are 0.001 degrees of longitude apart
// (about 85m), 11 heading out (index 0-10) and 11 heading back (index 11-21).
export const LAT = 40;
export const LON0 = -75.2;
const lonAt = (step) => Math.round((LON0 + step * 0.001) * 1e6) / 1e6;

const outAndBack = [];
for (let i = 0; i <= 10; i++) outAndBack.push(LAT, lonAt(i));
for (let i = 10; i >= 0; i--) outAndBack.push(LAT, lonAt(i));

// A second shape continuing east, for the next trip in the block
const onward = [];
for (let i = 0; i <= 10; i++) onward.push(LAT + 0.01, lonAt(i));

const HOUR = 3600;
const MIN = 60;

/** [stopId, stopSequence, arrivalSeconds, ...] */
const flat = (rows) => rows.flatMap(([stopId, sequence, arrival]) => [stopId, sequence, arrival]);

export function loadFixtures() {
  setGtfsData({
    routes: { 47: '47', N1_BUS: 'N1' },
    trips: {
      // Evening out-and-back trip, 18:00-18:20
      T1: { routeId: '47', serviceId: 'WK', shapeId: 'S1', blockId: 'B1', headsign: 'Back to A' },
      // Next trip for the same vehicle, 18:25-18:45
      T2: { routeId: '47', serviceId: 'WK', shapeId: 'S2', blockId: 'B1', headsign: 'Onward' },
      // Late-night trip that runs past midnight, 23:50-24:20
      T3: { routeId: 'N1_BUS', serviceId: 'WK', shapeId: 'S1', blockId: 'B2', headsign: 'Owl' },
    },
    stopTimes: {
      T1: flat([
        [1, 1, 18 * HOUR],
        [2, 2, 18 * HOUR + 5 * MIN],
        [3, 3, 18 * HOUR + 10 * MIN],
        [4, 4, 18 * HOUR + 15 * MIN],
        [5, 5, 18 * HOUR + 20 * MIN],
      ]),
      T2: flat([
        [6, 1, 18 * HOUR + 25 * MIN],
        [7, 2, 18 * HOUR + 35 * MIN],
        [8, 3, 18 * HOUR + 45 * MIN],
      ]),
      T3: flat([
        [1, 1, 23 * HOUR + 50 * MIN],
        [2, 2, 24 * HOUR],
        [3, 3, 24 * HOUR + 10 * MIN],
        [4, 4, 24 * HOUR + 15 * MIN],
        [5, 5, 24 * HOUR + 20 * MIN],
      ]),
    },
    stops: {
      1: { name: 'A outbound', lat: LAT, lon: lonAt(0) },
      2: { name: 'B outbound', lat: LAT, lon: lonAt(5) },
      3: { name: 'C turnaround', lat: LAT, lon: lonAt(10) },
      4: { name: 'B inbound', lat: LAT, lon: lonAt(5) },
      5: { name: 'A inbound', lat: LAT, lon: lonAt(0) },
      6: { name: 'North start', lat: LAT + 0.01, lon: lonAt(0) },
      7: { name: 'North middle', lat: LAT + 0.01, lon: lonAt(5) },
      8: { name: 'North end', lat: LAT + 0.01, lon: lonAt(10) },
    },
    shapes: { S1: outAndBack, S2: onward },
  });
  setTripUpdatesFromFeed({ entity: [] });
  clearRouteCaches();
}

/** Supply live arrival predictions: { tripId: { stopSequence: 'ISO time' } } */
export function setPredictions(predictions) {
  setTripUpdatesFromFeed({
    entity: Object.entries(predictions).map(([tripId, stops]) => ({
      tripUpdate: {
        trip: { tripId },
        stopTimeUpdate: Object.entries(stops).map(([sequence, iso]) => ({
          stopSequence: Number(sequence),
          arrival: { time: String(Date.parse(iso) / 1000) },
        })),
      },
    })),
  });
}

export { lonAt };
