// Animated facts: small looping drawings, one per fact. Every number here is from content.js FACTS and
// names the same NASA source. Only the cards on screen are drawn.
const TAU = Math.PI * 2;
const SUN = '#f5c96b';
const EARTH = '#5aa8ff';
const MOON = '#d9d9d9';
const TEAL = '#4fe3c1';
const DIM = '#3a3a3a';

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

function disc(g, x, y, r, color) {
    g.fillStyle = color;
    g.beginPath();
    g.arc(x, y, r, 0, TAU);
    g.fill();
}

function ring(g, x, y, rx, ry, color, dash = []) {
    g.strokeStyle = color;
    g.setLineDash(dash);
    g.beginPath();
    g.ellipse(x, y, rx, ry, 0, 0, TAU);
    g.stroke();
    g.setLineDash([]);
}

function text(g, s, x, y, color = '#8a8a8a', size = 12, align = 'center') {
    g.fillStyle = color;
    g.font = `${size}px Geist Mono, monospace`;
    g.textAlign = align;
    g.fillText(s, x, y);
}

// Moon phase disc: k in [0,1) through one cycle (0 new, 0.5 full).
function phaseDisc(g, x, y, r, k) {
    const c = Math.cos(k * TAU); // 1 at new Moon, -1 at full
    const waxing = k < 0.5;
    disc(g, x, y, r, '#151515');
    // The lit half: the right side while waxing, the left side while waning.
    g.fillStyle = MOON;
    g.beginPath();
    g.arc(x, y, r, -Math.PI / 2, Math.PI / 2, !waxing);
    g.fill();
    // The terminator: a dark ellipse makes a crescent, a lit one makes a gibbous Moon.
    g.fillStyle = c > 0 ? '#151515' : MOON;
    g.beginPath();
    g.ellipse(x, y, r * Math.abs(c), r, 0, 0, TAU);
    g.fill();
}

