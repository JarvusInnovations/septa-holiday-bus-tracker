import { useEffect, useRef } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import './App.css';

const PHILADELPHIA_CENTER = [-75.1652, 39.9526];
const API_URL = 'http://localhost:3000/api/buses';
const POLL_INTERVAL_MS = 5000;

function App() {
  const mapContainer = useRef(null);
  const map = useRef(null);
  const markers = useRef({});

  useEffect(() => {
    if (map.current) return;

    map.current = new maplibregl.Map({
      container: mapContainer.current,
      style: 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json',
      center: PHILADELPHIA_CENTER,
      zoom: 11,
    });

    map.current.addControl(new maplibregl.NavigationControl(), 'top-right');
  }, []);

  useEffect(() => {
    async function fetchBuses() {
      try {
        const response = await fetch(API_URL);
        const data = await response.json();

        const currentBusIds = new Set();

        for (const bus of data.buses) {
          currentBusIds.add(bus.busId);

          if (bus.latitude && bus.longitude) {
            if (markers.current[bus.busId]) {
              markers.current[bus.busId].setLngLat([bus.longitude, bus.latitude]);
            } else {
              const el = document.createElement('div');
              el.className = 'bus-marker';
              el.style.cssText = `
                width: 24px;
                height: 24px;
                background-color: #e53935;
                border: 2px solid white;
                border-radius: 50%;
                cursor: pointer;
                box-shadow: 0 2px 4px rgba(0,0,0,0.3);
              `;

              const marker = new maplibregl.Marker({ element: el })
                .setLngLat([bus.longitude, bus.latitude])
                .setPopup(new maplibregl.Popup().setHTML(`<strong>Holiday Bus ${bus.busId}</strong>`))
                .addTo(map.current);

              markers.current[bus.busId] = marker;
            }
          }
        }

        // Remove markers for buses no longer in the feed
        for (const busId of Object.keys(markers.current)) {
          if (!currentBusIds.has(busId)) {
            markers.current[busId].remove();
            delete markers.current[busId];
          }
        }
      } catch (error) {
        console.error('Error fetching buses:', error);
      }
    }

    fetchBuses();
    const interval = setInterval(fetchBuses, POLL_INTERVAL_MS);

    return () => clearInterval(interval);
  }, []);

  return <div ref={mapContainer} className="map-container" />;
}

export default App;
