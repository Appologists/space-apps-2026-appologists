// Slope bands, in degrees: the colours of the route (route-options.js) and of the map's Slope view (map-layers.js),
// so the ground and the route read with one key. Our estimate, from the finder's own limits. The four colours step
// down in lightness from green to red, so they stay apart for viewers who do not see red and green.
export const SLOPE_BANDS = Object.freeze([
  { maxDeg: 10, id: 'easy', label: 'under 10°', hex: '#7bd88f' },
  { maxDeg: 15, id: 'moderate', label: '10–15°', hex: '#ffd36b' },
  { maxDeg: 20, id: 'steep', label: '15–20°', hex: '#ff8a5b' },
  { maxDeg: Infinity, id: 'too-steep', label: 'over 20°', hex: '#e04848' },
]);
export const slopeBand = (deg) => SLOPE_BANDS.find((band) => deg < band.maxDeg) ?? SLOPE_BANDS[SLOPE_BANDS.length - 1];
