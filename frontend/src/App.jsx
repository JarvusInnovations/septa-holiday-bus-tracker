import { useEffect, useRef } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import './App.css';

const PHILADELPHIA_CENTER = [-75.1652, 39.9526];
const MAP_DATA_API_URL = 'http://localhost:3000/api/map-data';
const POLL_INTERVAL_MS = 5000;

const EMPTY_GEOJSON = { type: 'FeatureCollection', features: [] };

function App() {
  const mapContainer = useRef(null);
  const map = useRef(null);
  const markers = useRef({});
  const intervalRef = useRef(null);

  useEffect(() => {
    if (map.current) return;

    map.current = new maplibregl.Map({
      container: mapContainer.current,
      style: 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json',
      center: PHILADELPHIA_CENTER,
      zoom: 11,
    });

    map.current.addControl(new maplibregl.NavigationControl(), 'top-right');

    map.current.on('load', () => {
      // Add GeoJSON source for routes
      map.current.addSource('routes', {
        type: 'geojson',
        data: EMPTY_GEOJSON,
      });

      // Route line layer
      map.current.addLayer({
        id: 'route-lines',
        type: 'line',
        source: 'routes',
        filter: ['==', ['get', 'type'], 'route'],
        paint: {
          'line-color': ['get', 'color'],
          'line-width': 4,
          'line-opacity': 0.6,
        },
      });

      // Stop markers as small colored circles (only visible when zoomed in)
      map.current.addLayer({
        id: 'route-stops',
        type: 'circle',
        source: 'routes',
        filter: ['==', ['get', 'type'], 'stop'],
        minzoom: 14,
        paint: {
          'circle-radius': 5,
          'circle-color': ['get', 'color'],
          'circle-stroke-color': '#ffffff',
          'circle-stroke-width': 1.5,
        },
      });

      // Data fetching function
      async function fetchData() {
        try {
          const response = await fetch(MAP_DATA_API_URL);
          const data = await response.json();

          if (!data.buses || !data.routes) {
            console.error('Invalid response: missing buses or routes');
            return;
          }

          // Update route lines and stops
          map.current.getSource('routes').setData(data.routes);

          // Update bus markers
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
                  background-color: ${bus.color || '#e53935'};
                  border: 2px solid white;
                  border-radius: 50%;
                  cursor: pointer;
                  box-shadow: 0 2px 4px rgba(0,0,0,0.3);
                `;

                const marker = new maplibregl.Marker({ element: el })
                  .setLngLat([bus.longitude, bus.latitude])
                  .setPopup(
                    new maplibregl.Popup().setHTML(
                      `<strong>Holiday Bus ${bus.busId}</strong><br/>Route ${bus.routeId || 'N/A'}`
                    )
                  )
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
          console.error('Error fetching data:', error);
        }
      }

      // Start fetching data now that map is ready
      fetchData();
      intervalRef.current = setInterval(fetchData, POLL_INTERVAL_MS);
    });

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, []);

  return <div ref={mapContainer} className="map-container" />;
}

export default App;
