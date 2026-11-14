// Client for NASA JPL's Horizons System (https://ssd.jpl.nasa.gov/horizons/), the reference ephemeris.
//
// The app does its Sun/Earth maths locally (ephemeris.js) so it can test thousands of times per site
// instantly. Horizons is the authority we check those numbers against: tools/check-horizons.mjs from the
// command line, and the "Check against JPL Horizons" button in the app.
//
// In the browser, calls go through the dev server's /api/horizons proxy (see vite.config.js) because
// Horizons sends no CORS headers. In Node, pass { baseUrl: HORIZONS_URL }.

export const HORIZONS_URL = 'https://ssd.jpl.nasa.gov/api/horizons.api';
const BODY_IDS = { sun: '10', earth: '399' };
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const horizonsTime = (date) => date.toISOString().slice(0, 16).replace('T', ' ');

/** Build the query for azimuth/elevation of a body seen from a point on the Moon's surface. */
export function horizonsQuery({ site, body, start, stop, step = '1 h' }) {
  const altitudeKm = (site.elevationM ?? 0) / 1000;
  return new URLSearchParams({
    format: 'json',
    COMMAND: `'${BODY_IDS[body]}'`,
    OBJ_DATA: `'NO'`,
    MAKE_EPHEM: `'YES'`,
    EPHEM_TYPE: `'OBSERVER'`,
    CENTER: `'coord@301'`, // a surface point on the Moon (body 301)
    COORD_TYPE: `'GEODETIC'`,
    SITE_COORD: `'${site.lon},${site.lat},${altitudeKm}'`, // east longitude, latitude, altitude in km
    START_TIME: `'${horizonsTime(start)}'`,
    STOP_TIME: `'${horizonsTime(stop)}'`,
    STEP_SIZE: `'${step}'`,
    QUANTITIES: `'4'`, // apparent azimuth and elevation
    APPARENT: `'AIRLESS'`,
    CSV_FORMAT: `'YES'`,
  });
}

/** Parse the table between $$SOE and $$EOE into [{ date, azimuth, elevation }]. */
export function parseHorizonsAltAz(resultText) {
  const start = resultText.indexOf('$$SOE');
  const end = resultText.indexOf('$$EOE');
  if (start < 0 || end < 0) throw new Error(`Horizons returned no table: ${resultText.slice(0, 300)}`);
  return resultText
    .slice(start + 5, end)
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const cols = line.split(',').map((c) => c.trim());
      const m = cols[0].match(/^(\d{4})-(\w{3})-(\d{2}) (\d{2}):(\d{2})/);
      if (!m) throw new Error(`Unexpected Horizons row: ${line}`);
      const date = new Date(Date.UTC(+m[1], MONTHS.indexOf(m[2]), +m[3], +m[4], +m[5]));
      return { date, azimuth: parseFloat(cols[3]), elevation: parseFloat(cols[4]) };
    });
}

/**
 * Azimuth/elevation of the Sun or Earth from a lunar site, straight from Horizons.
 * @param {{site: import('./sky.js').Site, body: 'sun'|'earth', start: Date, stop: Date, step?: string, baseUrl?: string}} options
 */
export async function fetchHorizonsAltAz({ baseUrl = '/api/horizons', ...query }) {
  const response = await fetch(`${baseUrl}?${horizonsQuery(query)}`);
  if (!response.ok) throw new Error(`Horizons request failed: HTTP ${response.status}`);
  const data = await response.json();
  if (data.error) throw new Error(`Horizons error: ${data.error}`);
  return parseHorizonsAltAz(data.result);
}
