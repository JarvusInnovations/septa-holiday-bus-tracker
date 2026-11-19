import './StatusBanner.css';

// Requests failing for this long (at one every 5 seconds) means we're offline
const FAILURES_BEFORE_WARNING = 3;
// SEPTA's feed is read every 5 seconds; older than this and positions are out of date
const STALE_AFTER_SECONDS = 90;

function describeAge(seconds) {
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.round(minutes / 60);
  return hours === 1 ? '1 hour' : `${hours} hours`;
}

/**
 * Short messages over the top of the map: the event notice, and anything
 * the visitor should know about how current the map is.
 */
export default function StatusBanner({ data, failures, isTestMode }) {
  const messages = [];

  if (isTestMode) {
    messages.push({ key: 'test', tone: 'info', text: 'Test mode: showing random SEPTA vehicles' });
  }

  if (data?.notice) {
    messages.push({ key: 'notice', tone: 'notice', text: data.notice });
  }

  if (failures >= FAILURES_BEFORE_WARNING) {
    messages.push({
      key: 'offline',
      tone: 'warning',
      text: data
        ? "Can't reach the tracker. Positions may be out of date. Retrying…"
        : "Can't reach the tracker. Retrying…",
    });
  } else if (data && !data.comingSoon) {
    if (data.dataAgeSeconds == null) {
      messages.push({
        key: 'stale',
        tone: 'warning',
        text: "Waiting for SEPTA's live vehicle data…",
      });
    } else if (data.dataAgeSeconds > STALE_AFTER_SECONDS) {
      messages.push({
        key: 'stale',
        tone: 'warning',
        text: `SEPTA's live data is delayed. Positions are ${describeAge(data.dataAgeSeconds)} old.`,
      });
    } else if (data.vehicles.length > 0 && data.buses.features.length === 0) {
      messages.push({
        key: 'empty',
        tone: 'info',
        text: 'No Festibuses are on the map right now. Check back soon!',
      });
    }
  }

  if (messages.length === 0) return null;

  return (
    <div className="status-banner" role="status">
      {messages.map((message) => (
        <div key={message.key} className={`status-message status-${message.tone}`}>
          {message.text}
        </div>
      ))}
    </div>
  );
}
