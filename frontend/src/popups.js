// Popup contents are built as DOM nodes with text content, never HTML
// strings, so names from the schedule or fleet config can't inject markup.

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

/** One line describing what a vehicle is doing right now. */
export function vehicleStatusText(vehicle) {
  switch (vehicle.status) {
    case 'in_service':
      if (!vehicle.routeId) return 'In service';
      return vehicle.destination
        ? `Route ${vehicle.routeId} to ${vehicle.destination}`
        : `Route ${vehicle.routeId}`;
    case 'parked':
      return 'Parked, not in service right now';
    case 'last_seen':
      return `Last seen here at ${vehicle.lastSeen}`;
    default:
      return 'Not on the map right now';
  }
}

export function busPopupContent(vehicle, isTestMode) {
  const kind = vehicle.type === 'trolley' ? 'Trolley' : 'Bus';
  const root = el('div', 'popup');

  const title = isTestMode ? `Test ${kind} ${vehicle.id}` : vehicle.name || `Holiday ${kind}`;
  root.append(el('strong', 'popup-title', title));

  if (!isTestMode) {
    const details = [`${kind} ${vehicle.id}`];
    if (vehicle.district) details.push(`${vehicle.district} District`);
    root.append(el('div', 'popup-line', details.join(' · ')));
  }

  root.append(
    el(
      'div',
      vehicle.status === 'in_service' ? 'popup-line' : 'popup-line popup-muted',
      vehicleStatusText(vehicle)
    )
  );
  return root;
}

export function stopPopupContent(stop) {
  const root = el('div', 'popup');
  root.append(el('strong', 'popup-title', stop.name));

  const line = el('div', 'popup-line');
  if (stop.isRealTime) {
    line.append(el('span', 'popup-live-dot', '●'), ` Live: ${stop.predictedTime}`);

    if (stop.delayMinutes != null) {
      if (stop.delayMinutes > 0) {
        line.append(' ', el('span', 'popup-late', `(${stop.delayMinutes} min late)`));
      } else if (stop.delayMinutes < 0) {
        line.append(' ', el('span', 'popup-early', `(${-stop.delayMinutes} min early)`));
      } else {
        line.append(' ', el('span', 'popup-early', '(on time)'));
      }
    }
  } else {
    line.append(el('span', 'popup-scheduled-dot', '○'), ` Scheduled: ${stop.scheduledTime}`);
  }
  root.append(line);

  if (stop.nextTripHeadsign) {
    root.append(el('div', 'popup-line popup-muted', `On its next trip, to ${stop.nextTripHeadsign}`));
  }
  return root;
}
