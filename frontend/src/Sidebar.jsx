import './Sidebar.css';
import BusIcon from './icons/BusIcon';
import TrolleyIcon from './icons/TrolleyIcon';
import GitHubIcon from './icons/GitHubIcon';

import { HOLIDAY_VEHICLES } from './holidayVehicles';

// Themes may not be announced yet; only show the column once at least one is known
const hasNames = HOLIDAY_VEHICLES.some((vehicle) => vehicle.name);

export default function Sidebar({ isOpen, onClose, comingSoon }) {
  return (
    <>
      <aside className={`sidebar ${isOpen ? 'sidebar-open' : 'sidebar-closed'}`}>
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

          {HOLIDAY_VEHICLES.length > 0 && (<>
          <h3>Holiday Vehicles</h3>
          <table className="vehicle-table">
            <thead>
              <tr>
                <th>#</th>
                <th>District</th>
                {hasNames && <th>Name</th>}
              </tr>
            </thead>
            <tbody>
              {HOLIDAY_VEHICLES.map((vehicle) => (
                <tr key={vehicle.id}>
                  <td className="vehicle-id-cell">
                    {vehicle.type === 'bus' ? (
                      <BusIcon color={vehicle.color} size={16} />
                    ) : (
                      <TrolleyIcon color={vehicle.color} size={16} />
                    )}
                    <span className="vehicle-id">{vehicle.id}</span>
                  </td>
                  <td>{vehicle.district}</td>
                  {hasNames && <td>{vehicle.name}</td>}
                </tr>
              ))}
            </tbody>
          </table>
          <p className="vehicle-note">Not all vehicles run at the same time.</p>
          </>)}

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
