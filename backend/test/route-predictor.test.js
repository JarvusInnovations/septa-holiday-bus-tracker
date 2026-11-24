import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { getUpcomingRoute, projectStopsOntoShape, buildRoutesGeoJSON } from '../lib/route-predictor.js';
import { loadFixtures, setPredictions, LAT, lonAt } from './fixtures.js';

// 2026-12-10 is in Eastern Standard Time (UTC-5)
const at = (localTime) => Date.parse(`2026-12-10T${localTime}-05:00`);
const names = (route) => route.upcomingStops.map((s) => s.name);

beforeEach(loadFixtures);

test('a trip in the realtime feed gets a route without consulting any calendar', () => {
  const route = getUpcomingRoute(
    { tripId: 'T1', latitude: LAT, longitude: lonAt(2), currentStopSequence: 2, startDate: '20261210' },
    at('18:02:00')
  );
  assert.deepEqual(names(route), ['B outbound', 'C turnaround', 'B inbound', 'A inbound']);
  assert.equal(route.upcomingStops[0].scheduledTime, '6:05 PM');
  assert.equal(route.upcomingStops[0].isRealTime, false);
  assert.equal(route.headsign, 'Back to A');
});

test('an unknown trip returns null', () => {
  assert.equal(getUpcomingRoute({ tripId: 'nope', latitude: LAT, longitude: lonAt(0) }, at('18:00:00')), null);
});

test('only stops inside the next 30 minutes are listed', () => {
  const route = getUpcomingRoute(
    { tripId: 'T1', latitude: LAT, longitude: lonAt(0), currentStopSequence: 1, startDate: '20261210' },
    at('17:38:00')
  );
  // 17:38 + 30 minutes = 18:08, so the 18:10 stop and later are out
  assert.deepEqual(names(route), ['A outbound', 'B outbound']);
});

test('a late bus keeps the stops it has not reached yet', () => {
  // 12 minutes late: by the clock stops B and C are in the past, but the feed
  // says the bus is still heading to B
  const route = getUpcomingRoute(
    { tripId: 'T1', latitude: LAT, longitude: lonAt(3), currentStopSequence: 2, startDate: '20261210' },
    at('18:17:00')
  );
  assert.deepEqual(names(route), ['B outbound', 'C turnaround', 'B inbound', 'A inbound']);
});

test('without a current stop from the feed, passed stops are dropped by the clock', () => {
  const route = getUpcomingRoute(
    { tripId: 'T1', latitude: LAT, longitude: lonAt(9), startDate: '20261210' },
    at('18:09:00')
  );
  assert.deepEqual(names(route), ['C turnaround', 'B inbound', 'A inbound']);
});

test('delay is worked out from the live prediction against the schedule', () => {
  setPredictions({
    T1: {
      2: '2026-12-10T18:09:00-05:00', // 4 minutes late
      3: '2026-12-10T18:10:20-05:00', // on time
      4: '2026-12-10T18:13:00-05:00', // 2 minutes early
    },
  });
  const route = getUpcomingRoute(
    { tripId: 'T1', latitude: LAT, longitude: lonAt(2), currentStopSequence: 2, startDate: '20261210' },
    at('18:03:00')
  );
  const [b, c, d, e] = route.upcomingStops;
  assert.deepEqual(
    [b.isRealTime, b.predictedTime, b.delayMinutes],
    [true, '6:09 PM', 4]
  );
  assert.equal(c.delayMinutes, 0);
  assert.equal(d.delayMinutes, -2);
  // No prediction for the last stop: scheduled time only, no delay claimed
  assert.deepEqual([e.isRealTime, e.predictedTime, e.delayMinutes], [false, null, null]);
});

test('a prediction pushes a stop out of the 30 minute window', () => {
  setPredictions({ T1: { 3: '2026-12-10T18:40:00-05:00' } });
  const route = getUpcomingRoute(
    { tripId: 'T1', latitude: LAT, longitude: lonAt(0), currentStopSequence: 1, startDate: '20261210' },
    at('17:45:00')
  );
  // C is scheduled 18:10 (inside 18:15) but predicted 18:40 (outside), and the
  // stops after it can't be reached any sooner
  assert.deepEqual(names(route), ['A outbound', 'B outbound']);
});

test('a trip running past midnight still shows stops after midnight', () => {
  // 00:05 on the 11th, on the trip that started 23:50 on the 10th
  const now = Date.parse('2026-12-11T00:05:00-05:00');
  const route = getUpcomingRoute(
    { tripId: 'T3', latitude: LAT, longitude: lonAt(7), currentStopSequence: 3, startDate: '20261210' },
    now
  );
  assert.deepEqual(names(route), ['C turnaround', 'B inbound', 'A inbound']);
  assert.equal(route.upcomingStops[0].scheduledTime, '12:10 AM');

  // Same again when the feed doesn't say which service day the trip belongs to
  const inferred = getUpcomingRoute(
    { tripId: 'T3', latitude: LAT, longitude: lonAt(7), currentStopSequence: 3 },
    now
  );
  assert.deepEqual(names(inferred), names(route));
});

test('stops are placed along the shape in order on an out-and-back route', () => {
  const shape = [];
  for (let i = 0; i <= 10; i++) shape.push(LAT, lonAt(i));
  for (let i = 10; i >= 0; i--) shape.push(LAT, lonAt(i));
  const stop = (step) => ({ lat: LAT, lon: lonAt(step) });

  // A, B, C (turnaround), B again, A again
  assert.deepEqual(
    projectStopsOntoShape(shape, [stop(0), stop(5), stop(10), stop(5), stop(0)]),
    [0, 5, 10, 16, 21]
  );
});

