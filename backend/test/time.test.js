import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  serviceDayStart,
  inferServiceDate,
  localDateString,
  addDays,
  formatClock,
  formatServiceSeconds,
} from '../lib/time.js';

test('service day starts at local midnight on an ordinary day', () => {
  // Eastern Standard Time is UTC-5
  assert.equal(serviceDayStart('20261210'), Date.parse('2026-12-10T05:00:00Z'));
});

test('service day start is noon minus 12 hours on clock-change days', () => {
  // Clocks go back on 2026-11-01: noon EST is 17:00Z, so the service day
  // starts at 05:00Z even though local midnight was 04:00Z (EDT)
  assert.equal(serviceDayStart('20261101'), Date.parse('2026-11-01T05:00:00Z'));
  // Clocks go forward on 2027-03-14: noon EDT is 16:00Z
  assert.equal(serviceDayStart('20270314'), Date.parse('2027-03-14T04:00:00Z'));
});

test('local date follows the agency time zone, not UTC', () => {
  assert.equal(localDateString(Date.parse('2026-12-11T03:30:00Z')), '20261210');
  assert.equal(localDateString(Date.parse('2026-12-11T05:30:00Z')), '20261211');
});

test('addDays crosses month and year boundaries', () => {
  assert.equal(addDays('20261201', -1), '20261130');
  assert.equal(addDays('20261231', 1), '20270101');
});

test('a trip still in its after-midnight tail belongs to yesterday', () => {
  const lastArrival = 25 * 3600; // trip ends at 25:00:00
  // 00:30 on the 11th: still inside the trip that started on the 10th
  assert.equal(inferServiceDate(Date.parse('2026-12-11T05:30:00Z'), lastArrival), '20261210');
  // 18:00 on the 11th: tonight's run of the same trip
  assert.equal(inferServiceDate(Date.parse('2026-12-11T23:00:00Z'), lastArrival), '20261211');
  // A trip that never passes midnight always belongs to today
  assert.equal(inferServiceDate(Date.parse('2026-12-11T05:30:00Z'), 20 * 3600), '20261211');
});

test('times format as 12-hour clock', () => {
  assert.equal(formatServiceSeconds(18 * 3600 + 5 * 60), '6:05 PM');
  assert.equal(formatServiceSeconds(0), '12:00 AM');
  assert.equal(formatServiceSeconds(12 * 3600), '12:00 PM');
  // GTFS times past 24:00:00 wrap to the next morning
  assert.equal(formatServiceSeconds(25 * 3600 + 10 * 60), '1:10 AM');
  assert.equal(formatClock(Date.parse('2026-12-10T23:42:00Z')), '6:42 PM');
});
