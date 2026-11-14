// The landing-site finder's form: what the planner says about the landing and the rover.
// The landing date, mission length and panel/antenna heights come from the Mission section above it.
import { formatLatLon } from '../format.js';
import { clear, h } from './dom.js';

/**
 * @param {HTMLElement} el
 * @param {Object} options
 * @param {ReturnType<import('../finder/score.js').defaultFinder>} options.values  edited in place through onChange
 * @param {{name: string, lat: number, lon: number}|null} options.centre           the selected site: the middle of the search
 * @param {boolean} options.busy
 * @param {string|null} options.hint        why the search cannot run, if it cannot
 * @param {(patch: object) => void} options.onChange
 * @param {() => void} options.onSearch
 * @param {(() => void)|null} [options.onUseExample]  offered beside the hint: jump to a spot the search works on
 */
export function renderFinderForm(el, { values, centre, busy, hint, onChange, onSearch, onUseExample }) {
  const number = (id, label, key, attrs) =>
    h(
      'label',
      { class: 'field' },
      label,
      h('input', {
        id,
        type: 'number',
        step: 'any',
        value: String(values[key]),
        ...attrs,
        onInput: (e) => {
          const v = parseFloat(e.target.value);
          if (Number.isFinite(v) && v >= 0) onChange({ [key]: v });
        },
      }),
    );
  const check = (id, label, key) =>
    h('label', { class: 'check' }, h('input', { id, type: 'checkbox', checked: values[key], onChange: (e) => onChange({ [key]: e.target.checked }) }), label);

  const parts = [
    h(
      'p',
      { class: 'finder-centre' },
      centre ? `Searches around the selected site: ${centre.name} (${formatLatLon(centre.lat, centre.lon, 2)}).` : 'Select a site or click the Moon to choose where to search.',
    ),
    h(
      'div',
      { class: 'fields' },
      h(
        'label',
        { class: 'field' },
        'Search radius',
        h(
          'select',
          { id: 'finderRadius', onChange: (e) => onChange({ radiusKm: parseFloat(e.target.value) }) },
          [10, 20, 40].map((km) => h('option', { value: String(km), selected: km === values.radiusKm }, `${km} km`)),
        ),
      ),
      number('finderEllipse', 'Landing accuracy (m)', 'ellipseRadiusM', { min: '0', max: '5000', title: 'The lander may come down anywhere within this distance of its target' }),
      number('finderSlope', 'Steepest landing slope (°)', 'maxLandingSlopeDeg', { min: '0', max: '45' }),
      number('finderDark', 'Longest darkness survived (h)', 'maxDarknessHours', { min: '0', title: 'Unbroken hours without sunlight the rover can live through' }),
    ),
    check('finderEarth', 'Earth must be in view at touchdown', 'needEarthAtLanding'),
    check('finderSun', 'Must land in sunlight', 'needSunAtLanding'),
    // Say why the search cannot run before the (disabled) button, where it will be seen.
    hint
      ? h(
          'p',
          { class: 'notice finder-why', id: 'finderWhy' },
          hint,
          onUseExample ? h('button', { type: 'button', id: 'finderExample', onClick: onUseExample }, 'Use Shackleton’s rim instead') : null,
        )
      : null,
    h('button', { type: 'button', class: 'primary', id: 'finderSearch', disabled: busy || !!hint, onClick: onSearch }, busy ? 'Searching…' : 'Find landing sites'),
    h('div', { class: 'eyebrow' }, 'Rover, for reach and routes'),
    h(
      'div',
      { class: 'fields' },
      number('roverSlope', 'Steepest slope it drives (°)', 'roverMaxSlopeDeg', { min: '0', max: '45' }),
      number('roverRange', 'Range (km)', 'roverRangeKm', { min: '0' }),
      number('roverSpeed', 'Average speed (m per hour)', 'roverSpeedMPerHour', { min: '1', title: 'Including stops' }),
    ),
    check('roverEarth', 'Needs Earth in view to drive', 'roverNeedsEarthToDrive'),
  ];
  clear(el).append(...parts.filter(Boolean));
}
