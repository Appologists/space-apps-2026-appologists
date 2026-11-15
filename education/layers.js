// Colour layers for the Moon, shared by the page background and the 3D lab:
// photo (LRO LROC), elevation (LOLA, the explorer's mini-map colours) and heat (LRO Diviner daytime high).
import * as THREE from 'three';

// Same stops as the explorer's corner mini-map (lunar-planner/public/lunar.js MINI_COLORS).
export const ELEV_COLORS = [[0, [40, 70, 210]], [0.22, [40, 160, 235]], [0.45, [70, 215, 150]], [0.65, [240, 220, 70]], [0.85, [245, 140, 50]], [1, [225, 50, 45]]];
// Same stops as the server's Diviner maps (lunar-planner/lunar_server.py TEMP_STOPS), in kelvin.
export const HEAT_STOPS = [[40, [25, 35, 90]], [130, [50, 120, 190]], [220, [230, 220, 190]], [310, [235, 150, 80]], [400, [200, 60, 50]]];

function ramp(stops, f) {
    for (let i = 1; i < stops.length; i++) {
        if (f <= stops[i][0]) {
            const [a, ca] = stops[i - 1];
            const [b, cb] = stops[i];
            const t = (f - a) / (b - a);
            return ca.map((v, k) => v + (cb[k] - v) * t);
        }
    }
    return stops[stops.length - 1][1];
}

function cssGradient(stops, lo, hi) {
    return `linear-gradient(90deg, ${stops.map(([v, c]) => `rgb(${c.join(',')}) ${(100 * (v - lo)) / (hi - lo)}%`).join(', ')})`;
}

let grid = null;

/** LOLA heights (1440 x 720 metres, made by lunar-planner/build_terrain.py), or null. */
export function elevationGrid() {
    if (!grid) {
        grid = fetch('/textures/moon-elevation-grid.bin').then(r => (r.ok ? r.arrayBuffer() : null)).then(buf => {
            if (!buf) {
                return null;
            }
            const data = new Int16Array(buf);
            if (data.length !== 1440 * 720) {
                return null;
            }
            let lo = Infinity;
            let hi = -Infinity;
            for (const v of data) {
                lo = Math.min(lo, v);
                hi = Math.max(hi, v);
            }
            return {data, lo, hi};
        }).catch(() => null);
    }
    return grid;
}

const images = {};

/** An equirectangular picture of the layer (canvas or image), longitude -180 at the left. */
export function layerImage(kind) {
    if (images[kind]) {
        return images[kind];
    }
    if (kind === 'photo' || kind === 'heat') {
        images[kind] = new Promise(resolve => {
            const img = new Image();
            img.onload = () => resolve(img);
            img.onerror = () => resolve(null);
            img.src = kind === 'photo' ? '/textures/moon-hd.jpg' : '/api/diviner/map?kind=max';
        });
    } else {
        images[kind] = elevationGrid().then(g => {
            if (!g) {
                return null;
            }
            const W = 1440;
            const H = 720;
            const c = document.createElement('canvas');
            c.width = W;
            c.height = H;
            const ctx = c.getContext('2d');
            const out = ctx.createImageData(W, H);
            const d = g.data;
            for (let y = 0; y < H; y++) {
                for (let x = 0; x < W; x++) {
                    const i = y * W + x;
                    const col = ramp(ELEV_COLORS, (d[i] - g.lo) / (g.hi - g.lo));
                    // Light from the north-west, so craters read as relief.
                    const dx = d[y * W + ((x + 1) % W)] - d[y * W + ((x + W - 1) % W)];
                    const dy = d[Math.min(H - 1, y + 1) * W + x] - d[Math.max(0, y - 1) * W + x];
                    const shade = Math.max(0.55, Math.min(1.25, 1 - (dx + dy) / 2400));
                    out.data[i * 4] = Math.min(255, col[0] * shade);
                    out.data[i * 4 + 1] = Math.min(255, col[1] * shade);
                    out.data[i * 4 + 2] = Math.min(255, col[2] * shade);
                    out.data[i * 4 + 3] = 255;
                }
            }
            ctx.putImageData(out, 0, 0);
            return c;
        });
    }
    return images[kind];
}

const textures = {};

/** The layer as a three.js texture (shared by every view that shows it). */
export function layerTexture(kind) {
    if (!textures[kind]) {
        textures[kind] = layerImage(kind).then(img => {
            if (!img) {
                return null;
            }
            const t = img instanceof HTMLCanvasElement ? new THREE.CanvasTexture(img) : new THREE.Texture(img);
            t.colorSpace = THREE.SRGBColorSpace;
            t.anisotropy = 8;
            t.needsUpdate = true;
            return t;
        });
    }
    return textures[kind];
}

/** What the scale under the mini-map says for a layer. */
export async function layerLegend(kind) {
    if (kind === 'elevation') {
        const g = await elevationGrid();
        if (!g) {
            return {title: 'Elevation: run build_terrain.py', gradient: null};
        }
        return {title: 'Elevation · LOLA', lo: `${(g.lo / 1000).toFixed(1)} km`, hi: `+${(g.hi / 1000).toFixed(1)} km`, gradient: cssGradient(ELEV_COLORS, 0, 1)};
    }
    if (kind === 'heat') {
        return {title: 'Daytime high · Diviner', lo: '40 K', hi: '400 K', gradient: cssGradient(HEAT_STOPS, 40, 400)};
    }
    return {title: 'LRO LROC colour map', gradient: null};
}
