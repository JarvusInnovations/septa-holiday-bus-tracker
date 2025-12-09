import { useEffect, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import SnowfallOverlay from './SnowfallOverlay';
import Sidebar from './Sidebar';
import './App.css';

const PHILADELPHIA_CENTER = [-75.1652, 39.9526];
const MAP_DATA_API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000/api/map-data';
const POLL_INTERVAL_MS = 5000;

const isTestMode = new URLSearchParams(window.location.search).get('test') === 'true';
const apiUrl = isTestMode ? `${MAP_DATA_API_URL}?test=true` : MAP_DATA_API_URL;

const EMPTY_GEOJSON = { type: 'FeatureCollection', features: [] };

const HOLIDAY_EMOJIS = ['🎅', '🎄', '🎁', '✨', '☃︎', '❄️', '🦌', '☃️', '🎀', '🕯️', '🎅🏼', '🤶'];

const CHRISTMAS_COLORS = ['#228b22', '#c41e3a']; // Green, Red

const SIDEBAR_STORAGE_KEY = 'festibus-sidebar-seen';

function getRandomEmojis() {
  const shuffled = [...HOLIDAY_EMOJIS].sort(() => Math.random() - 0.5);
  return [shuffled[0], shuffled[1]];
}

function App() {
  const [emojis] = useState(() => getRandomEmojis());
  const [sidebarOpen, setSidebarOpen] = useState(() => {
    return !localStorage.getItem(SIDEBAR_STORAGE_KEY);
  });

  const closeSidebar = () => {
    setSidebarOpen(false);
    localStorage.setItem(SIDEBAR_STORAGE_KEY, 'true');
  };
  const mapContainer = useRef(null);
  const map = useRef(null);
  const intervalRef = useRef(null);
  const hasInitialFit = useRef(false);
  const colorOffsetRef = useRef(0);
  const lightsIntervalRef = useRef(null);

  useEffect(() => {
    if (map.current) return;

    map.current = new maplibregl.Map({
      container: mapContainer.current,
      style: 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json',
      center: PHILADELPHIA_CENTER,
      zoom: 11,
    });

    map.current.addControl(new maplibregl.NavigationControl(), 'top-right');
    map.current.addControl(
      new maplibregl.GeolocateControl({
        positionOptions: {
          enableHighAccuracy: true,
        },
        trackUserLocation: true,
        showAccuracyCircle: true,
        showUserLocation: true
      }),
      'top-right'
    );

    map.current.on('load', () => {
      // Add GeoJSON source for buses
      map.current.addSource('buses', {
        type: 'geojson',
        data: EMPTY_GEOJSON,
      });

      // Load bus and trolley icons as SDF for dynamic coloring
      (async () => {
        try {
          const [busImage, trolleyImage] = await Promise.all([
            map.current.loadImage('/bus-icon.sdf.png'),
            map.current.loadImage('/trolley-icon.sdf.png'),
          ]);
          if (!map.current) return;

          map.current.addImage('bus-icon', busImage.data, { sdf: true });
          map.current.addImage('trolley-icon', trolleyImage.data, { sdf: true });

          // Vehicle markers layer using SDF icons
          map.current.addLayer({
            id: 'bus-markers',
            type: 'symbol',
            source: 'buses',
            layout: {
              'icon-image': [
                'match',
                ['get', 'vehicleType'],
                'trolley', 'trolley-icon',
                'bus-icon',
              ],
              'icon-size': 0.25,
              'icon-anchor': 'bottom',
              'icon-allow-overlap': true,
            },
            paint: {
              'icon-color': ['get', 'color'],
            },
          });
        } catch (e) {
          console.error('Error loading vehicle icons:', e);
        }
      })();

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

      // Glow effect layer (rendered behind the main stops)
      map.current.addLayer({
        id: 'route-stops-glow',
        type: 'circle',
        source: 'routes',
        filter: ['==', ['get', 'type'], 'stop'],
        minzoom: 13,
        paint: {
          'circle-radius': 20,
          'circle-color': [
            'match',
            ['%', ['get', 'stopSequence'], 2],
            0, CHRISTMAS_COLORS[0],
            CHRISTMAS_COLORS[1],
          ],
          'circle-blur': 1.2,
          'circle-opacity': 0.6,
        },
      });

      // Stop markers as festive ornaments (alternating red, green)
      map.current.addLayer({
        id: 'route-stops',
        type: 'circle',
        source: 'routes',
        filter: ['==', ['get', 'type'], 'stop'],
        minzoom: 13,
        paint: {
          'circle-radius': 8,
          'circle-color': [
            'match',
            ['%', ['get', 'stopSequence'], 2],
            0, CHRISTMAS_COLORS[0],
            CHRISTMAS_COLORS[1],
          ],
          'circle-stroke-color': '#ffffff',
          'circle-stroke-width': 2,
          'circle-opacity': 0.9,
        },
      });

      // Twinkling lights animation - cycle colors every 1000ms
      lightsIntervalRef.current = setInterval(() => {
        if (!map.current || !map.current.getLayer('route-stops')) return;

        colorOffsetRef.current = (colorOffsetRef.current + 1) % 2;
        const offset = colorOffsetRef.current;

        const colorExpr = [
          'match',
          ['%', ['get', 'stopSequence'], 2],
          0, CHRISTMAS_COLORS[(0 + offset) % 2],
          CHRISTMAS_COLORS[(1 + offset) % 2],
        ];

        map.current.setPaintProperty('route-stops', 'circle-color', colorExpr);
        map.current.setPaintProperty('route-stops-glow', 'circle-color', colorExpr);
      }, 1000);

      // Click handler for stop markers
      map.current.on('click', 'route-stops', (e) => {
        const feature = e.features[0];
        const props = feature.properties;
        const coordinates = feature.geometry.coordinates.slice();

        // Format time as 12-hour
        const formatTime = (timeStr) => {
          if (!timeStr) return '';
          const [hours, minutes] = timeStr.split(':');
          const h = parseInt(hours, 10);
          const period = h >= 12 ? 'PM' : 'AM';
          const hour12 = h % 12 || 12;
          return `${hour12}:${minutes} ${period}`;
        };

        // Build popup content based on real-time vs scheduled
        let popupContent = `<strong>${props.name}</strong><br/>`;

        if (props.isRealTime) {
          // Show real-time prediction
          const displayTime = props.predictedArrivalTime || props.arrivalTime;
          popupContent += `<span style="color: #e53935;">●</span> Live: ${formatTime(displayTime)}`;

          // Show delay info if available
          if (props.arrivalDelay != null) {
            const delayMinutes = Math.round(props.arrivalDelay / 60);
            if (delayMinutes > 0) {
              popupContent += ` <span style="color: #e53935;">(${delayMinutes} min late)</span>`;
            } else if (delayMinutes < 0) {
              popupContent += ` <span style="color: #43a047;">(${-delayMinutes} min early)</span>`;
            } else {
              popupContent += ` <span style="color: #43a047;">(on time)</span>`;
            }
          }
        } else {
          // Show scheduled time
          popupContent += `<span style="color: #757575;">○</span> Scheduled: ${formatTime(props.arrivalTime)}`;
        }

        new maplibregl.Popup()
          .setLngLat(coordinates)
          .setHTML(popupContent)
          .addTo(map.current);
      });

      // Change cursor on hover
      map.current.on('mouseenter', 'route-stops', () => {
        map.current.getCanvas().style.cursor = 'pointer';
      });
      map.current.on('mouseleave', 'route-stops', () => {
        map.current.getCanvas().style.cursor = '';
      });

      // Click handler for bus markers
      map.current.on('click', 'bus-markers', (e) => {
        const feature = e.features[0];
        const props = feature.properties;
        const coordinates = feature.geometry.coordinates.slice();

        let popupContent;
        if (isTestMode) {
          popupContent = `<strong>Test Bus ${props.busId}</strong><br/>Route ${props.routeId || 'N/A'}`;
        } else {
          popupContent = `<strong>${props.headsign || 'Holiday Bus'}</strong>`;
          if (props.district) {
            popupContent += `<br/>${props.district} District`;
          }
          popupContent += `<br/>Route ${props.routeId || 'N/A'}`;
        }

        new maplibregl.Popup({ offset: [0, -20] })
          .setLngLat(coordinates)
          .setHTML(popupContent)
          .addTo(map.current);
      });

      // Change cursor on hover for bus markers
      map.current.on('mouseenter', 'bus-markers', () => {
        map.current.getCanvas().style.cursor = 'pointer';
      });
      map.current.on('mouseleave', 'bus-markers', () => {
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

          // Update map sources with GeoJSON data
          map.current.getSource('routes').setData(data.routes);
          map.current.getSource('buses').setData(data.buses);

          // Auto-fit to all buses and route shapes on first load
          if (!hasInitialFit.current && data.buses.features.length > 0) {
            const bounds = new maplibregl.LngLatBounds();
            let hasValidBounds = false;

            // Include bus positions
            for (const feature of data.buses.features) {
              bounds.extend(feature.geometry.coordinates);
              hasValidBounds = true;
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
      if (lightsIntervalRef.current) {
        clearInterval(lightsIntervalRef.current);
      }
      // Clean up map
      if (map.current) {
        map.current.remove();
        map.current = null;
      }
    };
  }, []);

  return (
    <div className="app-container">
      <Sidebar isOpen={sidebarOpen} onClose={closeSidebar} />
      <SnowfallOverlay mapRef={map} />
      <header className="title-bar">
        <button
          className="sidebar-toggle-btn"
          onClick={() => setSidebarOpen(true)}
          aria-label="Open information sidebar"
        >
          i
        </button>
        <span className="title-text">{emojis[0]} Festibus Tracker {emojis[1]}</span>
        <div className="title-bar-spacer" />
      </header>
      <div ref={mapContainer} className="map-container" />
    </div>
  );
}

export default App;
