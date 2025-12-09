import './Sidebar.css';

const HOLIDAY_VEHICLES = [
  { id: '3090', type: 'bus', district: 'Southern', name: 'Beetlejuice' },
  { id: '3069', type: 'bus', district: 'Victory', name: 'The Best Gift Ever' },
  { id: '3019', type: 'bus', district: 'Callowhill', name: 'Santa Paws' },
  { id: '3817', type: 'bus', district: 'Midvale', name: "National Lampoon's Christmas Vacation" },
  { id: '3364', type: 'bus', district: 'Comly', name: 'Christmas in Wonderland' },
  { id: '3160', type: 'bus', district: 'Frankford', name: 'Care Bear Party Bus' },
  { id: '9034', type: 'trolley', district: 'Elmwood', name: 'Home Alone' },
  { id: '9087', type: 'trolley', district: 'Elmwood', name: 'Home' },
  { id: '9053', type: 'trolley', district: 'Callowhill', name: 'Frosty the Snow Mobile' },
];

export default function Sidebar({ isOpen, onClose }) {
  return (
    <>
      <aside className={`sidebar ${isOpen ? 'sidebar-open' : 'sidebar-closed'}`}>
        <header className="sidebar-header">
          <h2>About</h2>
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
                  <td>
                    <span className={`vehicle-type ${vehicle.type}`}>
                      {vehicle.id}
                    </span>
                  </td>
                  <td>{vehicle.district}</td>
                  <td>{vehicle.name}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="vehicle-legend">
            <span className="vehicle-type bus">Bus</span>
            <span className="vehicle-type trolley">Trolley</span>
          </div>
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