export const ANIMATED_FACTS = [
    {big: '27 days', line: 'The Moon turns once per orbit, so the same side always faces Earth.', src: 'moonFacts', draw(g, W, H, t) {
        const cx = W / 2;
        const cy = H / 2;
        ring(g, cx, cy, 110, 56, DIM, [3, 5]);
        disc(g, cx, cy, 20, EARTH);
        const a = t / 2200;
        const x = cx + 110 * Math.cos(a);
        const y = cy + 56 * Math.sin(a);
        disc(g, x, y, 11, MOON);
        // The near-side mark keeps pointing at Earth.
        const d = Math.atan2(cy - y, cx - x);
        disc(g, x + 7 * Math.cos(d), y + 7 * Math.sin(d), 3.5, SUN);
    }},
    {big: '29.5 days', line: 'From one new Moon to the next: one lunar day, sunrise to sunrise.', src: 'phases', draw(g, W, H, t) {
        const k = (t / 6000) % 1;
        phaseDisc(g, W / 2, H / 2 - 6, 52, k);
        text(g, `day ${(k * 29.5).toFixed(1)}`, W / 2, H - 14);
    }},
    {big: '382 kg', line: 'Rock and soil that Apollo astronauts brought back to Earth, from six landings.', src: 'moonFacts', draw(g, W, H, t) {
        const n = Math.min(6, Math.floor((t / 600) % 9));
        for (let i = 0; i < n; i++) {
            const x = W / 2 - 3 * 34 + i * 34;
            g.fillStyle = i % 2 ? '#bdbdbd' : '#8f8f8f';
            g.fillRect(x, H - 40 - 12 * (i % 3), 30, 22);
            text(g, String([11, 12, 14, 15, 16, 17][i]), x + 15, H - 8, '#6e6e6e', 11);
        }
        text(g, n === 6 ? '382 kg in all' : 'Apollo', W / 2, 30, n === 6 ? SUN : '#8a8a8a', 14);
    }},
    {big: 'Maria', line: 'The dark "seas" are old impact basins that filled with lava.', src: 'moonFacts', draw(g, W, H, t) {
        const cx = W / 2;
        const cy = H / 2;
        disc(g, cx, cy, 62, '#9a9a9a');
        const k = (Math.sin(t / 1600) + 1) / 2;
        disc(g, cx, cy, 44, '#5c5c5c');
        g.fillStyle = `rgba(30,30,34,${0.35 + 0.65 * k})`;
        g.beginPath();
        g.arc(cx, cy, 44 * (0.3 + 0.7 * k), 0, TAU);
        g.fill();
        text(g, k > 0.6 ? 'lava fills the basin' : 'impact basin', cx, H - 8);
    }},
    {big: 'No air', line: 'Only a very thin exosphere, so nothing holds the day\'s heat.', src: 'moonFacts', draw(g, W, H, t) {
        const side = (x0, n, color, label) => {
            for (let i = 0; i < n; i++) {
                const a = i * 2.39996 + t / 900;
                const r = 46 + 22 * ((i * 0.618) % 1);
                disc(g, x0 + r * Math.cos(a), H / 2 + r * Math.sin(a) * 0.8, 1.6, color);
            }
            disc(g, x0, H / 2, 36, label === 'Earth' ? EARTH : MOON);
            text(g, label, x0, H - 6);
        };
        side(W * 0.28, 140, 'rgba(90,168,255,0.7)', 'Earth');
        side(W * 0.72, 6, 'rgba(255,255,255,0.7)', 'Moon');
    }},
    {big: '8 min', line: 'How long sunlight takes to reach Earth, 150 million km away.', src: 'sunFacts', draw(g, W, H, t) {
        const k = (t / 4000) % 1;
        disc(g, 34, H / 2, 24, SUN);
        disc(g, W - 30, H / 2, 9, EARTH);
        g.strokeStyle = DIM;
        g.beginPath();
        g.moveTo(60, H / 2);
        g.lineTo(W - 42, H / 2);
        g.stroke();
        const x = 60 + k * (W - 102);
        disc(g, x, H / 2, 4, '#fff');
        text(g, `${(k * 8.3).toFixed(1)} min`, x, H / 2 - 14, SUN, 12);
    }},
    {big: '99.8%', line: 'Of all the mass in the solar system is in the Sun.', src: 'sunFacts', draw(g, W, H, t) {
        const cols = 40;
        const rows = 25;
        const s = Math.min((W - 20) / cols, (H - 16) / rows);
        const x0 = (W - cols * s) / 2;
        const y0 = (H - rows * s) / 2;
        const hot = Math.floor((t / 6) % 1400);
        for (let i = 0; i < cols * rows; i++) {
            const x = x0 + (i % cols) * s;
            const y = y0 + Math.floor(i / cols) * s;
            const planet = i === 517 || i === 731;
            g.fillStyle = planet ? EARTH : i < hot ? SUN : '#1c1c1c';
            g.fillRect(x, y, s - 1, s - 1);
        }
    }},
    {big: '15 million °C', line: 'In the Sun\'s core. The visible surface is about 5,500 °C.', src: 'sunFacts', draw(g, W, H, t) {
        const cx = W / 2;
        const cy = H / 2;
        const p = 1 + 0.06 * Math.sin(t / 300);
        disc(g, cx, cy, 70, '#c2641f');
        disc(g, cx, cy, 50, '#e38a2b');
        disc(g, cx, cy, 30 * p, '#ffd27a');
        disc(g, cx, cy, 14 * p, '#fff6d8');
        text(g, 'surface 5,500 °C', W - 8, 16, '#8a8a8a', 11, 'right');
        text(g, 'core', cx, cy + 4, '#000', 11);
    }},
    {big: '2 million °C', line: 'The corona, the Sun\'s outer atmosphere, is far hotter than its surface.', src: 'sunFacts', draw(g, W, H, t) {
        const cx = W / 2;
        const cy = H / 2;
        for (let i = 0; i < 48; i++) {
            const a = (i / 48) * TAU;
            const len = 22 + 18 * Math.abs(Math.sin(i * 1.7 + t / 700));
            g.strokeStyle = `rgba(245,201,107,${0.15 + 0.25 * Math.abs(Math.sin(i + t / 900))})`;
            g.lineWidth = 2;
            g.beginPath();
            g.moveTo(cx + 40 * Math.cos(a), cy + 40 * Math.sin(a));
            g.lineTo(cx + (40 + len) * Math.cos(a), cy + (40 + len) * Math.sin(a));
            g.stroke();
        }
        g.lineWidth = 1;
        disc(g, cx, cy, 40, '#000');
        ring(g, cx, cy, 40, 40, '#444');
    }},
    {big: '25 vs 36 days', line: 'The Sun turns faster at its equator than near its poles.', src: 'sunFacts', draw(g, W, H, t) {
        const cx = W / 2;
        const cy = H / 2;
        const R = 66;
        disc(g, cx, cy, R, '#d9822b');
        for (const [lat, days] of [[0, 25], [35, 30], [60, 36]]) {
            for (const sgn of lat ? [1, -1] : [1]) {
                const y = cy - sgn * R * Math.sin((lat * Math.PI) / 180);
                const w = R * Math.cos((lat * Math.PI) / 180);
                const lon = ((t / (days * 80)) % 1) * TAU;
                const x = cx + w * Math.sin(lon);
                if (Math.cos(lon) > 0) {
                    disc(g, x, y, 5, '#3a1a05');
                }
            }
        }
        text(g, 'equator 25 d', cx + R + 8, cy + 4, '#8a8a8a', 11, 'left');
        text(g, 'poles 36 d', cx + R + 8, cy - 50, '#8a8a8a', 11, 'left');
    }},
    {big: '23.4°', line: 'Earth\'s tilted axis gives us seasons.', src: 'earthFacts', draw(g, W, H, t) {
        const cx = W / 2;
        const cy = H / 2;
        ring(g, cx, cy, 120, 50, DIM, [3, 5]);
        disc(g, cx, cy, 14, SUN);
        const a = t / 2600;
        const x = cx + 120 * Math.cos(a);
        const y = cy + 50 * Math.sin(a);
        disc(g, x, y, 13, EARTH);
        const tilt = (23.4 * Math.PI) / 180;
        g.strokeStyle = '#fff';
        g.beginPath();
        g.moveTo(x - 22 * Math.sin(tilt), y - 22 * Math.cos(tilt));
        g.lineTo(x + 22 * Math.sin(tilt), y + 22 * Math.cos(tilt));
        g.stroke();
        text(g, Math.cos(a) > 0 ? 'northern winter' : 'northern summer', cx, H - 6);
    }},
    {big: '71%', line: 'Of Earth\'s surface is ocean.', src: 'earthFacts', draw(g, W, H, t) {
        const cx = W / 2;
        const cy = H / 2;
        const R = 60;
        const k = Math.min(1, ((t / 3000) % 1.4));
        disc(g, cx, cy, R, '#3d3424');
        g.fillStyle = EARTH;
        g.beginPath();
        g.moveTo(cx, cy);
        g.arc(cx, cy, R, -Math.PI / 2, -Math.PI / 2 + TAU * 0.71 * k);
        g.fill();
        text(g, `${Math.round(71 * k)}% ocean`, cx, H - 6, EARTH, 12);
    }},
    {big: '78% · 21%', line: 'Earth\'s air: nitrogen and oxygen. The rest is about 1%.', src: 'earthFacts', draw(g, W, H, t) {
        const n = Math.min(100, Math.floor((t / 30) % 160));
        const s = 13;
        const x0 = W / 2 - 5 * s * 1.2;
        for (let i = 0; i < n; i++) {
            const x = x0 + (i % 10) * s * 1.2;
            const y = 10 + Math.floor(i / 10) * s * 1.2;
            disc(g, x + s / 2, y + s / 2, s / 2 - 1, i < 78 ? TEAL : i < 99 ? '#ededed' : SUN);
        }
        text(g, 'N₂', x0 - 16, 24, TEAL, 12);
        text(g, 'O₂', x0 - 16, 150, '#ededed', 12);
    }},
    {big: '1.5 million km', line: 'EPIC photographs the whole sunlit Earth from between Earth and the Sun.', src: 'epic', draw(g, W, H, t) {
        const cy = H / 2;
        disc(g, 26, cy, 20, SUN);
        disc(g, W - 34, cy, 22, EARTH);
        const x = W - 130;
        g.fillStyle = '#ededed';
        g.fillRect(x - 6, cy - 4, 12, 8);
        const k = (t / 1200) % 1;
        g.fillStyle = `rgba(90,168,255,${0.25 * (1 - k)})`;
        g.beginPath();
        g.moveTo(x + 6, cy);
        g.lineTo(W - 34, cy - 22);
        g.lineTo(W - 34, cy + 22);
        g.fill();
        text(g, 'DSCOVR', x, cy - 12, '#8a8a8a', 11);
        text(g, '1.5 M km', (x + W - 34) / 2, cy + 36, '#8a8a8a', 11);
    }},
    {big: '12,756 km', line: 'Earth is the biggest rocky planet. The Moon is 3,475 km wide.', src: 'earthFacts', draw(g, W, H, t) {
        const cy = H / 2;
        const e = 62;
        const m = e * (3475 / 12756);
        const k = (Math.sin(t / 1500) + 1) / 2;
        disc(g, W / 2 - 40, cy, e, EARTH);
        disc(g, W / 2 + 40 + 40 * k, cy, m, MOON);
        text(g, 'to scale', W / 2, H - 6);
    }},
];

