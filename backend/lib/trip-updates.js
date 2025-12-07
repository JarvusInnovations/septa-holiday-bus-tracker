import GtfsRealtimeBindings from 'gtfs-realtime-bindings';

const SEPTA_TRIP_UPDATES_URL =
  'https://www3.septa.org/gtfsrt/septa-pa-us/Trip/rtTripUpdates.pb';

// Cache: Map<tripId, Map<stopSequence, StopTimeUpdate>>
let tripUpdatesCache = new Map();

/**
 * Fetch and cache GTFS-RT Trip Updates from SEPTA.
 * Call this in parallel with vehicle positions fetch.
 */
export async function fetchTripUpdates() {
  try {
    const response = await fetch(SEPTA_TRIP_UPDATES_URL);
    if (!response.ok) {
      throw new Error(`HTTP error: ${response.status}`);
    }

    const buffer = await response.arrayBuffer();
    const feed = GtfsRealtimeBindings.transit_realtime.FeedMessage.decode(
      new Uint8Array(buffer)
    );

    // Build fresh cache
    const newCache = new Map();

    for (const entity of feed.entity) {
      if (entity.tripUpdate?.trip?.tripId) {
        const tripId = entity.tripUpdate.trip.tripId;
        const stopUpdates = new Map();

        for (const stu of entity.tripUpdate.stopTimeUpdate || []) {
          // Use stopSequence as key (matches GTFS static data)
          const stopSequence = stu.stopSequence;
          if (stopSequence != null) {
            stopUpdates.set(stopSequence, {
              stopId: stu.stopId,
              arrivalTime: stu.arrival?.time ? Number(stu.arrival.time) : null,
              arrivalDelay: stu.arrival?.delay ?? null,
              departureTime: stu.departure?.time ? Number(stu.departure.time) : null,
              departureDelay: stu.departure?.delay ?? null,
            });
          }
        }

        if (stopUpdates.size > 0) {
          newCache.set(tripId, stopUpdates);
        }
      }
    }

    // Atomic cache replacement
    tripUpdatesCache = newCache;
    console.log(`[Trip Updates] Cached predictions for ${newCache.size} trips`);
  } catch (error) {
    console.error('Error fetching trip updates:', error.message);
    // Keep existing cache on error (graceful degradation)
  }
}

/**
 * Get all stop predictions for a trip.
 * @param {string} tripId
 * @returns {Map<number, StopTimeUpdate> | null}
 */
export function getTripUpdate(tripId) {
  return tripUpdatesCache.get(tripId) || null;
}

/**
 * Get prediction for a specific stop in a trip.
 * @param {string} tripId
 * @param {number} stopSequence
 * @returns {StopTimeUpdate | null}
 */
export function getStopPrediction(tripId, stopSequence) {
  return tripUpdatesCache.get(tripId)?.get(stopSequence) || null;
}
