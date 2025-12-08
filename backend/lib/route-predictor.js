import { getTrip, getStopTimes, getStop, getShape, isServiceActiveOnDate } from './gtfs-loader.js';
import { getStopPrediction } from './trip-updates.js';

const PREDICTION_WINDOW_MINUTES = 30;

/**
 * Get seconds since midnight for a given Date object.
 */
function getSecondsOfDay(date) {
  return date.getHours() * 3600 + date.getMinutes() * 60 + date.getSeconds();
}

/**
 * Convert Unix timestamp to HH:MM:SS format string.
 */
function unixToTimeString(unixTimestamp) {
  const date = new Date(unixTimestamp * 1000);
  const hours = date.getHours().toString().padStart(2, '0');
  const minutes = date.getMinutes().toString().padStart(2, '0');
  const seconds = date.getSeconds().toString().padStart(2, '0');
  return `${hours}:${minutes}:${seconds}`;
}

/**
 * Calculate distance between two lat/lon points using Haversine formula.
 * Returns distance in meters.
 */
function haversineDistance(lat1, lon1, lat2, lon2) {
  const R = 6371000; // Earth's radius in meters
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * Find the closest shape point to the current vehicle position.
 */
function findClosestShapePoint(shapePoints, lat, lon) {
  let minDist = Infinity;
  let closestIdx = 0;

  for (let i = 0; i < shapePoints.length; i++) {
    const dist = haversineDistance(lat, lon, shapePoints[i].lat, shapePoints[i].lon);
    if (dist < minDist) {
      minDist = dist;
      closestIdx = i;
    }
  }

  return { index: closestIdx, distance: minDist };
}

/**
 * Get upcoming route information for a vehicle.
 *
 * @param {string} tripId - The GTFS trip_id from the realtime feed
 * @param {number} currentLat - Vehicle's current latitude
 * @param {number} currentLon - Vehicle's current longitude
 * @param {Date} currentTime - Current time
 * @returns {object|null} - Upcoming route data or null if trip not found
 */
export function getUpcomingRoute(tripId, currentLat, currentLon, currentTime) {
  const trip = getTrip(tripId);
  if (!trip) {
    return null;
  }

  // Verify this trip's service is active today
  if (!isServiceActiveOnDate(trip.serviceId, currentTime)) {
    return null;
  }

  const tripStopTimes = getStopTimes(tripId);
  if (!tripStopTimes || tripStopTimes.length === 0) {
    return null;
  }

  const currentSeconds = getSecondsOfDay(currentTime);
  const windowEndSeconds = currentSeconds + PREDICTION_WINDOW_MINUTES * 60;

  // Find upcoming stops within the time window
  const upcomingStops = [];
  for (const st of tripStopTimes) {
    // Use pre-computed arrivalSeconds from GTFS processing
    const scheduledArrivalSeconds = st.arrivalSeconds;

    // Skip stops with invalid arrival times
    if (scheduledArrivalSeconds == null) {
      continue;
    }

    // Check for real-time prediction
    const prediction = getStopPrediction(tripId, st.stopSequence);
    let effectiveArrivalSeconds = scheduledArrivalSeconds;
    let predictedArrivalTime = null;
    let arrivalDelay = null;
    let isRealTime = false;

    if (prediction) {
      if (prediction.arrivalTime != null) {
        // Use predicted arrival time (Unix timestamp)
        const predDate = new Date(prediction.arrivalTime * 1000);
        effectiveArrivalSeconds = getSecondsOfDay(predDate);
        predictedArrivalTime = unixToTimeString(prediction.arrivalTime);
        isRealTime = true;
      }
      if (prediction.arrivalDelay != null) {
        arrivalDelay = prediction.arrivalDelay;
        isRealTime = true;
        // If we have delay but no absolute time, calculate predicted time
        if (predictedArrivalTime == null) {
          effectiveArrivalSeconds = scheduledArrivalSeconds + prediction.arrivalDelay;
          const hours = Math.floor(effectiveArrivalSeconds / 3600) % 24;
          const minutes = Math.floor((effectiveArrivalSeconds % 3600) / 60);
          const seconds = effectiveArrivalSeconds % 60;
          predictedArrivalTime = `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
        }
      }
    }

    // Include stops arriving within the next 30 minutes (using effective/predicted time)
    // Also include the next stop even if it's slightly in the past (for context)
    if (effectiveArrivalSeconds >= currentSeconds - 60 && effectiveArrivalSeconds <= windowEndSeconds) {
      const stop = getStop(st.stopId);
      if (stop) {
        upcomingStops.push({
          stopId: st.stopId,
          name: stop.name,
          lat: stop.lat,
          lon: stop.lon,
          arrivalTime: st.arrivalTime,
          departureTime: st.departureTime,
          stopSequence: st.stopSequence,
          predictedArrivalTime,
          arrivalDelay,
          isRealTime,
        });
      }
    }
  }

  // Build the route geometry (GeoJSON LineString) for the upcoming segment
  let routeGeometry = null;
  if (trip.shapeId) {
    const shapePoints = getShape(trip.shapeId);
    if (shapePoints && shapePoints.length > 0) {
      // Find where on the shape the vehicle currently is
      const { index: currentShapeIdx } = findClosestShapePoint(
        shapePoints,
        currentLat,
        currentLon
      );

      // Find the shape point closest to the last upcoming stop
      let endShapeIdx = shapePoints.length - 1;
      if (upcomingStops.length > 0) {
        const lastStop = upcomingStops[upcomingStops.length - 1];
        const { index } = findClosestShapePoint(shapePoints, lastStop.lat, lastStop.lon);
        endShapeIdx = index;
      }

      // Extract the segment from current position to end
      // Only show route ahead of the bus, not behind it
      // If bus has passed the last upcoming stop, don't show a route line
      if (currentShapeIdx <= endShapeIdx) {
        const segmentPoints = shapePoints.slice(currentShapeIdx, endShapeIdx + 1);

        // Build GeoJSON LineString
        if (segmentPoints.length >= 2) {
          routeGeometry = {
            type: 'LineString',
            coordinates: segmentPoints.map((p) => [p.lon, p.lat]),
          };
        }
      }
    }
  }

  return {
    tripId,
    routeId: trip.routeId,
    headsign: trip.tripHeadsign,
    directionId: trip.directionId,
    upcomingStops,
    routeGeometry,
  };
}

/**
 * Build a GeoJSON FeatureCollection for multiple buses with their upcoming routes.
 *
 * @param {Array} buses - Array of bus position objects with tripId, lat, lon
 * @param {Date} currentTime - Current time
 * @returns {object} - GeoJSON FeatureCollection
 */
export function buildRoutesGeoJSON(buses, currentTime) {
  const features = [];

  for (const bus of buses) {
    if (!bus.tripId || bus.latitude == null || bus.longitude == null) {
      continue;
    }

    const route = getUpcomingRoute(bus.tripId, bus.latitude, bus.longitude, currentTime);
    if (!route) {
      continue;
    }

    // Add route line feature
    if (route.routeGeometry) {
      features.push({
        type: 'Feature',
        properties: {
          type: 'route',
          busId: bus.busId,
          color: bus.color,
          tripId: route.tripId,
          routeId: route.routeId,
          headsign: route.headsign,
        },
        geometry: route.routeGeometry,
      });
    }

    // Add stop features
    for (const stop of route.upcomingStops) {
      features.push({
        type: 'Feature',
        properties: {
          type: 'stop',
          busId: bus.busId,
          color: bus.color,
          stopId: stop.stopId,
          name: stop.name,
          arrivalTime: stop.arrivalTime,
          departureTime: stop.departureTime,
          predictedArrivalTime: stop.predictedArrivalTime,
          arrivalDelay: stop.arrivalDelay,
          isRealTime: stop.isRealTime,
          stopSequence: stop.stopSequence,
        },
        geometry: {
          type: 'Point',
          coordinates: [stop.lon, stop.lat],
        },
      });
    }
  }

  return {
    type: 'FeatureCollection',
    features,
  };
}