export function renderFactGrid(el, sources) {
    const cards = ANIMATED_FACTS.map((f, i) => {
        const c = h('canvas', {width: 320, height: 170, 'aria-hidden': 'true'});
        c.fx = f;
        return h('article', {class: 'fx-card', style: `--i:${i % 4}`},
            c,
            h('b', {class: 'px'}, f.big),
            h('p', {}, f.line),
            h('a', {class: 'src', href: sources[f.src].url, target: '_blank', rel: 'noopener'}, sources[f.src].title));
    });
    el.replaceChildren(...cards);
    const on = new Set();
    const io = new IntersectionObserver(entries => {
        for (const e of entries) {
            const c = e.target.querySelector('canvas');
            if (e.isIntersecting) {
                on.add(c);
                e.target.classList.add('in');
            } else {
                on.delete(c);
            }
        }
    }, {rootMargin: '0px 0px -5% 0px'});
    for (const card of cards) {
        io.observe(card);
    }
    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    function frame(t) {
        requestAnimationFrame(frame);
        for (const c of on) {
            const g = c.getContext('2d');
            g.clearRect(0, 0, c.width, c.height);
            c.fx.draw(g, c.width, c.height, still ? 4000 : t);
        }
    }
    requestAnimationFrame(frame);
    return cards.length;
}
