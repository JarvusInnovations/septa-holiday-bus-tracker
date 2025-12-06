#!/bin/sh
set -e

# Check if GTFS data exists, download if missing
if [ ! -f "data/gtfs/trips.json" ]; then
  echo "GTFS data not found, downloading..."
  node bin/download-gtfs.js
  echo "GTFS data downloaded successfully"
fi

# Start the server
exec node index.js
