import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { buildModeData } from '../lib/bus-positions.js';
import { parseFleet } from '../lib/fleet.js';
import { loadFixtures, LAT, lonAt } from './fixtures.js';

const NOW = Date.parse('2026-12-10T18:03:00-05:00');
const { vehicles: FLEET } = parseFleet({
  vehicles: [
    { id: '3019', district: 'Callowhill', name: 'Santa Paws' },
    { id: '9027', district: 'Elmwood' },
    { id: '4627', district: 'Germantown' },
  ],
});

const live = (busId, extra = {}) => ({
  busId,
  latitude: LAT,
  longitude: lonAt(3),
  timestamp: NOW / 1000 - 15,
  tripId: null,
  routeId: null,
  startDate: null,
  currentStopSequence: null,
  ...extra,
});
const reportingOf = (...vehicles) => new Map(vehicles.map((v) => [v.busId, v]));
const byId = (data, id) => data.vehicles.find((v) => v.id === id);
const marker = (data, id) => data.buses.features.find((f) => f.properties.busId === id);

beforeEach(loadFixtures);

test('a vehicle on a trip is in service, with its route and destination', () => {
  const data = buildModeData(
    FLEET,
    reportingOf(live('3019', { tripId: 'T1', routeId: '47', startDate: '20261210', currentStopSequence: 2 })),
    NOW
  );
  assert.deepEqual(byId(data, '3019'), {
    id: '3019',
    type: 'bus',
    district: 'Callowhill',
    name: 'Santa Paws',
    color: FLEET[0].color,
    status: 'in_service',
    routeId: '47',
    destination: 'Back to A',
    lastSeen: null,
  });
  assert.equal(marker(data, '3019').properties.vehicleType, 'bus');
  assert.ok(data.routes.features.length > 0);
});

test('a vehicle reporting without a trip is parked and still on the map', () => {
  const data = buildModeData(FLEET, reportingOf(live('9027')), NOW);
  assert.equal(byId(data, '9027').status, 'parked');
  assert.equal(byId(data, '9027').routeId, null);
  assert.deepEqual(marker(data, '9027').geometry.coordinates, [lonAt(3), LAT]);
  assert.equal(marker(data, '9027').properties.vehicleType, 'trolley');
  assert.equal(data.routes.features.length, 0);
});

test('routes are shown by the name riders know', () => {
  const data = buildModeData(FLEET, reportingOf(live('3019', { tripId: 'T3', routeId: 'N1_BUS' })), NOW);
  assert.equal(byId(data, '3019').routeId, 'N1');
});

test('a vehicle on a trip the schedule does not know is still in service', () => {
  const data = buildModeData(FLEET, reportingOf(live('3019', { tripId: 'mystery', routeId: '23' })), NOW);
  assert.equal(byId(data, '3019').status, 'in_service');
  assert.equal(byId(data, '3019').routeId, '23');
  assert.equal(byId(data, '3019').destination, null);
});

test('a vehicle never seen is listed but has no marker', () => {
  const data = buildModeData(FLEET, reportingOf(), NOW);
  assert.deepEqual(data.vehicles.map((v) => v.status), ['not_reporting', 'not_reporting', 'not_reporting']);
  assert.equal(data.buses.features.length, 0);
});

test('a vehicle that stops reporting stays on the map where it was last seen', () => {
  const memory = new Map();
  buildModeData(FLEET, reportingOf(live('4627')), NOW, memory);

  // Two hours later it has dropped out of the feed (switched off on display)
  const later = buildModeData(FLEET, reportingOf(), NOW + 2 * 3600 * 1000, memory);
  assert.equal(byId(later, '4627').status, 'last_seen');
  assert.equal(byId(later, '4627').lastSeen, '6:02 PM');
  assert.deepEqual(marker(later, '4627').geometry.coordinates, [lonAt(3), LAT]);

  // The next day it is forgotten
  const nextDay = buildModeData(FLEET, reportingOf(), NOW + 24 * 3600 * 1000, memory);
  assert.equal(byId(nextDay, '4627').status, 'not_reporting');
  assert.equal(marker(nextDay, '4627'), undefined);
});

test('an old position still in the feed is shown as last seen, with no route', () => {
  const data = buildModeData(
    FLEET,
    reportingOf(live('3019', { tripId: 'T1', startDate: '20261210', currentStopSequence: 2, timestamp: NOW / 1000 - 20 * 60 })),
    NOW
  );
  assert.equal(byId(data, '3019').status, 'last_seen');
  assert.equal(byId(data, '3019').lastSeen, '5:43 PM');
  assert.equal(byId(data, '3019').routeId, null);
  assert.equal(data.routes.features.length, 0);
});

test('a vehicle that comes back is live again', () => {
  const memory = new Map();
  buildModeData(FLEET, reportingOf(live('4627')), NOW, memory);
  buildModeData(FLEET, reportingOf(), NOW + 3600 * 1000, memory);
  const back = buildModeData(
    FLEET,
    reportingOf(live('4627', { timestamp: (NOW + 2 * 3600 * 1000) / 1000 })),
    NOW + 2 * 3600 * 1000,
    memory
  );
  assert.equal(byId(back, '4627').status, 'parked');
  assert.equal(byId(back, '4627').lastSeen, null);
});

test('vehicles outside the fleet are ignored', () => {
  const data = buildModeData(FLEET, reportingOf(live('7777', { tripId: 'T1' })), NOW);
  assert.equal(data.buses.features.length, 0);
  assert.equal(data.vehicles.length, 3);
});
