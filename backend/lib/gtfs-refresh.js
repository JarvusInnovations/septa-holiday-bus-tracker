import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GTFS_URL, readGtfsMeta } from '../bin/download-gtfs.js';
import { loadGtfsData } from './gtfs-loader.js';
import { clearRouteCaches } from './route-predictor.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DOWNLOAD_SCRIPT = path.join(__dirname, '..', 'bin', 'download-gtfs.js');

const FIRST_CHECK_DELAY_MS = 60 * 1000;
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

let refreshing = false;

/** Has SEPTA published a different schedule file than the one we hold? */
async function hasNewSchedule() {
  const meta = await readGtfsMeta();
  if (!meta) return true;

  const response = await fetch(GTFS_URL, { method: 'HEAD', signal: AbortSignal.timeout(15000) });
  if (!response.ok) {
    throw new Error(`HTTP error: ${response.status}`);
  }

  const etag = response.headers.get('etag');
  const lastModified = response.headers.get('last-modified');
  if (etag && meta.etag) return etag !== meta.etag;
  if (lastModified && meta.lastModified) return lastModified !== meta.lastModified;
  return true;
}

// The download runs in its own process so parsing ~130MB of CSV doesn't
// compete with the server for memory or block it from answering requests
function runDownload() {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [DOWNLOAD_SCRIPT], { stdio: 'inherit' });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`download-gtfs exited with code ${code}`));
    });
  });
}

export async function refreshGtfsIfChanged() {
  if (refreshing) return;
  refreshing = true;
  try {
    if (!(await hasNewSchedule())) {
      return;
    }
    console.log('[GTFS] New schedule published, refreshing...');
    await runDownload();
    await loadGtfsData();
    clearRouteCaches();
    console.log('[GTFS] Schedule refreshed');
  } catch (error) {
    // Keep serving the schedule we already have
    console.error('[GTFS] Refresh failed:', error.message);
  } finally {
    refreshing = false;
  }
}

/** Check for a new schedule shortly after startup and then a few times a day. */
export function startGtfsRefresh() {
  setTimeout(refreshGtfsIfChanged, FIRST_CHECK_DELAY_MS).unref();
  setInterval(refreshGtfsIfChanged, CHECK_INTERVAL_MS).unref();
}
