import { useCallback, useEffect, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import SnowfallOverlay from './SnowfallOverlay';
import Sidebar from './Sidebar';
import ComingSoon from './ComingSoon';
import StatusBanner from './StatusBanner';
import useMapData from './useMapData';
import { busPopupContent, stopPopupContent } from './popups';
import './App.css';

const PHILADELPHIA_CENTER = [-75.1652, 39.9526];
const MAP_DATA_API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000/api/map-data';

const isTestMode = new URLSearchParams(window.location.search).get('test') === 'true';
const apiUrl = isTestMode ? `${MAP_DATA_API_URL}?test=true` : MAP_DATA_API_URL;

const EMPTY_GEOJSON = { type: 'FeatureCollection', features: [] };

const HOLIDAY_EMOJIS = ['🎅', '🎄', '🎁', '✨', '☃︎', '❄️', '🦌', '☃️', '🎀', '🕯️', '🎅🏼', '🤶'];

const CHRISTMAS_COLORS = ['#228b22', '#c41e3a']; // Green, Red

const SIDEBAR_STORAGE_KEY = 'festibus-sidebar-seen';

// Parked vehicles are drawn a little fainter than ones in service, and ones
// that have stopped reporting fainter still
const VEHICLE_OPACITY = [
  'match',
  ['get', 'status'],
  'in_service', 1,
  'parked', 0.85,
  0.55,
];

// Room for the banner along the top and the map controls on the right
const FIT_PADDING = { top: 110, bottom: 50, left: 50, right: 70 };

const FOCUS_ZOOM = 14;

function getRandomEmojis() {
  const shuffled = [...HOLIDAY_EMOJIS].sort(() => Math.random() - 0.5);
  return [shuffled[0], shuffled[1]];
}

// Storage can be unavailable (some private browsing modes); the welcome
// sidebar just shows again next time if so
function hasSeenSidebar() {
  try {
    return Boolean(localStorage.getItem(SIDEBAR_STORAGE_KEY));
  } catch {
    return false;
  }
}

function markSidebarSeen() {
  try {
    localStorage.setItem(SIDEBAR_STORAGE_KEY, 'true');
  } catch {
    // Nothing to do
  }
}

function stopColorExpression(offset) {
  return [
    'match',
    ['%', ['get', 'stopSequence'], 2],
    0, CHRISTMAS_COLORS[offset % 2],
    CHRISTMAS_COLORS[(1 + offset) % 2],
  ];
}

function App() {
  const [emojis] = useState(() => getRandomEmojis());
  const { data, failures } = useMapData(apiUrl);

  // The map, once its style has loaded and our layers are in place
  const [map, setMap] = useState(null);
  const mapContainer = useRef(null);
  const dataRef = useRef(null);
  const hasInitialFit = useRef(false);
  // The open vehicle popup, kept so it can follow the vehicle as it moves
  const busPopupRef = useRef(null);

  const comingSoon = Boolean(data?.comingSoon);

  // null until the visitor opens or closes the sidebar themselves. Until
  // then first-time visitors get it opened for them once the fleet is live.
  const [sidebarChoice, setSidebarChoice] = useState(null);
  const [sidebarSeen] = useState(hasSeenSidebar);
  const sidebarOpen = sidebarChoice ?? (data != null && !comingSoon && !sidebarSeen);

  const closeSidebar = useCallback(() => {
    setSidebarChoice(false);
    // Don't count a coming-soon visit as having seen the welcome sidebar
    if (data != null && !comingSoon) markSidebarSeen();
  }, [data, comingSoon]);

  const showBusPopup = useCallback((mapInstance, busId) => {
    const current = dataRef.current;
    const feature = current?.buses.features.find((f) => f.properties.busId === busId);
    const vehicle = current?.vehicles.find((v) => v.id === busId);
    if (!feature || !vehicle) return null;

    busPopupRef.current?.popup.remove();
    const popup = new maplibregl.Popup({ offset: [0, -20] })
      .setLngLat(feature.geometry.coordinates)
      .setDOMContent(busPopupContent(vehicle, isTestMode))
      .addTo(mapInstance);
    popup.on('close', () => {
      if (busPopupRef.current?.popup === popup) busPopupRef.current = null;
    });
    busPopupRef.current = { busId, popup };
    return feature;
  }, []);

  // Create the map
  useEffect(() => {
    const mapInstance = new maplibregl.Map({
      container: mapContainer.current,
      style: 'https://api.maptiler.com/maps/dataviz-dark/style.json?key=f2WqYl7JJ1HgexDxO177',
      center: PHILADELPHIA_CENTER,
      zoom: 11,
    });

    mapInstance.addControl(new maplibregl.NavigationControl(), 'top-right');
    mapInstance.addControl(
      new maplibregl.GeolocateControl({
        positionOptions: {
          enableHighAccuracy: true,
        },
        trackUserLocation: true,
        showAccuracyCircle: true,
        showUserLocation: true,
      }),
      'top-right'
    );

    let lightsInterval = null;
    let removed = false;

    mapInstance.on('load', async () => {
      mapInstance.addSource('routes', { type: 'geojson', data: EMPTY_GEOJSON });
      mapInstance.addSource('buses', { type: 'geojson', data: EMPTY_GEOJSON });

      // Route the vehicle is on now
      mapInstance.addLayer({
        id: 'route-lines',
        type: 'line',
        source: 'routes',
        filter: ['all', ['==', ['get', 'type'], 'route'], ['!=', ['get', 'nextTrip'], true]],
        paint: {
          'line-color': ['get', 'color'],
          'line-width': 4,
          'line-opacity': 0.6,
        },
      });

      // Start of the trip it runs next, drawn dashed
      mapInstance.addLayer({
        id: 'route-lines-next',
        type: 'line',
        source: 'routes',
        filter: ['all', ['==', ['get', 'type'], 'route'], ['==', ['get', 'nextTrip'], true]],
        paint: {
          'line-color': ['get', 'color'],
          'line-width': 3,
          'line-opacity': 0.5,
          'line-dasharray': [2, 2],
        },
      });

      // Glow effect layer (rendered behind the main stops)
      mapInstance.addLayer({
        id: 'route-stops-glow',
        type: 'circle',
        source: 'routes',
        filter: ['==', ['get', 'type'], 'stop'],
        minzoom: 13,
        paint: {
          'circle-radius': 20,
          'circle-color': stopColorExpression(0),
          'circle-blur': 1.2,
          'circle-opacity': 0.6,
        },
      });

      // Stop markers as festive ornaments (alternating red, green)
      mapInstance.addLayer({
        id: 'route-stops',
        type: 'circle',
        source: 'routes',
        filter: ['==', ['get', 'type'], 'stop'],
        minzoom: 13,
        paint: {
          'circle-radius': 8,
          'circle-color': stopColorExpression(0),
          'circle-stroke-color': '#ffffff',
          'circle-stroke-width': 2,
          'circle-opacity': 0.9,
        },
      });

      // Twinkling lights animation - cycle colors every 1000ms
      let colorOffset = 0;
      lightsInterval = setInterval(() => {
        colorOffset = (colorOffset + 1) % 2;
        const colorExpr = stopColorExpression(colorOffset);
        mapInstance.setPaintProperty('route-stops', 'circle-color', colorExpr);
        mapInstance.setPaintProperty('route-stops-glow', 'circle-color', colorExpr);
      }, 1000);

      // Vehicle markers: bus and trolley icons as SDF for dynamic coloring
      try {
        const [busImage, trolleyImage] = await Promise.all([
          mapInstance.loadImage('/bus-icon.sdf.png'),
          mapInstance.loadImage('/trolley-icon.sdf.png'),
        ]);
        if (removed) return;

        mapInstance.addImage('bus-icon', busImage.data, { sdf: true });
        mapInstance.addImage('trolley-icon', trolleyImage.data, { sdf: true });

        mapInstance.addLayer({
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
            // Vehicles in service draw on top of parked ones
            'symbol-sort-key': ['case', ['==', ['get', 'status'], 'in_service'], 1, 0],
          },
          paint: {
            'icon-color': ['get', 'color'],
            'icon-opacity': VEHICLE_OPACITY,
          },
        });
      } catch (e) {
        if (removed) return;
        // Without the icons, plain dots still show where everything is
        console.error('Error loading vehicle icons, falling back to dots:', e);
        mapInstance.addLayer({
          id: 'bus-markers',
          type: 'circle',
          source: 'buses',
          paint: {
            'circle-radius': 9,
            'circle-color': ['get', 'color'],
            'circle-stroke-color': '#ffffff',
            'circle-stroke-width': 2,
            'circle-opacity': VEHICLE_OPACITY,
            'circle-stroke-opacity': VEHICLE_OPACITY,
          },
        });
      }

      // Stop popups. Details are read from the latest data rather than the
      // rendered feature, which doesn't carry empty values faithfully.
      mapInstance.on('click', 'route-stops', (e) => {
        const clicked = e.features[0];
        const stop = dataRef.current?.routes.features.find(
          (f) =>
            f.properties.type === 'stop' &&
            f.properties.busId === clicked.properties.busId &&
            f.properties.stopId === String(clicked.properties.stopId) &&
            f.properties.stopSequence === clicked.properties.stopSequence
        );
        if (!stop) return;

        new maplibregl.Popup()
          .setLngLat(stop.geometry.coordinates)
          .setDOMContent(stopPopupContent(stop.properties))
          .addTo(mapInstance);
      });

      mapInstance.on('click', 'bus-markers', (e) => {
        showBusPopup(mapInstance, e.features[0].properties.busId);
      });

      for (const layer of ['route-stops', 'bus-markers']) {
        mapInstance.on('mouseenter', layer, () => {
          mapInstance.getCanvas().style.cursor = 'pointer';
        });
        mapInstance.on('mouseleave', layer, () => {
          mapInstance.getCanvas().style.cursor = '';
        });
      }

      setMap(mapInstance);
    });

    return () => {
      removed = true;
      clearInterval(lightsInterval);
      busPopupRef.current = null;
      setMap(null);
      mapInstance.remove();
    };
  }, [showBusPopup]);

  // Push new data onto the map
  useEffect(() => {
    dataRef.current = data;
    if (!map || !data) return;

    map.getSource('routes').setData(data.routes);
    map.getSource('buses').setData(data.buses);

    // Keep an open vehicle popup with its vehicle
    const open = busPopupRef.current;
    if (open) {
      const feature = data.buses.features.find((f) => f.properties.busId === open.busId);
      const vehicle = data.vehicles.find((v) => v.id === open.busId);
      if (feature && vehicle) {
        open.popup.setLngLat(feature.geometry.coordinates);
        open.popup.setDOMContent(busPopupContent(vehicle, isTestMode));
      } else {
        open.popup.remove();
      }
    }

    // Auto-fit to all vehicles and their routes the first time there are any
    if (!hasInitialFit.current && data.buses.features.length > 0) {
      const bounds = new maplibregl.LngLatBounds();
      for (const feature of data.buses.features) {
        bounds.extend(feature.geometry.coordinates);
      }
      for (const feature of data.routes.features) {
        if (feature.geometry.type === 'LineString') {
          for (const coord of feature.geometry.coordinates) {
            bounds.extend(coord);
          }
        } else if (feature.geometry.type === 'Point') {
          bounds.extend(feature.geometry.coordinates);
        }
      }
      map.fitBounds(bounds, { padding: FIT_PADDING, maxZoom: FOCUS_ZOOM });
      hasInitialFit.current = true;
    }
  }, [map, data]);

  // Jump to a vehicle picked from the sidebar
  const focusVehicle = useCallback(
    (busId) => {
      if (!map) return;
      const feature = showBusPopup(map, busId);
      if (!feature) return;

      setSidebarChoice(false);
      map.flyTo({
        center: feature.geometry.coordinates,
        zoom: Math.max(map.getZoom(), FOCUS_ZOOM),
      });
    },
    [map, showBusPopup]
  );

  return (
    <div className="app-container">
      <Sidebar
        isOpen={sidebarOpen}
        onClose={closeSidebar}
        comingSoon={comingSoon}
        vehicles={data?.vehicles ?? []}
        onSelectVehicle={focusVehicle}
      />
      <SnowfallOverlay map={map} />
      <header className="title-bar">
        <button
          className="sidebar-toggle-btn"
          onClick={() => setSidebarChoice(true)}
          aria-label="Open information sidebar"
        >
          i
        </button>
        <span className="title-text">{emojis[0]} Festibus Tracker {emojis[1]}</span>
        <div className="title-bar-spacer" />
      </header>
      <div className="map-wrapper">
        <div ref={mapContainer} className="map-container" />
        <StatusBanner data={data} failures={failures} isTestMode={isTestMode} />
        {comingSoon && <ComingSoon />}
      </div>
    </div>
  );
}

export default App;
