import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// The decorated fleet lives in one JSON file, the single source for both the
// tracker and the list shown in the sidebar. Set FLEET_FILE to point at a
// different copy (e.g. a mounted ConfigMap) to change the fleet without a
// rebuild; edits are picked up without a restart.
const FLEET_FILE = process.env.FLEET_FILE || path.join(__dirname, '..', 'config', 'fleet.json');

// Marker colors, handed out in order to vehicles that don't specify one
export const VEHICLE_COLORS = [
  '#e53935', '#43a047', '#1e88e5', '#fdd835', '#8e24aa',
  '#00897b', '#f4511e', '#c2185b', '#78909c', '#7cb342',
  '#26c6da',
];

const EMPTY_FLEET = { vehicles: [], notice: null };

let cached = EMPTY_FLEET;
let cachedMtimeMs = null;

/** SEPTA trolley numbers are in the 9000s; everything else we track is a bus. */
export function guessVehicleType(id) {
  return String(id).startsWith('9') ? 'trolley' : 'bus';
}

/**
 * Validate and normalize fleet config.
 *
 * @param {object} raw - parsed fleet.json
 * @returns {{vehicles: object[], notice: object|null}}
 */
export function parseFleet(raw) {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.vehicles)) {
    throw new Error('fleet config must be an object with a "vehicles" array');
  }

  const seen = new Set();
  const vehicles = raw.vehicles.map((entry, index) => {
    const id = entry?.id != null ? String(entry.id).trim() : '';
    if (!id) {
      throw new Error(`fleet vehicle #${index + 1} has no id`);
    }
    if (seen.has(id)) {
      throw new Error(`fleet vehicle ${id} is listed twice`);
    }
    seen.add(id);

    const type = entry.type || guessVehicleType(id);
    if (type !== 'bus' && type !== 'trolley') {
      throw new Error(`fleet vehicle ${id} has unknown type "${type}"`);
    }

    return {
      id,
      type,
      district: entry.district || null,
      // The decoration theme; may not be announced yet
      name: entry.name || null,
      color: entry.color || VEHICLE_COLORS[index % VEHICLE_COLORS.length],
    };
  });

  let notice = null;
  if (raw.notice) {
    const text = typeof raw.notice === 'string' ? raw.notice : raw.notice.text;
    if (text) {
      notice = {
        text: String(text),
        startsAt: raw.notice.startsAt ? Date.parse(raw.notice.startsAt) : null,
        endsAt: raw.notice.endsAt ? Date.parse(raw.notice.endsAt) : null,
      };
      if (Number.isNaN(notice.startsAt) || Number.isNaN(notice.endsAt)) {
        throw new Error('fleet notice has an invalid startsAt or endsAt date');
      }
    }
  }

  return { vehicles, notice };
}

/** The notice text to show right now, if one is set and currently in effect. */
export function activeNotice(fleet, nowMs) {
  const notice = fleet.notice;
  if (!notice) return null;
  if (notice.startsAt != null && nowMs < notice.startsAt) return null;
  if (notice.endsAt != null && nowMs > notice.endsAt) return null;
  return notice.text;
}

/**
 * The current fleet. Re-reads the file when it changes; if an edit is
 * invalid the last good fleet stays in effect.
 */
export function getFleet() {
  try {
    const { mtimeMs } = statSync(FLEET_FILE);
    if (mtimeMs !== cachedMtimeMs) {
      cachedMtimeMs = mtimeMs;
      cached = parseFleet(JSON.parse(readFileSync(FLEET_FILE, 'utf-8')));
      console.log(`[Fleet] Loaded ${cached.vehicles.length} vehicles from ${FLEET_FILE}`);
    }
  } catch (error) {
    console.error(`[Fleet] Could not load ${FLEET_FILE}: ${error.message}`);
  }
  return cached;
}
