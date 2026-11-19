import { useEffect, useState } from 'react';

const POLL_INTERVAL_MS = 5000;
const REQUEST_TIMEOUT_MS = 10000;

/**
 * Poll the tracker API.
 *
 * Returns the latest good response (kept through failures, so the map never
 * blanks out) and how many requests in a row have failed. Polling pauses
 * while the tab is hidden and resumes with an immediate refresh.
 */
export default function useMapData(url) {
  const [data, setData] = useState(null);
  const [failures, setFailures] = useState(0);

  useEffect(() => {
    let stopped = false;
    let inFlight = false;
    let timer = null;
    let controller = null;

    async function tick() {
      if (stopped || inFlight) return;
      inFlight = true;
      controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

      try {
        const response = await fetch(url, { signal: controller.signal, cache: 'no-store' });
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        const json = await response.json();
        if (!json.buses || !json.routes || !Array.isArray(json.vehicles)) {
          throw new Error('Invalid response: missing buses, routes or vehicles');
        }
        if (!stopped) {
          setData(json);
          setFailures(0);
        }
      } catch (error) {
        if (!stopped) {
          console.error('Error fetching data:', error);
          setFailures((count) => count + 1);
        }
      } finally {
        clearTimeout(timeout);
        inFlight = false;
        if (!stopped && !document.hidden) {
          timer = setTimeout(tick, POLL_INTERVAL_MS);
        }
      }
    }

    function onVisibilityChange() {
      clearTimeout(timer);
      if (!document.hidden) {
        tick();
      }
    }

    tick();
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      stopped = true;
      clearTimeout(timer);
      controller?.abort();
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [url]);

  return { data, failures };
}
