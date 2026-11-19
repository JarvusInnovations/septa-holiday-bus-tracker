import GtfsRealtimeBindings from 'gtfs-realtime-bindings';

const SEPTA_TRIP_UPDATES_URL =
  'https://www3.septa.org/gtfsrt/septa-pa-us/Trip/rtTripUpdates.pb';
const FETCH_TIMEOUT_MS = 10000;

// Cache: Map<tripId, Map<stopSequence, arrivalTime (Unix seconds)>>
let tripUpdatesCache = new Map();

/** Build the prediction cache from a decoded GTFS-RT trip updates feed. */
export function setTripUpdatesFromFeed(feed) {
  const newCache = new Map();

  for (const entity of feed.entity || []) {
    const tripId = entity.tripUpdate?.trip?.tripId;
    if (!tripId) continue;

    const stopUpdates = new Map();
    for (const stu of entity.tripUpdate.stopTimeUpdate || []) {
      // SEPTA sends absolute arrival times and never a delay; delays are
      // worked out against the schedule in route-predictor.js
      const arrivalTime = stu.arrival?.time ? Number(stu.arrival.time) : null;
      if (stu.stopSequence != null && arrivalTime) {
        stopUpdates.set(stu.stopSequence, arrivalTime);
      }
    }

    if (stopUpdates.size > 0) {
      newCache.set(tripId, stopUpdates);
    }
  }

  // Atomic cache replacement
  tripUpdatesCache = newCache;
  return newCache.size;
}

/**
 * Fetch and cache GTFS-RT Trip Updates from SEPTA.
 * Never throws: on failure the previous predictions are kept.
 */
export async function fetchTripUpdates() {
  try {
    const response = await fetch(SEPTA_TRIP_UPDATES_URL, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!response.ok) {
      throw new Error(`HTTP error: ${response.status}`);
    }

    const buffer = await response.arrayBuffer();
    const feed = GtfsRealtimeBindings.transit_realtime.FeedMessage.decode(
      new Uint8Array(buffer)
    );
    setTripUpdatesFromFeed(feed);
  } catch (error) {
    console.error('Error fetching trip updates:', error.message);
  }
}

/**
 * Predicted arrival (Unix seconds) at a stop of a trip, or null if SEPTA
 * has no live prediction for it.
 */
export function getPredictedArrival(tripId, stopSequence) {
  return tripUpdatesCache.get(tripId)?.get(stopSequence) ?? null;
}
