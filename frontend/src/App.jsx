import { useEffect, useRef } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import './App.css';

const PHILADELPHIA_CENTER = [-75.1652, 39.9526];
const BUSES_API_URL = 'http://localhost:3000/api/buses';
const ROUTES_API_URL = 'http://localhost:3000/api/routes';
const POLL_INTERVAL_MS = 5000;

const EMPTY_GEOJSON = { type: 'FeatureCollection', features: [] };

function App() {
  const mapContainer = useRef(null);
  const map = useRef(null);
  const markers = useRef({});
  const mapLoaded = useRef(false);

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

      // Add route lines layer - color from feature properties
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

      // Add stops layer - color from feature properties
      map.current.addLayer({
        id: 'route-stops',
        type: 'circle',
        source: 'routes',
        filter: ['==', ['get', 'type'], 'stop'],
        paint: {
          'circle-radius': 6,
          'circle-color': '#ffffff',
          'circle-stroke-color': ['get', 'color'],
          'circle-stroke-width': 2,
        },
      });

      mapLoaded.current = true;
    });
  }, []);

  useEffect(() => {
    async function fetchData() {
      try {
        // Fetch buses and routes in parallel
        const [busesResponse, routesResponse] = await Promise.all([
          fetch(BUSES_API_URL),
          fetch(ROUTES_API_URL),
        ]);

        const busesData = await busesResponse.json();
        const routesData = await routesResponse.json();

        // Update route lines and stops
        if (mapLoaded.current && map.current.getSource('routes')) {
          map.current.getSource('routes').setData(routesData);
        }

        // Update bus markers
        const currentBusIds = new Set();

        for (const bus of busesData.buses) {
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

    fetchData();
    const interval = setInterval(fetchData, POLL_INTERVAL_MS);

    return () => clearInterval(interval);
  }, []);

  return <div ref={mapContainer} className="map-container" />;
}

export default App;
