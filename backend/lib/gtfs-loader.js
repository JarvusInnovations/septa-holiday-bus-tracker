import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', 'data', 'gtfs');

let trips = null;
let stopTimes = null;
let stops = null;
let shapes = null;
let calendar = null;
let calendarDates = null;

export async function loadGtfsData() {
  console.log('Loading GTFS data into memory...');

  const [tripsData, stopTimesData, stopsData, shapesData, calendarData, calendarDatesData] =
    await Promise.all([
      readFile(path.join(DATA_DIR, 'trips.json'), 'utf-8'),
      readFile(path.join(DATA_DIR, 'stop_times.json'), 'utf-8'),
      readFile(path.join(DATA_DIR, 'stops.json'), 'utf-8'),
      readFile(path.join(DATA_DIR, 'shapes.json'), 'utf-8'),
      readFile(path.join(DATA_DIR, 'calendar.json'), 'utf-8'),
      readFile(path.join(DATA_DIR, 'calendar_dates.json'), 'utf-8'),
    ]);

  trips = JSON.parse(tripsData);
  stopTimes = JSON.parse(stopTimesData);
  stops = JSON.parse(stopsData);
  shapes = JSON.parse(shapesData);
  calendar = JSON.parse(calendarData);
  calendarDates = JSON.parse(calendarDatesData);

  console.log(
    `  Loaded: ${Object.keys(trips).length} trips, ${Object.keys(stops).length} stops, ${Object.keys(shapes).length} shapes`
  );
}

export function getTrip(tripId) {
  return trips?.[tripId] ?? null;
}

export function getStopTimes(tripId) {
  return stopTimes?.[tripId] ?? null;
}

export function getStop(stopId) {
  return stops?.[stopId] ?? null;
}

export function getShape(shapeId) {
  return shapes?.[shapeId] ?? null;
}

export function getCalendar(serviceId) {
  return calendar?.[serviceId] ?? null;
}

export function getCalendarDates(serviceId) {
  return calendarDates?.[serviceId] ?? null;
}

export function isServiceActiveOnDate(serviceId, date) {
  const cal = calendar?.[serviceId];
  if (!cal) return false;

  // Check date range
  const dateStr = formatDate(date);
  if (dateStr < cal.startDate || dateStr > cal.endDate) {
    return false;
  }

  // Check calendar_dates exceptions
  const exceptions = calendarDates?.[serviceId];
  if (exceptions) {
    for (const exc of exceptions) {
      if (exc.date === dateStr) {
        // 1 = service added, 2 = service removed
        return exc.exceptionType === 1;
      }
    }
  }

  // Check day of week
  const dayOfWeek = date.getDay();
  const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  return cal[days[dayOfWeek]];
}

function formatDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}${month}${day}`;
}
