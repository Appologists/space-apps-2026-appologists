// The landing-site finder's map: a canvas showing one layer of a FinderResult, north up, with the search circle,
// ranked sites, a scale bar, a hover read-out and click-to-pick. Browser only (see map-layers.js for the pure parts).
import { h } from '../ui/dom.js';
import { cellToLatLon, latLonToCell } from './grid.js';
import { MAP_LAYERS, describeCell, hillshade, layerLegend, layerPixel } from './map-layers.js';
import { slopeBand } from './route-options.js';
import { WHY_COLOURS } from './why-not.js';

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
  let route = null; // { path, stops: [{ row, col, label }], waits: [{ row, col }], alternatives?: path[], ellipseM?, bySlope? }
  let box = { x: 0, y: 0, size: 0 }; // raster rectangle in CSS pixels
  let sim = null; // simulation frame (simulation.js frameAt) or null
  const shadowCanvas = document.createElement('canvas');
  let shadowStep = -1;

  /** Shade the ground that is dark at time step `step` (from the finder's Sun mask). */
  function paintShadow(step) {
    if (!result?.sunMask || step === shadowStep) return;
    const { n, maskStride, sunMask } = result;
    shadowCanvas.width = n;
    shadowCanvas.height = n;
    const sctx = shadowCanvas.getContext('2d');
    const img = sctx.createImageData(n, n);
    const base = step * maskStride;
    for (let i = 0; i < n * n; i++) {
      const lit = (sunMask[base + (i >> 3)] >> (i & 7)) & 1;
      if (lit) continue;
      img.data[i * 4] = 8;
      img.data[i * 4 + 1] = 14;
      img.data[i * 4 + 2] = 40;
      img.data[i * 4 + 3] = 175;
    }
    sctx.putImageData(img, 0, 0);
    shadowStep = step;
  }
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
    if (sim) {
      paintShadow(sim.step);
      ctx.drawImage(shadowCanvas, box.x, box.y, size, size);
    }

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
      const { path, stops = [], waits = [], alternatives = [], ellipseM = 0, bySlope = false, problems = [] } = route;
      const trace = (cells) => {
        ctx.beginPath();
        cells.forEach((i, k) => {
          const p = cellCentre(Math.floor(i / result.n), i % result.n);
          if (k === 0) ctx.moveTo(p.x, p.y);
          else ctx.lineTo(p.x, p.y);
        });
      };
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      // The other route choices, thin and dashed, under the chosen one.
      for (const alt of alternatives) {
        if (!alt || alt.length < 2) continue;
        trace(alt);
        ctx.setLineDash([5, 4]);
        ctx.strokeStyle = 'rgba(6,8,12,0.8)';
        ctx.lineWidth = 3.5;
        ctx.stroke();
        ctx.strokeStyle = 'rgba(230,233,239,0.75)';
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.setLineDash([]);
      }
      // The landing area around the start (the finder's landing-ellipse radius).
      if (ellipseM > 0 && path?.length) {
        const p = cellCentre(Math.floor(path[0] / result.n), path[0] % result.n);
        ctx.beginPath();
        ctx.arc(p.x, p.y, Math.max(metresToPx(ellipseM), 6), 0, Math.PI * 2);
        ctx.setLineDash([3, 3]);
        ctx.strokeStyle = '#8fc4ff';
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.setLineDash([]);
      }
      if (path && path.length > 1) {
        trace(path);
        ctx.strokeStyle = '#06080c';
        ctx.lineWidth = 6;
        ctx.stroke();
        if (bySlope) {
          // Each hop coloured by the steeper of its two cells.
          ctx.lineWidth = 3.5;
          for (let k = 1; k < path.length; k++) {
            const a = cellCentre(Math.floor(path[k - 1] / result.n), path[k - 1] % result.n);
            const b = cellCentre(Math.floor(path[k] / result.n), path[k] % result.n);
            ctx.beginPath();
            ctx.moveTo(a.x, a.y);
            ctx.lineTo(b.x, b.y);
            ctx.strokeStyle = slopeBand(Math.max(result.slope[path[k - 1]], result.slope[path[k]])).hex;
            ctx.stroke();
          }
        } else {
          ctx.strokeStyle = '#ffffff';
          ctx.lineWidth = 2.5;
          ctx.stroke();
        }
      }
      for (const wait of waits) {
        const p = cellCentre(wait.row, wait.col);
        ctx.beginPath();
        ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
        ctx.fillStyle = '#ffd36b';
        ctx.fill();
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = '#06080c';
        ctx.stroke();
      }
      for (const stop of stops) {
        const p = cellCentre(stop.row, stop.col);
        const r = 9;
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
        if (stop.label) {
          ctx.font = FONT;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillStyle = '#06080c';
          ctx.fillText(stop.label, p.x, p.y + 0.5);
        }
      }
    }

    // Why the drive fails: a coloured ring with a mark at each spot that is in the way.
    for (const mark of route?.problems ?? []) {
      const p = cellCentre(mark.row, mark.col);
      const colour = WHY_COLOURS[mark.kind] ?? '#e04848';
      if (mark.kind === 'lost') {
        ctx.lineWidth = 4;
        ctx.strokeStyle = '#06080c';
        for (const w of [4, 2.5]) {
          ctx.lineWidth = w;
          ctx.strokeStyle = w === 4 ? '#06080c' : colour;
          ctx.beginPath();
          ctx.moveTo(p.x - 7, p.y - 7);
          ctx.lineTo(p.x + 7, p.y + 7);
          ctx.moveTo(p.x + 7, p.y - 7);
          ctx.lineTo(p.x - 7, p.y + 7);
          ctx.stroke();
        }
        continue;
      }
      ctx.beginPath();
      ctx.arc(p.x, p.y, 15, 0, Math.PI * 2);
      ctx.lineWidth = 5;
      ctx.strokeStyle = '#06080c';
      ctx.stroke();
      ctx.lineWidth = 3;
      ctx.strokeStyle = colour;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(p.x + 13, p.y - 13, 7, 0, Math.PI * 2);
      ctx.fillStyle = colour;
      ctx.fill();
      ctx.font = 'bold 11px "IBM Plex Mono", monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#06080c';
      ctx.fillText('!', p.x + 13, p.y - 12.5);
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

    // The simulated rover: the way it has driven so far, then the rover coloured by what it is doing.
    if (sim && route?.path?.length) {
      const { path } = route;
      ctx.beginPath();
      for (let k = 0; k <= Math.min(sim.pathIndex, path.length - 1); k++) {
        const q = cellCentre(Math.floor(path[k] / result.n), path[k] % result.n);
        if (k === 0) ctx.moveTo(q.x, q.y);
        else ctx.lineTo(q.x, q.y);
      }
      const here = { x: box.x + ((sim.col + 0.5) / result.n) * box.size, y: box.y + ((sim.row + 0.5) / result.n) * box.size };
      ctx.lineTo(here.x, here.y);
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 4;
      ctx.stroke();
      if (!sim.lit) {
        ctx.beginPath();
        ctx.arc(here.x, here.y, 16, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(143,168,255,0.25)';
        ctx.fill();
      } else {
        ctx.beginPath();
        ctx.arc(here.x, here.y, 16, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(255,211,107,0.25)';
        ctx.fill();
      }
      ctx.beginPath();
      ctx.arc(here.x, here.y, 8, 0, Math.PI * 2);
      ctx.fillStyle = sim.colour;
      ctx.fill();
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = '#06080c';
      ctx.stroke();
      if (sim.state === 5) {
        ctx.font = 'bold 12px "IBM Plex Mono", monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = '#06080c';
        ctx.fillText('✕', here.x, here.y + 0.5);
      }
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
      sim = null;
      shadowStep = -1;
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
    /** Show a simulation frame (simulation.js), or null to stop showing it. */
    setSim(frame) {
      sim = frame || null;
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
