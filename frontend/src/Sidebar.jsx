import { useEffect } from 'react';
import './Sidebar.css';
import BusIcon from './icons/BusIcon';
import TrolleyIcon from './icons/TrolleyIcon';
import GitHubIcon from './icons/GitHubIcon';

function statusLabel(vehicle) {
  switch (vehicle.status) {
    case 'in_service':
      return vehicle.routeId ? `Route ${vehicle.routeId}` : 'In service';
    case 'parked':
      return 'Parked';
    case 'last_seen':
      return `Last seen ${vehicle.lastSeen}`;
    default:
      return 'Not out';
  }
}

function VehicleRow({ vehicle, onSelect }) {
  const Icon = vehicle.type === 'trolley' ? TrolleyIcon : BusIcon;
  const onMap = vehicle.status !== 'not_reporting';
  const heading = [vehicle.id, vehicle.district].filter(Boolean).join(' · ');

  return (
    <li>
      <button
        className="vehicle-row"
        onClick={() => onSelect(vehicle.id)}
        disabled={!onMap}
        title={onMap ? 'Show on the map' : undefined}
      >
        <Icon color={vehicle.color} size={20} />
        <span className="vehicle-text">
          <span className="vehicle-heading">{heading}</span>
          {vehicle.name && <span className="vehicle-name">{vehicle.name}</span>}
        </span>
        <span className={`vehicle-status vehicle-status-${vehicle.status}`}>
          {statusLabel(vehicle)}
        </span>
      </button>
    </li>
  );
}

export default function Sidebar({ isOpen, onClose, comingSoon, vehicles, onSelectVehicle }) {
  // Escape closes the sidebar
  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (event) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isOpen, onClose]);

  return (
    <>
      <aside
        className={`sidebar ${isOpen ? 'sidebar-open' : 'sidebar-closed'}`}
        // Keep the off-screen sidebar out of the tab order and away from screen readers
        inert={!isOpen}
      >
        <header className="sidebar-header">
          <h2>Welcome!</h2>
          <button
            className="sidebar-close-btn"
            onClick={onClose}
            aria-label="Close sidebar"
          >
            &times;
          </button>
        </header>

        <div className="sidebar-content">
          <p className="disclaimer">UNOFFICIAL Festibus Tracker</p>
          {comingSoon ? (
            <p className="intro">
              This year's Festibuses haven't hit the streets yet! Once they
              do, you'll see live positions of SEPTA's decorated holiday buses
              and trolleys here, plus their routes and arrival times. Check
              back soon!
            </p>
          ) : (
            <p className="intro">
              See live positions of SEPTA's decorated holiday buses and trolleys,
              plus their routes for the next 30 minutes. Zoom in to see stops,
              then tap one to check arrival times.
            </p>
          )}

          {vehicles.length > 0 && (
            <>
              <h3>Holiday Vehicles</h3>
              <ul className="vehicle-list">
                {vehicles.map((vehicle) => (
                  <VehicleRow key={vehicle.id} vehicle={vehicle} onSelect={onSelectVehicle} />
                ))}
              </ul>
              <p className="vehicle-note">
                Tap a vehicle to find it on the map. Not all vehicles run at the same time.
              </p>
            </>
          )}

          {!comingSoon && (
            <button className="show-map-btn" onClick={onClose}>
              Show me the map! »
            </button>
          )}

          <a
            href="https://github.com/JarvusInnovations/septa-holiday-bus-tracker"
            target="_blank"
            rel="noopener noreferrer"
            className="source-link"
          >
            <GitHubIcon size={14} /> Source Code
          </a>
        </div>
      </aside>

      {isOpen && (
        <div
          className="sidebar-overlay"
          onClick={onClose}
          aria-hidden="true"
        />
      )}
    </>
  );
}
