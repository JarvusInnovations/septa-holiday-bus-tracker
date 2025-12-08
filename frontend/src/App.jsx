import { useEffect, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import SnowfallOverlay from './SnowfallOverlay';
import './App.css';

const PHILADELPHIA_CENTER = [-75.1652, 39.9526];
const MAP_DATA_API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000/api/map-data';
const POLL_INTERVAL_MS = 5000;

const isTestMode = new URLSearchParams(window.location.search).get('test') === 'true';
const apiUrl = isTestMode ? `${MAP_DATA_API_URL}?test=true` : MAP_DATA_API_URL;

const EMPTY_GEOJSON = { type: 'FeatureCollection', features: [] };

const HOLIDAY_EMOJIS = ['🎅', '🎄', '🎁', '✨', '☃︎', '❄️', '🦌', '☃️', '🎀', '🕯️', '🎅🏼', '🤶'];

const CHRISTMAS_COLORS = ['#228b22', '#c41e3a']; // Green, Red
const PROXIMITY_THRESHOLD_METERS = 250; // ~2-3 city blocks

// Haversine formula to calculate distance between two lat/lng points in meters
function getDistanceMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000; // Earth's radius in meters
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function getRandomEmojis() {
  const shuffled = [...HOLIDAY_EMOJIS].sort(() => Math.random() - 0.5);
  return [shuffled[0], shuffled[1]];
}

function App() {
  const [emojis] = useState(() => getRandomEmojis());
  const [soundEnabled, setSoundEnabled] = useState(false);
  const [audioUnlocked, setAudioUnlocked] = useState(false);
  const [busNearby, setBusNearby] = useState(false);
  const mapContainer = useRef(null);
  const map = useRef(null);
  const markers = useRef({});
  const intervalRef = useRef(null);
  const hasInitialFit = useRef(false);
  const colorOffsetRef = useRef(0);
  const lightsIntervalRef = useRef(null);
  const userMarkerRef = useRef(null);
  const userLocationRef = useRef({ lng: PHILADELPHIA_CENTER[0], lat: PHILADELPHIA_CENTER[1] });
  const audioRef = useRef(null);
  const busesInRangeRef = useRef(new Set()); // Track buses that have triggered sound
  const soundEnabledRef = useRef(false);

  useEffect(() => {
    if (map.current) return;

    map.current = new maplibregl.Map({
      container: mapContainer.current,
      style: 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json',
      center: PHILADELPHIA_CENTER,
      zoom: 11,
    });

    map.current.addControl(new maplibregl.NavigationControl(), 'top-right');

    // Initialize audio element
    audioRef.current = new Audio('/sounds/bells.mp3');
    audioRef.current.volume = 0.5;

    map.current.on('load', () => {
      // Add draggable "You Are Here" marker
      const userEl = document.createElement('div');
      userEl.innerHTML = '📍';
      userEl.style.cssText = `
        font-size: 32px;
        cursor: grab;
        filter: drop-shadow(0 2px 4px rgba(0,0,0,0.3));
      `;

      userMarkerRef.current = new maplibregl.Marker({
        element: userEl,
        draggable: true,
      })
        .setLngLat([userLocationRef.current.lng, userLocationRef.current.lat])
        .addTo(map.current);

      userMarkerRef.current.on('dragend', () => {
        const lngLat = userMarkerRef.current.getLngLat();
        userLocationRef.current = { lng: lngLat.lng, lat: lngLat.lat };
      });
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

          // Check proximity to user location
          const userLoc = userLocationRef.current;
          const currentBusesInRange = new Set();
          let anyBusNearby = false;

          for (const bus of data.buses) {
            if (bus.latitude && bus.longitude) {
              const distance = getDistanceMeters(
                userLoc.lat, userLoc.lng,
                bus.latitude, bus.longitude
              );

              if (distance <= PROXIMITY_THRESHOLD_METERS) {
                anyBusNearby = true;
                currentBusesInRange.add(bus.busId);

                // Play sound if this bus just entered range and sound is enabled
                if (!busesInRangeRef.current.has(bus.busId) && soundEnabledRef.current && audioRef.current) {
                  audioRef.current.currentTime = 0;
                  audioRef.current.play().catch(() => {});
                }
              }
            }
          }

          // Update state for title bar glow
          setBusNearby(anyBusNearby);

          // Update the set of buses in range (for next check)
          busesInRangeRef.current = currentBusesInRange;

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
      if (lightsIntervalRef.current) {
        clearInterval(lightsIntervalRef.current);
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

  const unlockAudio = () => {
    if (audioRef.current) {
      // Play a short preview to unlock audio context
      audioRef.current.volume = 0.3;
      audioRef.current.currentTime = 0;
      audioRef.current.play().catch(() => {});
      setTimeout(() => {
        if (audioRef.current) audioRef.current.volume = 0.5;
      }, 1000);
    }
    setAudioUnlocked(true);
    setSoundEnabled(true);
    soundEnabledRef.current = true;
  };

  const toggleSound = () => {
    const newValue = !soundEnabled;
    setSoundEnabled(newValue);
    soundEnabledRef.current = newValue;
  };

  return (
    <div className="app-container">
      {!audioUnlocked && (
        <div className="audio-unlock-overlay" onClick={unlockAudio}>
          <div className="audio-unlock-content">
            <div className="audio-unlock-icon">🔔</div>
            <div className="audio-unlock-text">Tap to enable sound alerts</div>
            <div className="audio-unlock-subtext">Get notified when a Festibus is nearby!</div>
          </div>
        </div>
      )}
      <SnowfallOverlay mapRef={map} />
      <header className="title-bar">
        <span className="title-text">{emojis[0]} Festibus Tracker {emojis[1]}</span>
        {audioUnlocked && (
          <button
            className={`sound-toggle ${soundEnabled ? 'sound-on' : ''}`}
            onClick={toggleSound}
            title={soundEnabled ? 'Disable jingle alerts' : 'Enable jingle alerts'}
          >
            {soundEnabled ? '🔔' : '🔕'}
          </button>
        )}
      </header>
      {busNearby && (
        <div className="nearby-pill">
          🎄 Festibus nearby! 🎄
        </div>
      )}
      <div ref={mapContainer} className="map-container" />
    </div>
  );
}

export default App;