test('a stop nowhere near the shape does not throw off later stops', () => {
  const shape = [];
  for (let i = 0; i <= 10; i++) shape.push(LAT, lonAt(i));
  const indexes = projectStopsOntoShape(shape, [
    { lat: LAT, lon: lonAt(2) },
    { lat: LAT + 1, lon: lonAt(9) }, // bad data: 111km away
    null, // stop missing from stops.txt
    { lat: LAT, lon: lonAt(6) },
  ]);
  assert.deepEqual(indexes, [2, 2, 2, 6]);
});

test('on the return leg the route line only covers the return leg', () => {
  // Heading back west at step 7, between C (turnaround) and B inbound. The
  // outbound leg passes through the very same point.
  const route = getUpcomingRoute(
    { tripId: 'T1', latitude: LAT, longitude: lonAt(7), currentStopSequence: 4, startDate: '20261210' },
    at('18:12:00')
  );
  assert.deepEqual(names(route), ['B inbound', 'A inbound']);

  const lons = route.routeGeometry.coordinates.map(([lon]) => lon);
  // Starts at the bus and only ever heads west to A
  assert.equal(lons[0], lonAt(7));
  assert.equal(lons.at(-1), lonAt(0));
  for (let i = 1; i < lons.length; i++) {
    assert.ok(lons[i] <= lons[i - 1], 'line should never turn back east');
  }
});

test('on the outbound leg the route line goes out and around', () => {
  const route = getUpcomingRoute(
    { tripId: 'T1', latitude: LAT, longitude: lonAt(3), currentStopSequence: 2, startDate: '20261210' },
    at('18:03:00')
  );
  const lons = route.routeGeometry.coordinates.map(([lon]) => lon);
  assert.equal(lons[0], lonAt(3));
  assert.equal(Math.max(...lons), lonAt(10)); // reaches the turnaround
  assert.equal(lons.at(-1), lonAt(0)); // and comes back
});

test('a bus far off its route gets a line without a connector to the bus', () => {
  const route = getUpcomingRoute(
    { tripId: 'T1', latitude: LAT + 0.02, longitude: lonAt(3), currentStopSequence: 2, startDate: '20261210' },
    at('18:03:00')
  );
  const [, lat] = route.routeGeometry.coordinates[0];
  assert.equal(lat, LAT);
});

test('no route line when there are no upcoming stops', () => {
  const route = getUpcomingRoute(
    { tripId: 'T1', latitude: LAT, longitude: lonAt(0), currentStopSequence: 9, startDate: '20261210' },
    at('19:30:00')
  );
  assert.deepEqual(route.upcomingStops, []);
  assert.equal(route.routeGeometry, null);
  assert.equal(route.nextTrip, null);
});

test('the next trip in the block is shown as this one ends', () => {
  const route = getUpcomingRoute(
    { tripId: 'T1', latitude: LAT, longitude: lonAt(3), currentStopSequence: 5, startDate: '20261210' },
    at('18:16:00')
  );
  assert.deepEqual(names(route), ['A inbound']);
  assert.equal(route.nextTrip.headsign, 'Onward');
  // 18:16 + 30 minutes = 18:46, which covers the whole next trip
  assert.deepEqual(route.nextTrip.stops.map((s) => s.name), ['North start', 'North middle', 'North end']);
  assert.equal(route.nextTrip.stops[0].nextTripHeadsign, 'Onward');
  assert.ok(route.nextTrip.geometry.coordinates.length >= 2);
});

test('the next trip is not shown while this one has a long way to go', () => {
  const route = getUpcomingRoute(
    { tripId: 'T1', latitude: LAT, longitude: lonAt(0), currentStopSequence: 1, startDate: '20261210' },
    at('17:40:00')
  );
  assert.equal(route.nextTrip, null);
});

test('stops of the next trip that are already past are left out', () => {
  // The feed still has the bus on T1 well after T2 began
  const route = getUpcomingRoute(
    { tripId: 'T1', latitude: LAT, longitude: lonAt(0), currentStopSequence: 9, startDate: '20261210' },
    at('18:40:00')
  );
  assert.deepEqual(route.nextTrip.stops.map((s) => s.name), ['North end']);
});

test('GeoJSON carries lines and stops for each vehicle on a trip', () => {
  const { geojson, trips } = buildRoutesGeoJSON(
    [
      { busId: '3019', color: '#1e88e5', tripId: 'T1', latitude: LAT, longitude: lonAt(3), currentStopSequence: 2, startDate: '20261210' },
      { busId: '3416', color: '#e53935', tripId: null, latitude: LAT, longitude: lonAt(0) },
      { busId: '3184', color: '#8e24aa', tripId: 'gone', latitude: LAT, longitude: lonAt(0) },
    ],
    at('18:03:00')
  );
  assert.deepEqual([...trips.keys()], ['3019']);

  const lines = geojson.features.filter((f) => f.properties.type === 'route');
  const stops = geojson.features.filter((f) => f.properties.type === 'stop');
  assert.equal(lines.length, 1);
  // Four stops left on this trip, plus the first stop of the next trip (18:25)
  assert.equal(stops.length, 5);
  assert.equal(stops[4].properties.nextTripHeadsign, 'Onward');
  assert.ok(geojson.features.every((f) => f.properties.busId === '3019' && f.properties.color === '#1e88e5'));
  assert.deepEqual(stops[0].geometry.coordinates, [lonAt(5), LAT]);
  assert.equal(stops[0].properties.lat, undefined);
});
