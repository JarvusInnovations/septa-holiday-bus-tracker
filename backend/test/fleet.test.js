import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseFleet, activeNotice, VEHICLE_COLORS } from '../lib/fleet.js';

test('an empty fleet is valid (coming soon mode)', () => {
  assert.deepEqual(parseFleet({ vehicles: [], notice: null }), { vehicles: [], notice: null });
});

test('vehicles get a type, color and null theme by default', () => {
  const { vehicles } = parseFleet({
    vehicles: [
      { id: 3416, district: 'Allegheny' },
      { id: '9027', district: 'Elmwood', name: 'Home Alone', color: '#123456' },
      { id: '4627', type: 'bus' },
    ],
  });
  assert.deepEqual(vehicles[0], {
    id: '3416', type: 'bus', district: 'Allegheny', name: null, color: VEHICLE_COLORS[0],
  });
  assert.equal(vehicles[1].type, 'trolley');
  assert.equal(vehicles[1].name, 'Home Alone');
  assert.equal(vehicles[1].color, '#123456');
  assert.equal(vehicles[2].district, null);
});

test('bad fleet config is rejected', () => {
  assert.throws(() => parseFleet(null), /vehicles/);
  assert.throws(() => parseFleet({ vehicles: 'nope' }), /vehicles/);
  assert.throws(() => parseFleet({ vehicles: [{ district: 'Comly' }] }), /no id/);
  assert.throws(() => parseFleet({ vehicles: [{ id: '1' }, { id: 1 }] }), /listed twice/);
  assert.throws(() => parseFleet({ vehicles: [{ id: '1', type: 'sleigh' }] }), /unknown type/);
  assert.throws(() => parseFleet({ vehicles: [], notice: { text: 'x', endsAt: 'soon' } }), /invalid/);
});

test('a notice only shows inside its date window', () => {
  const fleet = parseFleet({
    vehicles: [],
    notice: {
      text: 'See them all at Love Park tonight',
      startsAt: '2026-12-05T12:00:00-05:00',
      endsAt: '2026-12-05T21:00:00-05:00',
    },
  });
  assert.equal(activeNotice(fleet, Date.parse('2026-12-05T11:00:00-05:00')), null);
  assert.equal(activeNotice(fleet, Date.parse('2026-12-05T18:00:00-05:00')), 'See them all at Love Park tonight');
  assert.equal(activeNotice(fleet, Date.parse('2026-12-05T22:00:00-05:00')), null);

  // A plain string or a notice without dates always shows
  assert.equal(activeNotice(parseFleet({ vehicles: [], notice: 'Hello' }), 0), 'Hello');
  assert.equal(activeNotice(parseFleet({ vehicles: [] }), 0), null);
});
