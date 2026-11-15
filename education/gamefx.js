// Visuals for the games: animated card art, quiz progress dots, a burst on a right answer, a map that shows
// where the temperature site is, a thermometer in the same colours as the Diviner map, and a score ring.
import { HEAT_STOPS, layerImage } from './layers.js';

const TAU = Math.PI * 2;

function h(tag, attrs = {}, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
        if (k === 'class') {
            el.className = v;
        } else {
            el.setAttribute(k, v);
        }
    }
    for (const kid of kids.flat()) {
        if (kid !== null && kid !== undefined) {
            el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
        }
    }
    return el;
}

export function heatColor(k) {
    for (let i = 1; i < HEAT_STOPS.length; i++) {
        const [k1, c1] = HEAT_STOPS[i];
        const [k0, c0] = HEAT_STOPS[i - 1];
        if (k <= k1 || i === HEAT_STOPS.length - 1) {
            const f = Math.max(0, Math.min(1, (k - k0) / (k1 - k0)));
            return `rgb(${c0.map((v, j) => Math.round(v + (c1[j] - v) * f)).join(',')})`;
        }
    }
    return '#fff';
}

export const HEAT_GRADIENT = `linear-gradient(90deg, ${HEAT_STOPS.map(([k, c]) => `rgb(${c.join(',')}) ${((100 * (k - 40)) / 360).toFixed(1)}%`).join(', ')})`;

// ---------- Card art: drawn only while on screen ----------
const ART = {
    // Ten questions as ten dots on a ring, lit one by one, with a sweeping timer arc.
    quiz(g, W, H, t) {
        const cx = W / 2;
        const cy = H / 2;
        const lit = Math.floor((t / 450) % 12);
        for (let i = 0; i < 10; i++) {
            const a = -Math.PI / 2 + (i / 10) * TAU;
            const on = i < lit;
            g.fillStyle = on ? (i % 4 === 3 ? '#ff6166' : '#45d483') : '#222';
            g.beginPath();
            g.arc(cx + 54 * Math.cos(a), cy + 54 * Math.sin(a), on ? 7 : 5, 0, TAU);
            g.fill();
        }
        const f = (t % 4000) / 4000;
        g.strokeStyle = '#f5c96b';
        g.lineWidth = 3;
        g.beginPath();
        g.arc(cx, cy, 34, -Math.PI / 2, -Math.PI / 2 + TAU * (1 - f));
        g.stroke();
        g.lineWidth = 1;
        g.fillStyle = '#ededed';
        g.font = '28px Geist Pixel, Geist Mono, monospace';
        g.textAlign = 'center';
        g.fillText(String(Math.ceil(20 * (1 - f))), cx, cy + 10);
    },
    // A lunar day at one site: the temperature curve drawn in the Diviner colours, with a moving marker.
    hotcold(g, W, H, t) {
        const x0 = 20;
        const w = W - 40;
        const temp = f => (f > 0.25 && f < 0.75 ? 100 + 290 * Math.sin((f - 0.25) * 2 * Math.PI) : 100 - 10 * Math.sin(f * TAU));
        const y = k => H - 22 - ((k - 40) / 360) * (H - 44);
        for (let i = 0; i < 120; i++) {
            const f0 = i / 120;
            const f1 = (i + 1) / 120;
            g.strokeStyle = heatColor(temp(f0));
            g.lineWidth = 4;
            g.beginPath();
            g.moveTo(x0 + f0 * w, y(temp(f0)));
            g.lineTo(x0 + f1 * w, y(temp(f1)));
            g.stroke();
        }
        g.lineWidth = 1;
        const f = (t / 6000) % 1;
        const k = temp(f);
        g.fillStyle = '#fff';
        g.beginPath();
        g.arc(x0 + f * w, y(k), 6, 0, TAU);
        g.fill();
        g.fillStyle = heatColor(k);
        g.font = '13px Geist Mono, monospace';
        g.textAlign = 'left';
        g.fillText(`${Math.round(k)} K`, Math.min(x0 + f * w + 10, W - 60), y(k) - 10);
        g.fillStyle = '#555';
        g.fillText('night', x0, H - 6);
        g.textAlign = 'center';
        g.fillText('noon', x0 + w / 2, H - 6);
    },
};

