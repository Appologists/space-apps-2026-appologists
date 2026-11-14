// Number and coordinate formatting shared by criteria and the UI.

export const formatLat = (v, d = 3) => `${Math.abs(v).toFixed(d)}° ${v >= 0 ? 'N' : 'S'}`;
export const formatLon = (v, d = 3) => `${Math.abs(v).toFixed(d)}° ${v >= 0 ? 'E' : 'W'}`;
export const formatLatLon = (lat, lon, d = 3) => `${formatLat(lat, d)}, ${formatLon(lon, d)}`;

/** 5.5 → "5.5 h", 30 → "30 h", 200 → "8.3 days". */
export function formatHours(hours) {
  if (hours == null || Number.isNaN(hours)) return 'unknown';
  if (hours < 10) return `${hours.toFixed(1)} h`;
  if (hours < 48) return `${Math.round(hours)} h`;
  return `${(hours / 24).toFixed(1)} days`;
}

const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
export const compass = (azimuthDeg) => COMPASS[Math.round((((azimuthDeg % 360) + 360) % 360) / 45) % 8];

export const formatUTC = (date) => `${date.toISOString().slice(0, 16).replace('T', ' ')} UTC`;
