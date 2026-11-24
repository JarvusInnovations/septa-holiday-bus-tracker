import { getTrip, getStopTimes, getStop, getShape, getNextTripInBlock } from './gtfs-loader.js';
import { getPredictedArrival } from './trip-updates.js';
import { serviceDayStart, inferServiceDate, formatServiceSeconds } from './time.js';

const PREDICTION_WINDOW_SECONDS = 30 * 60;

// Without a "current stop" from the feed, a stop this far in the past is treated as passed
const PASSED_GRACE_SECONDS = 120;

// How close a shape point must be to count as "the stop is here"
const STOP_MATCH_METERS = 50;
// Once matched, stop scanning after the shape has moved this much further away
const STOP_MATCH_GIVE_UP_METERS = 150;
// A stop further than this from the whole shape is ignored when placing later stops
const STOP_MAX_OFFSET_METERS = 250;
// Only draw a connector from the vehicle to the route when it's this close to it
const VEHICLE_CONNECT_METERS = 250;

const MAX_CACHED_PROJECTIONS = 500;
const stopProjectionCache = new Map();

export function clearRouteCaches() {
  stopProjectionCache.clear();
}

/** Fast flat-earth distance in meters; accurate enough at city scale. */
function distanceMeters(lat1, lon1, lat2, lon2) {
  const metersPerDegree = 111320;
  const dy = (lat2 - lat1) * metersPerDegree;
  const dx = (lon2 - lon1) * metersPerDegree * Math.cos(((lat1 + lat2) / 2) * (Math.PI / 180));
  return Math.sqrt(dx * dx + dy * dy);
}

function roundCoord(value) {
  return Math.round(value * 1e5) / 1e5;
}

/**
 * Find where each stop of a trip sits along its shape.
 *
 * Stops are matched in order, each one searched for only at or after the
 * previous stop's position. A plain "nearest point" search goes wrong on
 * routes that loop or double back along the same street, because a point on
 * the return leg can be just as close as the one on the outbound leg.
 *
 * @param {number[]} shape - flat [lat, lon, ...] array
 * @param {{lat: number, lon: number}[]} stops - in stop order (null entries allowed)
 * @returns {number[]} shape point index for each stop
 */
export function projectStopsOntoShape(shape, stops) {
  const pointCount = shape.length / 2;
  const indexes = [];
  let previous = 0;

  for (const stop of stops) {
    if (!stop) {
      indexes.push(previous);
      continue;
    }

    let best = previous;
    let bestDistance = Infinity;
    for (let i = previous; i < pointCount; i++) {
      const d = distanceMeters(stop.lat, stop.lon, shape[i * 2], shape[i * 2 + 1]);
      if (d < bestDistance) {
        bestDistance = d;
        best = i;
      } else if (bestDistance <= STOP_MATCH_METERS && d > bestDistance + STOP_MATCH_GIVE_UP_METERS) {
        // Found the stop and the shape has since moved well away from it
        break;
      }
    }

    if (bestDistance > STOP_MAX_OFFSET_METERS) {
      // Stop isn't near the shape at all; don't let it drag later stops forward
      indexes.push(previous);
    } else {
      indexes.push(best);
      previous = best;
    }
  }

  return indexes;
}

function getStopShapeIndexes(tripId, shape, stopTimes) {
  let indexes = stopProjectionCache.get(tripId);
  if (!indexes) {
    if (stopProjectionCache.size >= MAX_CACHED_PROJECTIONS) {
      stopProjectionCache.clear();
    }
    indexes = projectStopsOntoShape(
      shape,
      stopTimes.map((st) => getStop(st.stopId))
    );
    stopProjectionCache.set(tripId, indexes);
  }
  return indexes;
}

function nearestShapeIndex(shape, lat, lon, from, to) {
  let best = from;
  let bestDistance = Infinity;
  for (let i = from; i <= to; i++) {
    const d = distanceMeters(lat, lon, shape[i * 2], shape[i * 2 + 1]);
    if (d < bestDistance) {
      bestDistance = d;
      best = i;
    }
  }
  return { index: best, distance: bestDistance };
}

function shapeSlice(shape, from, to) {
  const coordinates = [];
  for (let i = from; i <= to; i++) {
    coordinates.push([roundCoord(shape[i * 2 + 1]), roundCoord(shape[i * 2])]);
  }
  return coordinates;
}

/**
 * Describe one stop of a trip relative to "now".
 * All times are seconds since the start of the trip's service day.
 */
function describeStop(tripId, stopTime, dayStartMs) {
  const scheduled = stopTime.arrivalSeconds;
  const predictedUnix = getPredictedArrival(tripId, stopTime.stopSequence);
  const predicted = predictedUnix != null ? predictedUnix - dayStartMs / 1000 : null;

  return {
    scheduled,
    predicted,
    // The time we actually expect the vehicle: live prediction when there is one
    effective: predicted ?? scheduled,
  };
}

