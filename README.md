# SEPTA Holiday Bus Tracker

Track SEPTA's decorated holiday buses in real-time across Philadelphia. See where they are now and where they're heading next.

## Repository Structure

```
├── backend/          # Fastify API server
│   ├── bin/          # Scripts (GTFS download)
│   ├── data/gtfs/    # Downloaded GTFS schedule data
│   └── lib/          # GTFS loader and route predictor
├── frontend/         # React + Vite web app with MapLibre GL
└── .tool-versions    # asdf version management
```

## Prerequisites

- [asdf](https://asdf-vm.com/) with nodejs plugin

## Quickstart

```bash
# Install Node.js via asdf
asdf install

# Download GTFS schedule data
cd backend
npm install
node bin/download-gtfs.js

# Start backend (in one terminal)
npm run dev

# Start frontend (in another terminal)
cd frontend
npm install
npm run dev
```

Open <http://localhost:5173> to view the map.

## Test Mode

To view test buses instead of holiday buses (useful for development when holiday buses aren't running), add `?test=true` to the URL:

<http://localhost:5173/?test=true>
