// The landing-site finder's map: a canvas showing one layer of a FinderResult, north up, with the search circle,
// ranked sites, a scale bar, a hover read-out and click-to-pick. Browser only (see map-layers.js for the pure parts).
import { h } from '../ui/dom.js';
import { cellToLatLon, latLonToCell } from './grid.js';
import { MAP_LAYERS, describeCell, hillshade, layerLegend, layerPixel } from './map-layers.js';

export { MAP_LAYERS };

const MARGIN = 12;
const TEXT = '#e6e9ef';
const FONT = '12px "IBM Plex Mono", ui-monospace, monospace';

export function createFinderMap({ container, canvas, legendEl, tipEl, onPick }) {
  const ctx = canvas.getContext('2d');
  const raster = document.createElement('canvas');
  let result = null;
  let layer = MAP_LAYERS[0].id;
  let selected = null; // { lat, lon }
  let shade = null;
  let reach = null;
  let route = null; // { path, target }
  let box = { x: 0, y: 0, size: 0 }; // raster rectangle in CSS pixels
  let down = null;

  function paintRaster() {
    if (!result) return;
    const { n } = result;
    raster.width = n;
    raster.height = n;
    const rctx = raster.getContext('2d');
    const img = rctx.createImageData(n, n);
    for (let i = 0; i < n * n; i++) {
      const [r, g, b] = layerPixel(layer, result, i, shade[i], { reach });
      img.data[i * 4] = r;
      img.data[i * 4 + 1] = g;
      img.data[i * 4 + 2] = b;
      img.data[i * 4 + 3] = 255;
    }
    rctx.putImageData(img, 0, 0);
  }

  /** Centre of a lat/lon on screen, or null if it is off the raster. */
  function toScreen(p) {
    const cell = latLonToCell(result, result.center, p.lat, p.lon);
    if (!cell) return null;
    return cellCentre(cell.row, cell.col);
  }
  const cellCentre = (row, col) => ({ x: box.x + ((col + 0.5) / result.n) * box.size, y: box.y + ((row + 0.5) / result.n) * box.size });
  const metresToPx = (m) => (m / (result.n * result.cellM)) * box.size;

  function niceLength(maxM) {
    for (const km of [10, 5, 2, 1, 0.5, 0.2, 0.1]) if (km * 1000 <= maxM) return km;
    return 0.1;
  }

  function draw() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = container.clientWidth;
    const hgt = container.clientHeight;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(hgt * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(hgt * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${hgt}px`;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, hgt);
    if (!result) return;
    const size = Math.max(0, Math.min(w, hgt) - 2 * MARGIN);
    box = { x: (w - size) / 2, y: (hgt - size) / 2, size };
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(raster, box.x, box.y, size, size);

    const centre = { x: box.x + size / 2, y: box.y + size / 2 };
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(230,233,239,0.55)';
    ctx.beginPath();
    ctx.arc(centre.x, centre.y, metresToPx(result.radiusKm * 1000), 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(centre.x - 5, centre.y);
    ctx.lineTo(centre.x + 5, centre.y);
    ctx.moveTo(centre.x, centre.y - 5);
    ctx.lineTo(centre.x, centre.y + 5);
    ctx.stroke();

    if (route) {
      const { path, target } = route;
      if (path && path.length > 1) {
        ctx.beginPath();
        path.forEach((i, k) => {
          const p = cellCentre(Math.floor(i / result.n), i % result.n);
          if (k === 0) ctx.moveTo(p.x, p.y);
          else ctx.lineTo(p.x, p.y);
        });
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';
        ctx.strokeStyle = '#06080c';
        ctx.lineWidth = 5;
        ctx.stroke();
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2.5;
        ctx.stroke();
      }
      if (target) {
        const p = cellCentre(target.row, target.col);
        const r = 7;
        ctx.beginPath();
        ctx.moveTo(p.x, p.y - r);
        ctx.lineTo(p.x + r, p.y);
        ctx.lineTo(p.x, p.y + r);
        ctx.lineTo(p.x - r, p.y);
        ctx.closePath();
        ctx.fillStyle = '#ffffff';
        ctx.fill();
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = '#06080c';
        ctx.stroke();
      }
    }

    ctx.font = FONT;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const site of [...result.sites].reverse()) {
      const p = cellCentre(site.row, site.col);
      const r = site.rank === 1 ? 11 : 9;
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      ctx.fillStyle = '#0b0e14';
      ctx.fill();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = '#ffffff';
      ctx.stroke();
      ctx.fillStyle = '#ffffff';
      ctx.fillText(String(site.rank), p.x, p.y + 0.5);
    }

    if (selected) {
      const p = toScreen(selected);
      if (p) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, 8, 0, Math.PI * 2);
        ctx.lineWidth = 2;
        ctx.strokeStyle = '#ffffff';
        ctx.stroke();
      }
    }

    // Scale bar, bottom right.
    const km = niceLength(((size * 0.3) / size) * result.n * result.cellM);
    const barPx = metresToPx(km * 1000);
    const bx = box.x + size - 10 - barPx;
    const by = box.y + size - 22;
    ctx.strokeStyle = TEXT;
    ctx.fillStyle = TEXT;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(bx, by - 4);
    ctx.lineTo(bx, by);
    ctx.lineTo(bx + barPx, by);
    ctx.lineTo(bx + barPx, by - 4);
    ctx.stroke();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(`${km} km`, bx + barPx / 2, by + 13);
    // North mark, top right.
    ctx.textAlign = 'right';
    ctx.textBaseline = 'top';
    ctx.fillText('N ↑', box.x + size - 10, box.y + 8);
  }

  function renderLegend() {
    if (!result) {
      legendEl.hidden = true;
      return;
    }
    const legend = layerLegend(layer, result, { reach });
    const last = legend.stops.length - 1;
    const ticks = legend.stops.map((stop, i) => ({ ...stop, at: i / last })).filter((stop) => stop.label);
    legendEl.replaceChildren(
      h('div', { class: 'legend-title' }, legend.title),
      h('div', { class: 'legend-ramp', style: `background: linear-gradient(to right, ${legend.stops.map((s) => s.hex).join(', ')})` }),
      legend.positioned
        ? h('div', { class: 'legend-ticks positioned' }, ticks.map((t) => h('span', { style: `left: ${(t.at * 100).toFixed(1)}%` }, t.label)))
        : h('div', { class: 'legend-ticks' }, ticks.map((t) => h('span', {}, t.label))),
      legend.swatches?.length ? h('ul', { class: 'legend-swatches' }, legend.swatches.map((s) => h('li', {}, h('i', { style: `background:${s.hex}` }), s.label))) : null,
      h('p', { class: 'legend-note' }, legend.note),
    );
    legendEl.hidden = false;
  }

  /** The cell under a pointer event, or null if it is off the raster. */
  function cellAt(event) {
    if (!result || box.size <= 0) return null;
    const rect = canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const col = Math.floor(((x - box.x) / box.size) * result.n);
    const row = Math.floor(((y - box.y) / box.size) * result.n);
    if (col < 0 || row < 0 || col >= result.n || row >= result.n) return null;
    return { row, col, x, y };
  }

  function hideTip() {
    tipEl.hidden = true;
  }

  canvas.addEventListener('pointermove', (event) => {
    if (event.pointerType && event.pointerType !== 'mouse') return;
    const cell = cellAt(event);
    if (!cell) return hideTip();
    tipEl.textContent = describeCell(result, cell.row, cell.col, { reach });
    tipEl.hidden = false;
    const cw = container.clientWidth;
    const ch = container.clientHeight;
    const x = Math.max(4, Math.min(cell.x + 14, cw - tipEl.offsetWidth - 4));
    const y = Math.max(4, Math.min(cell.y + 18, ch - tipEl.offsetHeight - 4));
    tipEl.style.transform = `translate(${x}px, ${y}px)`;
  });
  canvas.addEventListener('pointerleave', hideTip);
  canvas.addEventListener('pointerdown', (event) => {
    down = { x: event.clientX, y: event.clientY };
  });
  canvas.addEventListener('pointerup', (event) => {
    const start = down;
    down = null;
    const cell = cellAt(event);
    if (!start || !cell || Math.hypot(event.clientX - start.x, event.clientY - start.y) > 4) return;
    let best = null;
    for (const site of result.sites) {
      const p = cellCentre(site.row, site.col);
      const d = Math.hypot(p.x - cell.x, p.y - cell.y);
      if (d <= 10 && (!best || d < best.d)) best = { d, site };
    }
    const { row, col } = best ? best.site : cell;
    const { lat, lon } = best ? best.site : cellToLatLon(result, result.center, row, col);
    selected = { lat, lon };
    draw();
    onPick?.({ lat, lon, row, col });
  });

  const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => draw());
  observer?.observe(container);

  return {
    setResult(next) {
      result = next;
      selected = null;
      reach = null;
      route = null;
      hideTip();
      if (result) {
        shade = hillshade(result.elevation, result.n, result.cellM);
        paintRaster();
      }
      renderLegend();
      draw();
    },
    setLayer(id) {
      layer = id;
      paintRaster();
      renderLegend();
      draw();
    },
    setReach(next) {
      reach = next || null;
      paintRaster();
      if (layer === 'reach') renderLegend();
      draw();
    },
    setRoute(next) {
      route = next || null;
      draw();
    },
    getLayer: () => layer,
    setSelected(point) {
      selected = point;
      draw();
    },
    resize: draw,
  };
}