function toStopFeatureData(stopTime, times, extra = {}) {
  const stop = getStop(stopTime.stopId);
  if (!stop) return null;

  return {
    stopId: stopTime.stopId,
    name: stop.name,
    lat: stop.lat,
    lon: stop.lon,
    stopSequence: stopTime.stopSequence,
    scheduledTime: times.scheduled != null ? formatServiceSeconds(times.scheduled) : null,
    predictedTime: times.predicted != null ? formatServiceSeconds(times.predicted) : null,
    delayMinutes:
      times.predicted != null && times.scheduled != null
        ? Math.round((times.predicted - times.scheduled) / 60)
        : null,
    isRealTime: times.predicted != null,
    ...extra,
  };
}

/**
 * The next trip in the vehicle's block, when the current trip finishes inside
 * the prediction window. Shown so "where is it heading next" still has an
 * answer as a bus reaches the end of the line.
 */
function getFollowingTrip(tripId, dayStartMs, nowSeconds, windowEnd) {
  const next = getNextTripInBlock(tripId);
  if (!next || next.start > windowEnd) return null;

  const trip = getTrip(next.tripId);
  const stopTimes = getStopTimes(next.tripId);
  if (!trip || !stopTimes) return null;

  const stops = [];
  let firstIndex = -1;
  let lastIndex = -1;
  for (let i = 0; i < stopTimes.length; i++) {
    const times = describeStop(next.tripId, stopTimes[i], dayStartMs);
    if (times.effective == null) continue;
    // The feed can keep a vehicle on a finished trip for a while; don't list
    // stops of the next trip that are already in the past
    if (times.effective < nowSeconds - PASSED_GRACE_SECONDS) continue;
    if (times.effective > windowEnd) break;

    const data = toStopFeatureData(stopTimes[i], times, { nextTripHeadsign: trip.headsign });
    if (data) {
      stops.push(data);
      if (firstIndex === -1) firstIndex = i;
      lastIndex = i;
    }
  }
  if (stops.length === 0) return null;

  let geometry = null;
  const shape = trip.shapeId ? getShape(trip.shapeId) : null;
  if (shape && lastIndex > firstIndex) {
    const indexes = getStopShapeIndexes(next.tripId, shape, stopTimes);
    const coordinates = shapeSlice(shape, indexes[firstIndex], indexes[lastIndex]);
    if (coordinates.length >= 2) {
      geometry = { type: 'LineString', coordinates };
    }
  }

  return { tripId: next.tripId, routeId: trip.routeId, headsign: trip.headsign, stops, geometry };
}

/**
 * Get upcoming route information for a vehicle on a trip.
 *
 * @param {object} vehicle
 * @param {string} vehicle.tripId - GTFS trip_id from the realtime feed
 * @param {number} vehicle.latitude
 * @param {number} vehicle.longitude
 * @param {number|null} [vehicle.currentStopSequence] - stop the vehicle is at or heading to
 * @param {string|null} [vehicle.startDate] - service date (YYYYMMDD) from the realtime feed
 * @param {number} nowMs - current time, epoch milliseconds
 * @returns {object|null} upcoming route data, or null if the trip isn't in the schedule
 */