export function mountCardArt(root = document) {
    const canvases = [...root.querySelectorAll('canvas[data-art]')];
    const on = new Set();
    const io = new IntersectionObserver(entries => {
        for (const e of entries) {
            if (e.isIntersecting) {
                on.add(e.target);
            } else {
                on.delete(e.target);
            }
        }
    });
    canvases.forEach(c => io.observe(c));
    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    function frame(t) {
        requestAnimationFrame(frame);
        for (const c of on) {
            const g = c.getContext('2d');
            g.clearRect(0, 0, c.width, c.height);
            ART[c.dataset.art](g, c.width, c.height, still ? 2600 : t);
        }
    }
    requestAnimationFrame(frame);
}

// ---------- Quiz progress: one dot per question ----------
export function progressDots(total, results) {
    return h('div', {class: 'pdots', 'aria-label': `${results.filter(Boolean).length} right so far`},
        Array.from({length: total}, (_, i) => h('i', {class: i < results.length ? (results[i] ? 'right' : 'wrong') : i === results.length ? 'now' : ''})));
}

// ---------- A small burst of dots from a button ----------
export function burst(el, color = '#45d483') {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        return;
    }
    const r = el.getBoundingClientRect();
    for (let i = 0; i < 14; i++) {
        const a = (i / 14) * TAU;
        const d = 40 + 30 * Math.random();
        const p = h('i', {class: 'spark', style: `left:${r.left + r.width / 2}px;top:${r.top + r.height / 2}px;background:${color};--dx:${(Math.cos(a) * d).toFixed(1)}px;--dy:${(Math.sin(a) * d).toFixed(1)}px`});
        document.body.append(p);
        setTimeout(() => p.remove(), 800);
    }
}

// ---------- Where the site is: the LROC map with a marker ----------
export function siteLocator(site) {
    const c = h('canvas', {class: 'locator', width: 360, height: 180, 'aria-label': `Map: ${site.name}`});
    layerImage('photo').then(img => {
        const g = c.getContext('2d');
        if (img) {
            g.drawImage(img, 0, 0, 360, 180);
        } else {
            g.fillStyle = '#111';
            g.fillRect(0, 0, 360, 180);
        }
        g.fillStyle = 'rgba(0,0,0,0.25)';
        g.fillRect(0, 0, 360, 180);
        const x = ((site.lon + 180) / 360) * 360;
        const y = ((90 - site.lat) / 180) * 180;
        let t0 = null;
        const base = g.getImageData(0, 0, 360, 180);
        function pulse(t) {
            if (!c.isConnected && t0 !== null) {
                return;
            }
            t0 = t0 ?? t;
            g.putImageData(base, 0, 0);
            const k = ((t - t0) % 1400) / 1400;
            g.strokeStyle = `rgba(245,201,107,${1 - k})`;
            g.lineWidth = 2;
            g.beginPath();
            g.arc(x, y, 6 + 16 * k, 0, TAU);
            g.stroke();
            g.fillStyle = '#f5c96b';
            g.beginPath();
            g.arc(x, y, 4, 0, TAU);
            g.fill();
            requestAnimationFrame(pulse);
        }
        requestAnimationFrame(pulse);
    });
    return c;
}

// ---------- Score ring on the result screen ----------
export function scoreRing(score, max) {
    const c = h('canvas', {class: 'score-ring', width: 220, height: 220, 'aria-hidden': 'true'});
    const g = c.getContext('2d');
    const f = Math.max(0, Math.min(1, score / max));
    const t0 = performance.now();
    function draw(t) {
        const k = Math.min(1, (t - t0) / 1200);
        const e = 1 - Math.pow(1 - k, 3);
        g.clearRect(0, 0, 220, 220);
        g.lineWidth = 12;
        g.strokeStyle = '#1c1c1c';
        g.beginPath();
        g.arc(110, 110, 90, 0, TAU);
        g.stroke();
        g.strokeStyle = f > 0.66 ? '#45d483' : f > 0.33 ? '#f5c96b' : '#ff6166';
        g.lineCap = 'round';
        g.beginPath();
        g.arc(110, 110, 90, -Math.PI / 2, -Math.PI / 2 + TAU * f * e);
        g.stroke();
        g.fillStyle = '#ededed';
        g.font = '44px Geist Pixel, Geist Mono, monospace';
        g.textAlign = 'center';
        g.fillText(String(Math.round(score * e)), 110, 122);
        g.fillStyle = '#6e6e6e';
        g.font = '12px Geist Mono, monospace';
        g.fillText(`of about ${max}`, 110, 146);
        if (k < 1) {
            requestAnimationFrame(draw);
        }
    }
    requestAnimationFrame(draw);
    return c;
}
