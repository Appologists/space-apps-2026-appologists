// The "Terrain data" picker: which elevation dataset the surface view and the landing-site finder use.
// Datasets are large, so each person downloads the ones they want; this lists what is here and what is not.
import { clear, h } from './dom.js';

/**
 * @param {HTMLElement} el
 * @param {Object} options
 * @param {{available: boolean, sources: {id: string, label: string, coverage: string, sizeText: string, fetch: string, note?: string, installed: boolean}[]}|null} options.info
 * @param {string} options.selected   a dataset id, or 'auto'
 * @param {(id: string) => void} options.onSelect
 */
export function renderTerrainPicker(el, { info, selected, onSelect }) {
  if (!info) {
    clear(el).append(h('p', { class: 'hint' }, 'Checking which terrain data is on this computer…'));
    return;
  }
  const sources = info.sources ?? [];
  const option = (id, title, detail, { disabled = false, command = null } = {}) =>
    h(
      'label',
      { class: `terrain-option${disabled ? ' missing' : ''}` },
      h('input', { type: 'radio', name: 'terrainSource', value: id, checked: selected === id, disabled, onChange: () => onSelect(id) }),
      h('span', {}, h('span', { class: 'terrain-title' }, title), h('small', {}, detail), command ? h('code', {}, command) : null),
    );

  clear(el).append(
    option(
      'auto',
      'Best available',
      info.available ? 'The finest downloaded data that covers the spot; coarser data fills in beyond its edges.' : 'No terrain data is downloaded yet.',
      { disabled: !info.available },
    ),
    ...sources.map((source) =>
      source.installed
        ? option(source.id, source.label, `Covers ${source.coverage}. ${source.note ?? ''}`.trim())
        : option(source.id, source.label, `Covers ${source.coverage}. Not downloaded (${source.sizeText}). To get it, run this and reload:`, {
            disabled: true,
            command: source.fetch,
          }),
    ),
  );
}