export function getUpcomingRoute(vehicle, nowMs) {
  const { tripId } = vehicle;
  const trip = getTrip(tripId);
  if (!trip) {
    return null;
  }

  const stopTimes = getStopTimes(tripId);
  if (!stopTimes || stopTimes.length === 0) {
    return null;
  }

  // SEPTA's realtime feed is the authority on whether a trip is running. The
  // published schedule file often covers a period that hasn't started yet, so
  // its calendar is deliberately not consulted here.
  const lastArrival = stopTimes[stopTimes.length - 1].arrivalSeconds;
  const serviceDate = /^\d{8}$/.test(vehicle.startDate || '')
    ? vehicle.startDate
    : inferServiceDate(nowMs, lastArrival);
  const dayStartMs = serviceDayStart(serviceDate);
  const nowSeconds = (nowMs - dayStartMs) / 1000;
  const windowEnd = nowSeconds + PREDICTION_WINDOW_SECONDS;

  // Where the vehicle is in its stop list. The feed's own "current stop" is
  // best because it stays right when the bus is running late; otherwise fall
  // back to the clock.
  const described = stopTimes.map((st) => describeStop(tripId, st, dayStartMs));
  let firstIndex = -1;
  if (vehicle.currentStopSequence != null) {
    firstIndex = stopTimes.findIndex((st) => st.stopSequence >= vehicle.currentStopSequence);
  } else {
    firstIndex = described.findIndex(
      (times) => times.effective != null && times.effective >= nowSeconds - PASSED_GRACE_SECONDS
    );
  }
  if (firstIndex === -1) {
    firstIndex = stopTimes.length; // past the last stop
  }

  const upcomingStops = [];
  let lastIndex = -1;
  let latestSoFar = -Infinity;
  for (let i = firstIndex; i < stopTimes.length; i++) {
    const times = described[i];
    if (times.effective == null) continue;

    // A bus can't reach a stop before the one ahead of it, so a stop with no
    // prediction of its own is no earlier than the latest time seen so far
    latestSoFar = Math.max(latestSoFar, times.effective);
    if (latestSoFar > windowEnd) break;

    const data = toStopFeatureData(stopTimes[i], times);
    if (data) {
      upcomingStops.push(data);
      lastIndex = i;
    }
  }

  // Route line from the vehicle to the last upcoming stop
  let routeGeometry = null;
  const shape = trip.shapeId ? getShape(trip.shapeId) : null;
  if (shape && shape.length >= 4 && lastIndex !== -1) {
    const indexes = getStopShapeIndexes(tripId, shape, stopTimes);

    // The vehicle is somewhere between the stop it last passed and the one it's heading to
    const searchFrom = firstIndex > 0 ? indexes[firstIndex - 1] : 0;
    const searchTo = Math.max(indexes[firstIndex], searchFrom);
    const { index: vehicleIndex, distance } = nearestShapeIndex(
      shape,
      vehicle.latitude,
      vehicle.longitude,
      searchFrom,
      searchTo
    );

    const endIndex = indexes[lastIndex];
    if (endIndex >= vehicleIndex) {
      const coordinates = shapeSlice(shape, Math.min(vehicleIndex + 1, endIndex), endIndex);
      if (distance <= VEHICLE_CONNECT_METERS) {
        // Start the line at the vehicle itself so it visibly connects to the marker
        coordinates.unshift([roundCoord(vehicle.longitude), roundCoord(vehicle.latitude)]);
      }
      if (coordinates.length >= 2) {
        routeGeometry = { type: 'LineString', coordinates };
      }
    }
  }

  // If this trip ends inside the window, show the start of the next one too
  const endsInWindow = lastArrival != null && lastArrival <= windowEnd;
  const reachedEnd = lastIndex === stopTimes.length - 1 || firstIndex >= stopTimes.length;
  const nextTrip = endsInWindow || reachedEnd ? getFollowingTrip(tripId, dayStartMs, nowSeconds, windowEnd) : null;

  return {
    tripId,
    routeId: trip.routeId,
    headsign: trip.headsign,
    upcomingStops,
    routeGeometry,
    nextTrip,
  };
}

function stopFeature(vehicle, stop) {
  const { lat, lon, ...properties } = stop;
  return {
    type: 'Feature',
    properties: {
      type: 'stop',
      busId: vehicle.busId,
      color: vehicle.color,
      ...properties,
    },
    geometry: {
      type: 'Point',
      coordinates: [lon, lat],
    },
  };
}

/**
 * Build a GeoJSON FeatureCollection of upcoming route lines and stops.
 *
 * @param {Array} vehicles - vehicle records with tripId and a position
 * @param {number} nowMs - current time, epoch milliseconds
 * @returns {{geojson: object, trips: Map<string, object>}} the features, plus
 *   the route found for each vehicle id
 */
export function buildRoutesGeoJSON(vehicles, nowMs) {
  const features = [];
  const trips = new Map();

  for (const vehicle of vehicles) {
    if (!vehicle.tripId || vehicle.latitude == null || vehicle.longitude == null) {
      continue;
    }

    const route = getUpcomingRoute(vehicle, nowMs);
    if (!route) {
      continue;
    }
    trips.set(vehicle.busId, route);

    const lineProperties = { type: 'route', busId: vehicle.busId, color: vehicle.color };
    if (route.routeGeometry) {
      features.push({
        type: 'Feature',
        properties: { ...lineProperties, routeId: route.routeId, headsign: route.headsign },
        geometry: route.routeGeometry,
      });
    }
    for (const stop of route.upcomingStops) {
      features.push(stopFeature(vehicle, stop));
    }

    if (route.nextTrip) {
      if (route.nextTrip.geometry) {
        features.push({
          type: 'Feature',
          properties: {
            ...lineProperties,
            routeId: route.nextTrip.routeId,
            headsign: route.nextTrip.headsign,
            nextTrip: true,
          },
          geometry: route.nextTrip.geometry,
        });
      }
      for (const stop of route.nextTrip.stops) {
        features.push(stopFeature(vehicle, stop));
      }
    }
  }

  return {
    geojson: { type: 'FeatureCollection', features },
    trips,
  };
}
