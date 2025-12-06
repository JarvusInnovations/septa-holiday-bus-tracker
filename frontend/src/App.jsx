import { useEffect, useRef } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import './App.css';

const PHILADELPHIA_CENTER = [-75.1652, 39.9526];
const MAP_DATA_API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000/api/map-data';
const POLL_INTERVAL_MS = 5000;

const isTestMode = new URLSearchParams(window.location.search).get('test') === 'true';
const apiUrl = isTestMode ? `${MAP_DATA_API_URL}?test=true` : MAP_DATA_API_URL;

const EMPTY_GEOJSON = { type: 'FeatureCollection', features: [] };

function App() {
  const mapContainer = useRef(null);
  const map = useRef(null);
  const markers = useRef({});
  const intervalRef = useRef(null);
  const hasInitialFit = useRef(false);

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

      // Click handler for stop markers
      map.current.on('click', 'route-stops', (e) => {
        const feature = e.features[0];
        const props = feature.properties;
        const coordinates = feature.geometry.coordinates.slice();

        // Format time as 12-hour
        const formatTime = (timeStr) => {
          const [hours, minutes] = timeStr.split(':');
          const h = parseInt(hours, 10);
          const period = h >= 12 ? 'PM' : 'AM';
          const hour12 = h % 12 || 12;
          return `${hour12}:${minutes} ${period}`;
        };

        new maplibregl.Popup()
          .setLngLat(coordinates)
          .setHTML(
            `<strong>${props.name}</strong><br/>` +
            `Scheduled arrival: ${formatTime(props.arrivalTime)}`
          )
          .addTo(map.current);
      });

      // Change cursor on hover
      map.current.on('mouseenter', 'route-stops', () => {
        map.current.getCanvas().style.cursor = 'pointer';
      });
      map.current.on('mouseleave', 'route-stops', () => {
        map.current.getCanvas().style.cursor = '';
      });

      // Data fetching function
      async function fetchData() {
        try {
          const response = await fetch(apiUrl);
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
                      `<strong>${isTestMode ? 'Test' : 'Holiday'} Bus ${bus.busId}</strong><br/>Route ${bus.routeId || 'N/A'}`
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

          // Auto-fit to all buses and route shapes on first load
          if (!hasInitialFit.current && data.buses.length > 0) {
            const bounds = new maplibregl.LngLatBounds();
            let hasValidBounds = false;

            // Include bus positions
            for (const bus of data.buses) {
              if (bus.latitude && bus.longitude) {
                bounds.extend([bus.longitude, bus.latitude]);
                hasValidBounds = true;
              }
            }

            // Include route shape coordinates
            for (const feature of data.routes.features) {
              if (feature.geometry.type === 'LineString') {
                for (const coord of feature.geometry.coordinates) {
                  bounds.extend(coord);
                  hasValidBounds = true;
                }
              } else if (feature.geometry.type === 'Point') {
                bounds.extend(feature.geometry.coordinates);
                hasValidBounds = true;
              }
            }

            if (hasValidBounds) {
              map.current.fitBounds(bounds, { padding: 50 });
              hasInitialFit.current = true;
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
      // Clean up markers
      Object.values(markers.current).forEach((marker) => marker.remove());
      markers.current = {};
      // Clean up map
      if (map.current) {
        map.current.remove();
        map.current = null;
      }
    };
  }, []);

  return <div ref={mapContainer} className="map-container" />;
}

export default App;
