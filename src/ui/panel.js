// Left panel: mission inputs, weights and the ranked list. Pure rendering: it draws what it is given and
// reports changes through callbacks. State lives in main.js.
import { DURATIONS, formatDuration } from '../mission.js';
import { formatLatLon } from '../format.js';
import { clear, debounce, h } from './dom.js';

const toInputValue = (date) => date.toISOString().slice(0, 16);

/**
 * @param {HTMLElement} el
 * @param {import('../mission.js').Mission} mission
 * @param {(patch: Partial<import('../mission.js').Mission>) => void} onChange
 */
export function renderMission(el, mission, onChange) {
  const later = debounce(onChange, 250);
  const number = (id, label, key, attrs) =>
    h(
      'label',
      { class: 'field' },
      label,
      h('input', {
        id,
        type: 'number',
        step: 'any',
        value: String(mission[key]),
        ...attrs,
        onInput: (e) => {
          const v = parseFloat(e.target.value);
          if (Number.isFinite(v)) later({ [key]: v });
        },
      }),
    );

  clear(el).append(
    h(
      'label',
      { class: 'field wide' },
      'Landing date and time (UTC)',
      h('input', {
        id: 'missionStart',
        type: 'datetime-local',
        step: '3600',
        value: toInputValue(mission.start),
        onChange: (e) => {
          const date = new Date(`${e.target.value}Z`);
          if (!Number.isNaN(date.getTime())) onChange({ start: date });
        },
      }),
    ),
    h(
      'label',
      { class: 'field wide' },
      'How long the mission lasts',
      h(
        'select',
        { id: 'missionDuration', onChange: (e) => onChange({ durationHours: parseFloat(e.target.value) }) },
        // A length set on the mission steps' slider may not be in the list: show it as an option of its own.
        (DURATIONS.some((d) => d.hours === mission.durationHours) ? DURATIONS : [...DURATIONS, { hours: mission.durationHours, label: formatDuration(mission.durationHours) }]).map((d) =>
          h('option', { value: String(d.hours), selected: d.hours === mission.durationHours }, d.label),
        ),
      ),
    ),
    number('panelHeight', 'Solar panel height (m)', 'panelHeightM', { min: '0', max: '100' }),
    number('antennaHeight', 'Antenna height (m)', 'antennaHeightM', { min: '0', max: '100' }),
  );
}

/**
 * @param {HTMLElement} el
 * @param {import('../criteria/types.js').Criterion[]} ready
 * @param {import('../criteria/types.js').Criterion[]} planned
 * @param {Object<string, number>} weights
 * @param {(id: string, weight: number) => void} onChange
 */
export function renderWeights(el, ready, planned, weights, onChange) {
  clear(el).append(
    ...ready.map((c) => {
      const out = h('span', { class: 'num' }, `${Math.round(weights[c.id] * 100)}`);
      return h(
        'div',
        { class: 'weight', title: c.description },
        h('div', { class: 'weight-head' }, h('label', { htmlFor: `w-${c.id}` }, c.label), out),
        h('input', {
          id: `w-${c.id}`,
          type: 'range',
          min: '0',
          max: '100',
          step: '5',
          value: String(Math.round(weights[c.id] * 100)),
          onInput: (e) => {
            out.textContent = e.target.value;
            onChange(c.id, e.target.value / 100);
          },
        }),
      );
    }),
    h(
      'details',
      { class: 'explain' },
      h('summary', {}, 'What these mean, and what is planned'),
      ...ready.map((c) => h('p', {}, h('strong', {}, `${c.label}. `), c.description)),
      ...planned.map((c) =>
        h('p', { class: 'planned' }, h('strong', {}, `${c.label} `), h('span', { class: 'tag' }, 'Planned'), ` ${c.description}`),
      ),
    ),
  );
}

/**
 * @param {HTMLElement} el
 * @param {ReturnType<import('../scoring/rank.js').rankSites>} ranking
 * @param {Object} options
 * @param {string|null} options.selectedId
 * @param {Object<string, string>} options.categories  category id → label
 * @param {Object<string, string>} options.colors      category id → CSS colour
 * @param {Object<string, string>} options.criterionColors
 * @param {(id: string) => void} options.onSelect
 */
export function renderRanking(el, ranking, { selectedId, categories, colors, criterionColors, onSelect }) {
  clear(el).append(
    ...ranking.map((entry) => {
      const { site } = entry;
      const score = entry.total == null ? null : Math.round(entry.total * 100);
      return h(
        'li',
        {},
        h(
          'button',
          {
            type: 'button',
            class: 'rank-row',
            'aria-current': site.id === selectedId ? 'true' : null,
            'data-site': site.id,
            onClick: () => onSelect(site.id),
          },
          h('span', { class: 'rank-n' }, entry.rank == null ? '–' : String(entry.rank)),
          h('span', { class: 'rank-name' }, site.name),
          h('span', { class: 'rank-score', title: 'Score out of 100' }, score == null ? 'n/a' : String(score)),
          h(
            'span',
            { class: 'rank-meta' },
            h('i', { class: 'dot', style: `background:${colors[site.category] ?? '#888'}` }),
            categories[site.category] ?? site.category,
            h('span', { class: 'num' }, formatLatLon(site.lat, site.lon, 2)),
          ),
          h('span', { class: 'bar' }, h('i', { style: `width:${score ?? 0}%` })),
          h(
            'ul',
            { class: 'rank-lines' },
            Object.entries(entry.results).map(([id, result]) =>
              h('li', {}, h('i', { class: 'dot', style: `background:${criterionColors[id] ?? 'var(--dim)'}` }), result.summary),
            ),
          ),
        ),
      );
    }),
  );
}
