import './Sidebar.css';
import BusIcon from './icons/BusIcon';
import TrolleyIcon from './icons/TrolleyIcon';

const HOLIDAY_VEHICLES = [
  { id: '3090', type: 'bus', district: 'Southern', name: 'Beetlejuice', color: '#e53935' },
  { id: '3069', type: 'bus', district: 'Victory', name: 'The Best Gift Ever', color: '#43a047' },
  { id: '3019', type: 'bus', district: 'Callowhill', name: 'Santa Paws', color: '#1e88e5' },
  { id: '3817', type: 'bus', district: 'Midvale', name: "National Lampoon's Christmas Vacation", color: '#fdd835' },
  { id: '3364', type: 'bus', district: 'Comly', name: 'Christmas in Wonderland', color: '#8e24aa' },
  { id: '3160', type: 'bus', district: 'Frankford', name: 'Care Bear Party Bus', color: '#00897b' },
  { id: '9034', type: 'trolley', district: 'Elmwood', name: 'Home Alone', color: '#f4511e' },
  { id: '9087', type: 'trolley', district: 'Elmwood', name: 'Holiday', color: '#c2185b' },
  { id: '9053', type: 'trolley', district: 'Callowhill', name: 'Frosty the Snow Mobile', color: '#78909c' },
  { id: '9009', type: 'trolley', district: 'Woodland', name: 'Star Wars', color: '#7cb342' },
];

export default function Sidebar({ isOpen, onClose }) {
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
          <p className="intro">
            See live positions of SEPTA's decorated holiday buses and trolleys,
            plus their routes for the next 30 minutes. Zoom in to see stops,
            then tap one to check arrival times.
          </p>

          <h3>Holiday Vehicles</h3>
          <table className="vehicle-table">
            <thead>
              <tr>
                <th>#</th>
                <th>District</th>
                <th>Name</th>
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
                  <td>{vehicle.name}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <button className="show-map-btn" onClick={onClose}>
            Show me the map! »
          </button>
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
