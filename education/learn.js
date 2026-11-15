// Learn: the education section. 3D lab (Moon with LOLA relief and real landing sites, Earth from NASA
// EPIC, Sun from NASA SDO, Sun-Earth-Moon geometry from Astronomy Engine checked against JPL Horizons),
// a fact deck, two short exercises, and a leaderboard kept by the Flask server (lunar-planner/learn_api.py).
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { Body, GeoMoon, GeoVector, Illumination, MoonPhase } from 'astronomy-engine';
import { BADGES, FACTS, QUIZ as OUR_QUIZ, SOURCES } from './content.js';
import { QUIZ as EXPLORER_QUIZ } from '/lunar-game.js';
import { createDots } from './dots.js';
import { setBgLayer } from './bg.js';
import { layerImage, layerLegend, layerTexture } from './layers.js';
import { initTopics, renderTimeline } from './topics.js';
import { initGuide } from './guide.js';
import { renderFactGrid } from './factfx.js';
import { HEAT_GRADIENT, burst, heatColor, mountCardArt, progressDots, scoreRing, siteLocator } from './gamefx.js';

// The quiz: the explorer's own questions (/classic, lunar-game.js) plus ours, without repeats.
const QUIZ = [...OUR_QUIZ];
for (const item of EXPLORER_QUIZ) {
    const key = item.q.toLowerCase().replace(/[^a-z]/g, '').slice(0, 40);
    if (!QUIZ.some(x => x.q.toLowerCase().replace(/[^a-z]/g, '').slice(0, 40) === key)) {
        QUIZ.push({...item, src: item.src || 'team'});
    }
}

const $ = id => document.getElementById(id);
const DEG = Math.PI / 180;
const AU_KM = 149597870.7;

/** Build an element. Text is always set as text, never as HTML. */
function h(tag, attrs = {}, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
        if (k === 'class') {
            el.className = v;
        } else if (k.startsWith('on')) {
            el.addEventListener(k.slice(2), v);
        } else if (v !== null && v !== undefined && v !== false) {
            el.setAttribute(k, v);
        }
    }
    for (const kid of kids.flat()) {
        if (kid !== null && kid !== undefined && kid !== false) {
            el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
        }
    }
    return el;
}

function sourceLink(key) {
    const s = SOURCES[key];
    if (!s) {
        return null;
    }
    return h('span', {class: 'src'}, 'Source: ', h('a', {href: s.url, target: '_blank', rel: 'noopener'}, s.title));
}

function shuffle(list) {
    const a = list.slice();
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
}

function fmtLat(v) {
    return `${Math.abs(v).toFixed(2)}° ${v >= 0 ? 'N' : 'S'}`;
}

function fmtLon(v) {
    return `${Math.abs(v).toFixed(2)}° ${v >= 0 ? 'E' : 'W'}`;
}

function toast(title, text) {
    const t = h('div', {class: 'toast'}, h('b', {}, title), text);
    $('toasts').append(t);
    setTimeout(() => t.remove(), 4200);
}

// ================= Progress (kept in this browser) =================
const KEY = 'lunar-learn-v1';
const XP_PER_LEVEL = 150;
let me = {xp: 0, badges: {}, read: {}, sites: {}, sdo: {}, topics: {}, history: {}, best: {}, name: '', elsh: 1};
try {
    me = Object.assign(me, JSON.parse(localStorage.getItem(KEY) || '{}'));
} catch (e) {
    // Private mode or blocked storage: progress lasts for this visit only.
}

function save() {
    try {
        localStorage.setItem(KEY, JSON.stringify(me));
    } catch (e) {
        // ignore
    }
}

function renderPlayStats() {
    const el = $('play-stats');
    if (!el) {
        return;
    }
    const tile = (n, l) => h('div', {}, h('b', {class: 'px'}, n), h('span', {}, l));
    el.replaceChildren(
        tile(me.best.quiz ? String(me.best.quiz) : '\u2013', 'your best quiz'),
        tile(me.best.hotcold ? String(me.best.hotcold) : '\u2013', 'your best estimate'),
        tile(`${Object.keys(me.badges).length} / ${BADGES.length}`, 'badges'),
        tile(`LV ${Math.floor(me.xp / XP_PER_LEVEL) + 1}`, `${me.xp} XP`));
}

function renderMe() {
    renderPlayStats();
    $('lvl').textContent = `LV ${Math.floor(me.xp / XP_PER_LEVEL) + 1}`;
    $('xpfill').style.width = `${(100 * (me.xp % XP_PER_LEVEL)) / XP_PER_LEVEL}%`;
    $('xptext').textContent = `${me.xp} XP`;
}

function addXp(n) {
    me.xp += n;
    save();
    renderMe();
}

function award(id) {
    if (me.badges[id]) {
        return;
    }
    const badge = BADGES.find(b => b.id === id);
    me.badges[id] = new Date().toISOString().slice(0, 10);
    addXp(50);
    toast(`Badge: ${badge.name}`, badge.how);
    renderBadges();
}

function renderBadges() {
    $('badges').replaceChildren(...BADGES.map(b => h('li', {class: me.badges[b.id] ? 'got' : ''}, h('b', {}, b.name.toUpperCase()), b.how)));
}

// ================= Headline font shape (Geist Pixel ELSH axis) =================
function setShape(v) {
    document.documentElement.style.setProperty('--elsh', v);
    for (const b of document.querySelectorAll('[data-elsh]')) {
        b.classList.toggle('on', Number(b.dataset.elsh) === Number(v));
    }
    me.elsh = Number(v);
    save();
}

for (const b of document.querySelectorAll('[data-elsh]')) {
    b.addEventListener('click', () => setShape(b.dataset.elsh));
}
setShape(me.elsh || 1);

// ================= 3D lab =================
const canvas = $('gl');
const renderer = new THREE.WebGLRenderer({canvas, antialias: true, alpha: true});
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
const camera = new THREE.PerspectiveCamera(32, 1, 0.01, 200);
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.enablePan = false;
const loader = new THREE.TextureLoader();
const worlds = {};
let world = null;
let labVisible = true;

function upAt(lat, lon) {
    const p = lat * DEG;
    const l = lon * DEG;
    return new THREE.Vector3(Math.cos(p) * Math.cos(l), Math.sin(p), -Math.cos(p) * Math.sin(l));
}

function loadTexture(url) {
    return new Promise((resolve, reject) => {
        loader.load(url, t => {
            t.colorSpace = THREE.SRGBColorSpace;
            t.anisotropy = renderer.capabilities.getMaxAnisotropy();
            resolve(t);
        }, undefined, reject);
    });
}

function resize() {
    const r = canvas.parentElement.getBoundingClientRect();
    renderer.setSize(r.width, r.height, false);
    camera.aspect = r.width / Math.max(r.height, 1);
    camera.updateProjectionMatrix();
}
new ResizeObserver(resize).observe(canvas.parentElement);
new IntersectionObserver(e => {
    labVisible = e[0].isIntersecting;
}).observe($('lab'));

function glowSprite(color, size) {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const g = c.getContext('2d');
    const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    grad.addColorStop(0, color);
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 128, 128);
    const s = new THREE.Sprite(new THREE.SpriteMaterial({map: new THREE.CanvasTexture(c), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true}));
    s.scale.setScalar(size);
    return s;
}

// A sphere whose front half shows a full-disc photo (EPIC's Earth, SDO's Sun): each point takes the pixel
// straight in front of it, as the spacecraft saw it. `back` = brightness of the unseen half.
function discMaterial(radiusFrac, back, rimColor) {
    return new THREE.ShaderMaterial({
        uniforms: {
            map: {value: null},
            hasMap: {value: 0},
            rf: {value: radiusFrac},
            c: {value: new THREE.Vector2(0.5, 0.5)},
            back: {value: back},
            rim: {value: new THREE.Color(rimColor)},
        },
        vertexShader: `
            varying vec3 vN;
            varying vec3 vView;
            void main() {
                vN = normal;
                vView = normalize(normalMatrix * normal);
                gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            }`,
        fragmentShader: `
            uniform sampler2D map;
            uniform float hasMap;
            uniform float rf;
            uniform vec2 c;
            uniform float back;
            uniform vec3 rim;
            varying vec3 vN;
            varying vec3 vView;
            void main() {
                vec3 n = normalize(vN);
                vec3 img = texture2D(map, c + n.xy * rf).rgb;
                float front = smoothstep(-0.08, 0.2, n.z);
                vec3 col = mix(img * back, img, front) * hasMap;
                float edge = pow(1.0 - max(vView.z, 0.0), 3.0);
                col += rim * edge * 0.45;
                gl_FragColor = vec4(col, 1.0);
                #include <colorspace_fragment>
            }`,
    });
}

// ---------- Moon ----------
function buildMoon() {
    const scene = new THREE.Scene();
    const mat = new THREE.MeshStandardMaterial({color: 0xffffff, roughness: 1, metalness: 0});
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 256, 128), mat);
    scene.add(mesh);
    scene.add(new THREE.AmbientLight(0xffffff, 0.35));
    // A light over the viewer's left shoulder, so relief reads clearly from any side.
    const sun = new THREE.DirectionalLight(0xffffff, 2.6);
    scene.add(sun);
    layerTexture(currentLayer).then(t => {
        if (t) {
            mat.map = t;
            mat.needsUpdate = true;
        }
    });
    // LOLA heights (made by lunar-planner/build_terrain.py): relief, drawn 4x taller than real.
    fetch('/textures/moon-elevation-grid.bin').then(r => (r.ok ? r.arrayBuffer() : Promise.reject())).then(buf => {
        const m = new Int16Array(buf);
        if (m.length !== 1440 * 720) {
            return;
        }
        let lo = Infinity;
        let hi = -Infinity;
        for (const v of m) {
            lo = Math.min(lo, v);
            hi = Math.max(hi, v);
        }
        const px = new Uint8Array(m.length);
        for (let i = 0; i < m.length; i++) {
            px[i] = Math.round((255 * (m[i] - lo)) / (hi - lo));
        }
        const tex = new THREE.DataTexture(px, 1440, 720, THREE.RedFormat, THREE.UnsignedByteType);
        tex.flipY = true;
        tex.magFilter = THREE.LinearFilter;
        tex.minFilter = THREE.LinearFilter;
        tex.needsUpdate = true;
        const scale = (4 * (hi - lo)) / 1737400;
        mat.displacementMap = tex;
        mat.displacementScale = scale;
        mat.displacementBias = (4 * lo) / 1737400;
        mat.bumpMap = tex;
        mat.bumpScale = 3;
        mat.needsUpdate = true;
        worlds.moon.relief = true;
        if (world === worlds.moon && !selectedSite) {
            renderInfo();
        }
    }).catch(() => {});
    return {scene, distance: 4.2, min: 1.6, max: 9, pins: [], relief: false, light: sun, mat, mesh};
}

let sites = [];
let siteSources = {};
let selectedSite = null;

async function loadSites() {
    try {
        const j = await (await fetch('/data/sites.json')).json();
        sites = j.sites;
        siteSources = j.sources || {};
        $('stat-sites').textContent = sites.length;
    } catch (e) {
        sites = [];
    }
}

function makePins() {
    const w = worlds.moon;
    w.pins = sites.map(s => {
        const el = h('button', {class: `pin ${s.category}${me.sites[s.id] ? ' seen' : ''}`, title: s.name, onclick: () => selectSite(s)},
            h('i'), h('span', {}, s.name));
        $('pins').append(el);
        return {site: s, el, pos: upAt(s.lat, s.lon).multiplyScalar(1.012)};
    });
}

const fly = {t: 1, from: new THREE.Vector3(), to: new THREE.Vector3()};

async function selectSite(s) {
    selectedSite = s;
    drawLayerMap();
    for (const p of worlds.moon.pins) {
        p.el.classList.toggle('sel', p.site === s);
    }
    fly.from.copy(camera.position);
    fly.to.copy(upAt(s.lat, s.lon).multiplyScalar(camera.position.length()));
    fly.t = 0;
    if (!me.sites[s.id]) {
        me.sites[s.id] = true;
        addXp(10);
        worlds.moon.pins.find(p => p.site === s)?.el.classList.add('seen');
        if (Object.keys(me.sites).length >= 5) {
            award('explorer');
        }
    }
    renderInfo();
    try {
        const r = await fetch(`/api/diviner/point?lat=${s.lat}&lon=${s.lon}`);
        if (r.ok && selectedSite === s) {
            s.diviner = await r.json();
            renderInfo();
        }
    } catch (e) {
        // No Diviner data: the card says so.
    }
    // Where the Sun and Earth are in this site's sky right now: JPL Horizons, the same service the explorer uses.
    try {
        const r = await fetch(`/api/site?lat=${s.lat}&lon=${s.lon}&days=1`);
        if (r.ok && selectedSite === s) {
            const j = await r.json();
            const now = Date.now();
            s.skySource = typeof j.source === 'string' && j.source.includes('Astronomy Engine') ? 'astronomy' : 'horizons';
            s.sky = j.samples.reduce((best, x) => (Math.abs(new Date(x.t) - now) < Math.abs(new Date(best.t) - now) ? x : best));
            renderInfo();
        }
    } catch (e) {
        // Horizons unreachable: the card leaves the sky out.
    }
}

const POINTS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];

function point(az) {
    return POINTS[Math.round((((az % 360) + 360) % 360) / 22.5) % 16];
}

/** Sky chart from the site: centre = straight up, edge = horizon; N, E, S, W and a tick every 30 degrees. */
function skyCompass(x) {
    const c = h('canvas', {class: 'skydial', width: 300, height: 300});
    const g = c.getContext('2d');
    const R = 118;
    g.translate(150, 150);
    g.lineWidth = 2;
    // Altitude rings: horizon, 30 and 60 degrees up.
    for (const [r, label] of [[R, ''], [(R * 2) / 3, '30\u00b0'], [R / 3, '60\u00b0']]) {
        g.strokeStyle = r === R ? '#3a3a3a' : '#242424';
        g.beginPath();
        g.arc(0, 0, r, 0, Math.PI * 2);
        g.stroke();
        if (label) {
            g.fillStyle = '#555';
            g.font = '15px Geist Mono, monospace';
            g.fillText(label, 4, -r + 16);
        }
    }
    // Ticks every 30 degrees of azimuth, compass letters every 90.
    for (let az = 0; az < 360; az += 30) {
        const a = (az - 90) * DEG;
        g.strokeStyle = az % 90 === 0 ? '#777' : '#3a3a3a';
        g.beginPath();
        g.moveTo(Math.cos(a) * R, Math.sin(a) * R);
        g.lineTo(Math.cos(a) * (R + (az % 90 === 0 ? 10 : 6)), Math.sin(a) * (R + (az % 90 === 0 ? 10 : 6)));
        g.stroke();
    }
    g.font = '600 18px Geist Mono, monospace';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    for (const [name, az] of [['N', 0], ['E', 90], ['S', 180], ['W', 270]]) {
        const a = (az - 90) * DEG;
        g.fillStyle = name === 'N' ? '#f5c96b' : '#9a9a9a';
        g.fillText(name, Math.cos(a) * (R + 22), Math.sin(a) * (R + 22));
    }
    const dot = (az, el, color) => {
        const up = el >= 0;
        const r = up ? R * (1 - el / 90) : R;
        const a = (az - 90) * DEG;
        g.fillStyle = color;
        g.strokeStyle = color;
        g.lineWidth = 3;
        g.beginPath();
        g.arc(r * Math.cos(a), r * Math.sin(a), 12, 0, Math.PI * 2);
        if (up) {
            g.fill();
        } else {
            g.stroke();
        }
    };
    dot(x.earth_az, x.earth_el, '#5aa8ff');
    dot(x.sun_az, x.sun_el, '#f5c96b');
    return c;
}

function sparkline(values, highlight) {
    const c = h('canvas', {class: 'spark', width: 640, height: 200});
    const g = c.getContext('2d');
    const W = c.width;
    const H = c.height;
    const top = 24;
    const bottom = 34;
    const lo = 0;
    const hi = 420;
    const pts = values.map(v => [v.t, v.k]).sort((p, q) => p[0] - q[0]);
    const X = t => (t / 24) * W;
    const Y = k => top + (1 - (k - lo) / (hi - lo)) * (H - top - bottom);
    // Area under the curve, then the curve.
    const area = g.createLinearGradient(0, top, 0, H - bottom);
    area.addColorStop(0, 'rgba(245,201,107,0.35)');
    area.addColorStop(1, 'rgba(245,201,107,0)');
    g.beginPath();
    g.moveTo(X(pts[0][0]), H - bottom);
    for (const [t, k] of pts) {
        g.lineTo(X(t), Y(k));
    }
    g.lineTo(X(pts[pts.length - 1][0]), H - bottom);
    g.closePath();
    g.fillStyle = area;
    g.fill();
    g.beginPath();
    pts.forEach(([t, k], i) => {
        if (i === 0) {
            g.moveTo(X(t), Y(k));
        } else {
            g.lineTo(X(t), Y(k));
        }
    });
    g.strokeStyle = '#f5c96b';
    g.lineWidth = 3;
    g.stroke();
    // Time ticks.
    g.font = '20px Geist Mono, monospace';
    g.fillStyle = '#6e6e6e';
    g.textAlign = 'center';
    for (const [t, label] of [[0, 'midnight'], [6, '06:00'], [12, 'noon'], [18, '18:00'], [24, 'midnight']]) {
        g.fillText(label, Math.min(W - 44, Math.max(44, X(t))), H - 6);
    }
    // Label only the lowest and highest points.
    const mark = (t, k, color, text, above) => {
        g.fillStyle = color;
        g.beginPath();
        g.arc(X(t), Y(k), 6, 0, Math.PI * 2);
        g.fill();
        g.fillStyle = '#ededed';
        g.textAlign = 'center';
        g.fillText(text, Math.min(W - 40, Math.max(40, X(t))), above ? Y(k) - 12 : Y(k) - 12);
    };
    const coldest = pts.reduce((m, p) => (p[1] < m[1] ? p : m));
    const hottest = pts.reduce((m, p) => (p[1] > m[1] ? p : m));
    if (highlight) {
        mark(highlight.t, highlight.k, '#45d483', `${Math.round(highlight.k)} K`, true);
    } else {
        mark(coldest[0], coldest[1], '#5aa8ff', `${Math.round(coldest[1])} K`, true);
        mark(hottest[0], hottest[1], '#f5c96b', `${Math.round(hottest[1])} K`, true);
    }
    return c;
}

const SHORT_SOURCE = {'nssdc-apollo': 'NASA NSSDCA', wikipedia: 'Wikipedia (IAU names)'};

function sourcesLine(links) {
    return h('p', {class: 'src'}, 'Sources: ', links.map(([label, url], i) => [i ? ' \u00b7 ' : '', h('a', {href: url, target: '_blank', rel: 'noopener'}, label)]).flat());
}

function tempTiles(lowK, highK) {
    const tile = (label, k, cls) => h('div', {class: `tile ${cls}`}, h('span', {}, label), h('b', {class: 'px'}, `${Math.round(k)} K`), h('small', {}, `${Math.round(k - 273.15)} \u00b0C`));
    return h('div', {class: 'tiles'}, tile('Night', lowK, 'cold'), tile('Noon', highK, 'hot'));
}

function skyDetail(s) {
    const x = s.sky;
    const sunKm = x.sun_au * AU_KM;
    const row = (cls, name, el, az, dist) => h('div', {class: `sky-row ${cls}`},
        h('i', {class: el > 0 ? 'up' : ''}), h('b', {}, name),
        h('span', {}, `${el >= 0 ? '+' : ''}${el.toFixed(1)}\u00b0`), h('span', {}, `${az.toFixed(0)}\u00b0 ${point(az)}`), h('span', {}, dist));
    return h('div', {class: 'sky-now'},
        skyCompass(x),
        h('div', {class: 'sky-table'},
            h('div', {class: 'sky-row head'}, h('i'), h('b', {}, 'Sky now'), h('span', {}, 'altitude'), h('span', {}, 'direction'), h('span', {}, 'distance')),
            row('sun', 'Sun', x.sun_el, x.sun_az, `${(sunKm / 1e6).toFixed(1)} M km`),
            row('earth', 'Earth', x.earth_el, x.earth_az, `${Math.round(x.earth_km).toLocaleString('en-US')} km`),
            h('p', {class: 'ratio'}, `The Sun is ${Math.round(sunKm / x.earth_km)}\u00d7 farther away than Earth. Filled dot = above the horizon.`)));
}

function moonInfo() {
    const s = selectedSite;
    if (!s) {
        return [
            h('h3', {class: 'px'}, 'THE MOON'),
            h('p', {class: 'sub'}, `${sites.length} landing sites \u00b7 select a marker`),
            h('ul', {class: 'legend-list'},
                h('li', {}, h('i', {class: 'dot apollo'}), 'Apollo landings'),
                h('li', {}, h('i', {class: 'dot robotic'}), 'Robotic landers'),
                h('li', {}, h('i', {class: 'dot south-pole'}), 'South-pole features')),
            factList('moon', 1),
            sourcesLine([['LRO LROC map', 'https://svs.gsfc.nasa.gov/4720/'], ['LOLA heights', SOURCES.lola.url], ['NASA Moon facts', SOURCES.moonFacts.url]]),
        ];
    }
    const src = siteSources[s.source];
    const d = s.diviner;
    const kind = s.category === 'south-pole' ? 'South-pole feature' : s.category === 'apollo' ? 'Apollo landing' : 'Robotic lander';
    const kids = [
        h('h3', {class: 'px'}, s.name.toUpperCase()),
        h('p', {class: 'sub'}, [kind, s.agency, s.year].filter(Boolean).join(' \u00b7 ')),
        h('p', {class: 'coords'}, `${fmtLat(s.lat)}, ${fmtLon(s.lon)}`),
    ];
    if (d) {
        const swing = Math.round(d.max_k - d.min_k);
        kids.push(
            tempTiles(d.min_k, d.max_k),
            sparkline(d.local_time_h.map((t, i) => ({t, k: d.temp_k[i]}))),
            h('p', {class: 'takeaway'}, `${swing} K swing. No air holds the heat.`),
        );
    } else {
        kids.push(h('p', {class: 'takeaway'}, 'Loading the measured temperature\u2026'));
    }
    if (s.sky) {
        kids.push(skyDetail(s));
    }
    const street = new URLSearchParams({view: 'surface', lat: s.lat.toFixed(5), lon: s.lon.toFixed(5), name: s.name});
    kids.push(h('a', {class: 'btn primary street', href: `/classic?${street}`}, 'Open street view \u2192'));
    // On the team's dev server (npm run dev) the sky comes from Astronomy Engine, which the team checks against Horizons.
    const sky = s.skySource === 'astronomy' ? ['Astronomy Engine, checked with JPL Horizons', 'https://github.com/cosinekitty/astronomy'] : ['JPL Horizons', SOURCES.horizons.url];
    kids.push(sourcesLine([['LRO Diviner', SOURCES.diviner.url], sky, [SHORT_SOURCE[s.source] || s.source, src ? src.url : '#']]));
    kids.push(h('button', {class: 'link-btn', onclick: () => {
        selectedSite = null;
        for (const p of worlds.moon.pins) {
            p.el.classList.remove('sel');
        }
        renderInfo();
    }}, '\u2190 All sites'));
    return kids;
}

// ---------- Earth (NASA EPIC) ----------
function buildEarth() {
    const scene = new THREE.Scene();
    const mat = discMaterial(0.402, 0.03, 0x5aa8ff);
    mat.uniforms.c.value.set(0.502, 0.5);
    scene.add(new THREE.Mesh(new THREE.SphereGeometry(1, 128, 64), mat));
    const halo = glowSprite('rgba(90,168,255,0.35)', 3.0);
    scene.add(halo);
    const w = {scene, distance: 4.4, min: 1.8, max: 9, meta: null, error: null};
    $('loading').hidden = false;
    loadTexture('/api/learn/epic.jpg').then(t => {
        mat.uniforms.map.value = t;
        mat.uniforms.hasMap.value = 1;
        award('earth');
    }).catch(() => {
        w.error = 'NASA EPIC did not answer. Check the internet connection.';
        renderInfo();
    }).finally(() => {
        $('loading').hidden = true;
    });
    fetch('/api/epic').then(r => r.json()).then(j => {
        w.meta = j;
        if (world === w) {
            renderInfo();
        }
    }).catch(() => {});
    return w;
}

function earthInfo() {
    const w = worlds.earth;
    const m = w.meta;
    return [
        h('h3', {class: 'px'}, 'EARTH, TODAY'),
        h('p', {class: 'sub'}, m && m.date_utc ? `${m.date_utc} UTC \u00b7 NASA EPIC` : 'NASA EPIC'),
        w.error ? h('p', {class: 'takeaway'}, w.error) : h('p', {class: 'takeaway'},
            'From 1.5 million km, toward the Sun.',
            m && m.centroid && m.centroid.lat !== undefined ? ` Centred on ${fmtLat(m.centroid.lat)}, ${fmtLon(m.centroid.lon)}.` : ''),
        factList('earth', 1),
        sourcesLine([['NASA EPIC', SOURCES.epic.url], ['NASA Earth facts', SOURCES.earthFacts.url]]),
    ];
}

// ---------- Sun (NASA SDO) ----------
const SDO = [
    {id: '0171', label: 'AIA 171 Å', rf: 0.39, text: 'Gold: the corona and upper transition region, about 600,000 °C. Loops trace magnetic fields.'},
    {id: '0193', label: 'AIA 193 Å', rf: 0.39, text: 'Bronze: the corona at about 1 million °C, and hotter flare plasma. Dark patches are coronal holes.'},
    {id: '0304', label: 'AIA 304 Å', rf: 0.39, text: 'Red: the chromosphere and transition region, about 50,000 °C. Shows filaments and prominences.'},
    {id: 'HMIIC', label: 'HMI visible', rf: 0.469, text: 'The visible surface (photosphere), about 5,500 °C. Dark spots are sunspots.'},
];

function buildSun() {
    const scene = new THREE.Scene();
    const mat = discMaterial(0.39, 0.45, 0xffb347);
    scene.add(new THREE.Mesh(new THREE.SphereGeometry(1, 128, 64), mat));
    scene.add(glowSprite('rgba(255,180,80,0.55)', 3.4));
    const w = {scene, distance: 4.4, min: 1.8, max: 9, mat, channel: '0171', error: null};
    setSdo(w, '0171');
    return w;
}

function setSdo(w, id) {
    const ch = SDO.find(c => c.id === id);
    w.channel = id;
    $('loading').hidden = false;
    loadTexture(`/api/learn/sdo/${id}.jpg`).then(t => {
        if (w.channel !== id) {
            return;
        }
        w.mat.uniforms.map.value = t;
        w.mat.uniforms.hasMap.value = 1;
        w.mat.uniforms.rf.value = ch.rf;
        w.error = null;
        me.sdo[id] = true;
        save();
        if (SDO.every(c => me.sdo[c.id])) {
            award('sun');
        }
    }).catch(() => {
        w.error = 'NASA SDO did not answer. Check the internet connection.';
    }).finally(() => {
        $('loading').hidden = true;
        if (world === w) {
            renderInfo();
        }
    });
}

function sunInfo() {
    const w = worlds.sun;
    const ch = SDO.find(c => c.id === w.channel);
    return [
        h('h3', {class: 'px'}, 'THE SUN, TODAY'),
        h('p', {class: 'sub'}, 'NASA Solar Dynamics Observatory'),
        h('div', {class: 'chips'}, SDO.map(c => h('button', {class: c.id === w.channel ? 'on' : '', onclick: () => setSdo(w, c.id)}, c.label))),
        h('p', {class: 'takeaway'}, w.error || ch.text),
        factList('sun', 1),
        sourcesLine([['NASA SDO', SOURCES.sdo.url], ['NASA Sun facts', SOURCES.sunFacts.url]]),
    ];
}

// ---------- Sun, Earth and Moon now (Astronomy Engine, checked against JPL Horizons) ----------
const ORBIT_R = 3;

function eqjToScene(v) {
    // Equatorial J2000 (x toward the vernal equinox, z north) to the scene (y up).
    return new THREE.Vector3(v.x, v.z, -v.y);
}

function buildSystem() {
    const scene = new THREE.Scene();
    const earthMat = new THREE.MeshStandardMaterial({color: 0x2b6fd6, roughness: 0.7, emissive: 0x020814});
    const earth = new THREE.Mesh(new THREE.SphereGeometry(0.42, 64, 32), earthMat);
    scene.add(earth);
    const moonMat = new THREE.MeshStandardMaterial({color: 0xffffff, roughness: 1});
    loadTexture('/textures/moon-hd.jpg').then(t => {
        moonMat.map = t;
        moonMat.needsUpdate = true;
    }).catch(() => {});
    const moon = new THREE.Mesh(new THREE.SphereGeometry(0.16, 64, 32), moonMat);
    scene.add(moon);
    scene.add(new THREE.AmbientLight(0xffffff, 0.06));
    const light = new THREE.DirectionalLight(0xffffff, 3);
    scene.add(light);
    const sunGlow = glowSprite('rgba(255,200,110,0.9)', 1.6);
    scene.add(sunGlow);
    const ray = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]),
        new THREE.LineDashedMaterial({color: 0xf5c96b, dashSize: 0.12, gapSize: 0.1, transparent: true, opacity: 0.5}));
    scene.add(ray);
    // The Moon's real path over one month, drawn at the scene's scale.
    const now = new Date();
    const path = [];
    for (let i = 0; i <= 120; i++) {
        const t = new Date(now.getTime() + (i / 120) * 27.32 * 86400000);
        path.push(eqjToScene(GeoMoon(t)).normalize().multiplyScalar(ORBIT_R));
    }
    scene.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(path), new THREE.LineBasicMaterial({color: 0x3a3a3a})));
    const w = {scene, distance: 9, min: 4, max: 16, earth, moon, light, sunGlow, ray, offsetDays: 0, check: null};
    placeSystem(w);
    return w;
}

function systemDate(w) {
    return new Date(Date.now() + w.offsetDays * 86400000);
}

function phaseName(angle) {
    const names = ['New Moon', 'Waxing crescent', 'First quarter', 'Waxing gibbous', 'Full Moon', 'Waning gibbous', 'Last quarter', 'Waning crescent'];
    return names[Math.round(angle / 45) % 8];
}

function placeSystem(w) {
    const t = systemDate(w);
    const sunDir = eqjToScene(GeoVector(Body.Sun, t, true)).normalize();
    const moonVec = GeoMoon(t);
    const moonPos = eqjToScene(moonVec).normalize().multiplyScalar(ORBIT_R);
    w.moon.position.copy(moonPos);
    w.light.position.copy(sunDir).multiplyScalar(20);
    w.sunGlow.position.copy(sunDir).multiplyScalar(7);
    w.ray.geometry.setFromPoints([sunDir.clone().multiplyScalar(6.4), new THREE.Vector3()]);
    w.ray.computeLineDistances();
    w.moon.lookAt(0, 0, 0);
    w.moon.rotateY(-Math.PI / 2);
    const illum = Illumination(Body.Moon, t);
    w.state = {
        t,
        fraction: illum.phase_fraction,
        angle: MoonPhase(t),
        distKm: Math.hypot(moonVec.x, moonVec.y, moonVec.z) * AU_KM,
    };
}

function phaseIcon(angle) {
    // The Moon's lit part as seen from Earth (northern-hemisphere view: waxing lit on the right).
    const c = h('canvas', {width: 120, height: 120, style: 'width:60px;height:60px'});
    const g = c.getContext('2d');
    const r = 52;
    g.translate(60, 60);
    g.fillStyle = '#1b1b1b';
    g.beginPath();
    g.arc(0, 0, r, 0, Math.PI * 2);
    g.fill();
    const a = angle * DEG;
    const k = Math.cos(a); // terminator ellipse: +1 new, -1 full
    g.fillStyle = '#e8e8e8';
    g.beginPath();
    const waxing = angle < 180;
    g.arc(0, 0, r, -Math.PI / 2, Math.PI / 2, !waxing);
    g.ellipse(0, 0, Math.abs(k) * r, r, 0, Math.PI / 2, -Math.PI / 2, (k > 0) === waxing);
    g.fill();
    return c;
}

async function checkHorizons(w) {
    const t = w.state.t;
    const pad = n => String(n).padStart(2, '0');
    const fmt = d => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
    const q = new URLSearchParams({
        format: 'json', COMMAND: "'301'", OBJ_DATA: "'NO'", MAKE_EPHEM: "'YES'", EPHEM_TYPE: "'OBSERVER'",
        CENTER: "'500@399'", START_TIME: `'${fmt(t)}'`, STOP_TIME: `'${fmt(new Date(t.getTime() + 60000))}'`,
        STEP_SIZE: "'1 m'", QUANTITIES: "'10'", CSV_FORMAT: "'YES'",
    });
    w.check = {busy: true};
    renderInfo();
    try {
        const j = await (await fetch(`/api/horizons?${q}`)).json();
        const body = j.result.split('$$SOE')[1].split('$$EOE')[0].trim().split('\n')[0];
        const nums = body.split(',').map(x => x.trim()).filter(x => x !== '' && !Number.isNaN(Number(x)));
        const horizons = Number(nums[nums.length - 1]);
        const ours = 100 * w.state.fraction;
        w.check = {horizons, ours, diff: Math.abs(horizons - ours)};
        award('horizons');
    } catch (e) {
        w.check = {error: 'JPL Horizons did not answer. Check the internet connection.'};
    }
    renderInfo();
}

function systemInfo() {
    const w = worlds.system;
    const s = w.state;
    const c = w.check;
    return [
        h('h3', {class: 'px'}, 'SUN · EARTH · MOON'),
        h('p', {class: 'sub'}, `${s.t.toISOString().slice(0, 16).replace('T', ' ')} UTC · not to scale`),
        h('div', {class: 'live'}, h('b', {}, 'MOON PHASE'), h('div', {style: 'display:flex;gap:14px;align-items:center'}, phaseIcon(s.angle),
            h('div', {}, h('div', {style: 'font-size:18px'}, phaseName(s.angle)), `${(100 * s.fraction).toFixed(1)}% lit · ${Math.round(s.distKm).toLocaleString('en-US')} km away`))),
        h('label', {class: 'src', for: 'days'}, `Move time: ${w.offsetDays >= 0 ? '+' : ''}${w.offsetDays.toFixed(1)} days`),
        h('input', {id: 'days', class: 'range', type: 'range', min: -15, max: 15, step: 0.25, value: w.offsetDays, oninput: e => {
            w.offsetDays = Number(e.target.value);
            w.check = null;
            placeSystem(w);
            renderInfo();
            $('days')?.focus();
        }}),
        h('p', {class: 'takeaway'}, 'Half the Moon is always lit. The phase is how much of that half faces us.'),
        h('button', {class: 'btn', disabled: c && c.busy ? 'disabled' : null, onclick: () => checkHorizons(w)}, c && c.busy ? 'Asking JPL Horizons…' : 'Check with JPL Horizons'),
        c && c.error ? h('p', {class: 'why'}, c.error) : null,
        c && c.horizons !== undefined ? h('dl', {class: 'kv', style: 'margin-top:14px'},
            h('dt', {}, 'Astronomy Engine'), h('dd', {}, `${c.ours.toFixed(2)}% lit`),
            h('dt', {}, 'JPL Horizons'), h('dd', {}, `${c.horizons.toFixed(2)}% lit`),
            h('dt', {}, 'Difference'), h('dd', {}, `${c.diff.toFixed(2)} points`)) : null,
        sourceLink('horizons'),
    ];
}

// ---------- Shared ----------
function factList(body, n) {
    const list = shuffle(FACTS.filter(f => f.body === body)).slice(0, n);
    return h('ul', {class: 'facts'}, list.map(f => h('li', {}, f.text)));
}

const BUILD = {moon: buildMoon, earth: buildEarth, sun: buildSun, system: buildSystem};
const INFO = {moon: moonInfo, earth: earthInfo, sun: sunInfo, system: systemInfo};
let worldName = 'moon';

function renderInfo() {
    $('info').replaceChildren(...INFO[worldName]().filter(Boolean));
}

function showWorld(name) {
    worldName = name;
    if (!worlds[name]) {
        worlds[name] = BUILD[name]();
        if (name === 'moon') {
            makePins();
        }
    }
    world = worlds[name];
    for (const b of document.querySelectorAll('[data-world]')) {
        b.classList.toggle('on', b.dataset.world === name);
        b.setAttribute('aria-selected', b.dataset.world === name);
    }
    $('pins').hidden = name !== 'moon';
    camera.position.set(0, 0, world.distance);
    if (name === 'moon') {
        camera.position.copy(upAt(5, 20).multiplyScalar(world.distance));
    }
    if (name === 'system') {
        camera.position.set(0, 6, 7);
    }
    controls.minDistance = world.min;
    controls.maxDistance = world.max;
    controls.update();
    $('stage-note').textContent = {
        moon: 'Double-click any spot for street view · relief 4×',
        earth: 'NASA EPIC · DSCOVR',
        sun: 'NASA SDO · AIA and HMI',
        system: 'Positions: Astronomy Engine · distances not to scale',
    }[name];
    renderInfo();
}

for (const b of document.querySelectorAll('[data-world]')) {
    b.addEventListener('click', () => showWorld(b.dataset.world));
}

let lastFrame = performance.now();
const tmp = new THREE.Vector3();

function frame() {
    requestAnimationFrame(frame);
    if (!labVisible || !world) {
        return;
    }
    const now = performance.now();
    const dt = Math.min(0.1, (now - lastFrame) / 1000);
    lastFrame = now;
    if (fly.t < 1) {
        fly.t = Math.min(1, fly.t + dt / 0.9);
        const e = 1 - Math.pow(1 - fly.t, 3);
        const len = fly.from.length();
        camera.position.copy(fly.from).normalize().lerp(tmp.copy(fly.to).normalize(), e).normalize().multiplyScalar(len);
    }
    controls.update();
    if (world === worlds.moon) {
        world.light.position.copy(camera.position).add(tmp.set(-3, 2, 0).applyQuaternion(camera.quaternion));
        const W = canvas.clientWidth;
        const H = canvas.clientHeight;
        for (const p of world.pins) {
            const facing = tmp.copy(camera.position).sub(p.pos).normalize().dot(p.pos) > 0.15;
            if (!facing) {
                p.el.style.opacity = 0;
                p.el.style.pointerEvents = 'none';
                continue;
            }
            const v = p.pos.clone().project(camera);
            p.el.style.left = `${((v.x + 1) / 2) * W}px`;
            p.el.style.top = `${((1 - v.y) / 2) * H}px`;
            p.el.style.opacity = 1;
            p.el.style.pointerEvents = 'auto';
        }
    }
    if (world === worlds.earth || world === worlds.sun) {
        world.scene.children[0].rotation.y += dt * 0.03;
    }
    renderer.render(world.scene, camera);
}

// ================= Facts in 3D =================
const dots = createDots($('dots'), (scene, i, n) => {
    $('dot-big').textContent = scene.big;
    $('dot-line').textContent = scene.line;
    $('dot-src').href = scene.src;
    $('dot-steps').replaceChildren(...Array.from({length: n}, (_, k) => h('i', {class: k === i ? 'on' : ''})));
    if (!me.read[scene.id]) {
        me.read[scene.id] = true;
        addXp(5);
        if (Object.keys(me.read).length >= 5) {
            award('reader');
        }
    }
});
$('dot-prev').onclick = () => dots.prev();
$('dot-next').onclick = () => dots.next();

// ================= Exercises =================
const arena = $('arena');
let timerId = null;

function openArena(...kids) {
    arena.hidden = false;
    arena.replaceChildren(...kids.filter(Boolean));
}

function arenaTop(label, score) {
    return h('div', {class: 'arena-top'}, h('span', {}, label), h('span', {class: 'score'}, String(score)));
}

// ---------- Mission quiz ----------
function startQuiz() {
    const game = {qs: shuffle(QUIZ).slice(0, 10), i: 0, score: 0, streak: 0, results: []};
    quizQuestion(game);
    arena.scrollIntoView({behavior: 'smooth', block: 'start'});
}

function quizQuestion(game) {
    const item = game.qs[game.i];
    const order = shuffle(item.options.map((text, k) => ({text, right: k === item.a})));
    const bar = h('i', {style: 'width:100%'});
    const started = performance.now();
    const LIMIT = 20000;
    let answered = false;
    const buttons = order.map(o => h('button', {onclick: () => answer(o)}, o.text));

    function answer(o) {
        if (answered) {
            return;
        }
        answered = true;
        clearInterval(timerId);
        const left = Math.max(0, LIMIT - (performance.now() - started)) / 1000;
        let gained = 0;
        game.results.push(Boolean(o && o.right));
        arena.querySelector('.pdots').replaceWith(progressDots(game.qs.length, game.results));
        if (o && o.right) {
            burst(buttons[order.indexOf(o)]);
            game.streak++;
            gained = Math.round((100 + left * 5) * (game.streak >= 3 ? 1.5 : 1));
            game.score += gained;
        } else {
            game.streak = 0;
        }
        buttons.forEach((b, k) => {
            b.disabled = true;
            if (order[k].right) {
                b.classList.add('right');
            } else if (order[k] === o) {
                b.classList.add('wrong');
            }
        });
        arena.querySelector('.score').textContent = String(game.score);
        const last = game.i === game.qs.length - 1;
        arena.append(
            h('p', {class: 'why'}, o && o.right ? `Correct, +${gained}${game.streak >= 3 ? ' (streak 1.5×)' : ''}. ` : (o ? 'Not quite. ' : 'Time is up. '), item.why, ' ', sourceLink(item.src)),
            h('div', {class: 'submit'}, h('button', {class: 'btn primary', onclick: () => {
                if (last) {
                    finish('quiz', game.score, `${game.qs.length} questions`);
                } else {
                    game.i++;
                    quizQuestion(game);
                }
            }}, last ? 'See result' : 'Next question')));
    }

    openArena(
        h('div', {class: 'arena-top'}, h('span', {}, `Question ${game.i + 1} of ${game.qs.length}`), h('span', {class: 'timer'}, bar),
            game.streak >= 2 ? h('span', {}, `Streak ${game.streak}`) : null, h('span', {class: 'score'}, String(game.score))),
        progressDots(game.qs.length, game.results),
        h('p', {class: 'question'}, item.q),
        h('div', {class: 'options'}, buttons));
    clearInterval(timerId);
    timerId = setInterval(() => {
        const f = Math.max(0, 1 - (performance.now() - started) / LIMIT);
        bar.style.width = `${f * 100}%`;
        if (f === 0) {
            answer(null);
        }
    }, 100);
}

// ---------- Temperature estimate (LRO Diviner) ----------
async function startHotCold() {
    if (!sites.length) {
        await loadSites();
    }
    const game = {round: 0, score: 0, picks: shuffle(sites).slice(0, 5)};
    arena.scrollIntoView({behavior: 'smooth', block: 'start'});
    hotColdRound(game);
}

async function hotColdRound(game) {
    const s = game.picks[game.round];
    openArena(arenaTop(`Round ${game.round + 1} of 5`, game.score), h('p', {class: 'question'}, 'Loading measured data…'));
    let d;
    try {
        const r = await fetch(`/api/diviner/point?lat=${s.lat}&lon=${s.lon}`);
        if (!r.ok) {
            throw Error();
        }
        d = await r.json();
    } catch (e) {
        openArena(arenaTop('Temperature estimate', game.score), h('p', {class: 'question'}, 'The Diviner temperature data is not on this computer, so this exercise cannot run.'));
        return;
    }
    const k = Math.floor(Math.random() * d.temp_k.length);
    const truth = d.temp_k[k];
    const hour = d.local_time_h[k];
    const hh = String(Math.floor(hour)).padStart(2, '0');
    const mm = String(Math.round((hour % 1) * 60)).padStart(2, '0');
    const sunUp = hour > 6 && hour < 18;
    const slider = h('input', {class: 'range', type: 'range', min: 40, max: 400, step: 1, value: 200, 'aria-label': 'Your estimate in kelvin'});
    const out = h('output', {}, '200 K');
    const celsius = h('span', {class: 'quiet mono'}, '-73 °C');
    const knob = h('span', {class: 'knob', style: 'left:44.4%'});
    const thermo = h('div', {class: 'thermo', style: `background:${HEAT_GRADIENT}`}, knob);
    const paint = () => {
        out.textContent = `${slider.value} K`;
        out.style.color = heatColor(Number(slider.value));
        celsius.textContent = `${Math.round(slider.value - 273.15)} °C`;
        knob.style.left = `${(100 * (slider.value - 40)) / 360}%`;
    };
    slider.addEventListener('input', paint);
    paint();
    const pos = k2 => `${(100 * (k2 - 40)) / 360}%`;
    const go = h('button', {class: 'btn primary', onclick: () => {
        go.disabled = true;
        slider.disabled = true;
        const guess = Number(slider.value);
        const err = Math.abs(guess - truth);
        const pts = Math.max(0, Math.round(200 - 2 * err));
        if (pts >= 150) {
            burst(go, heatColor(truth));
        }
        game.score += pts;
        arena.querySelector('.score').textContent = String(game.score);
        thermo.append(h('span', {class: 'mark', style: `left:${pos(guess)}`}, h('b', {}, `you ${guess} K`)),
            h('span', {class: 'mark truth', style: `left:${pos(truth)}`}, h('b', {}, `Diviner ${Math.round(truth)} K`)));
        const last = game.round === 4;
        arena.append(
            h('p', {class: 'why'}, `Measured: ${Math.round(truth)} K (${Math.round(truth - 273.15)} °C). You were ${Math.round(err)} K off: +${pts}. `,
                sunUp ? 'In daylight the surface heats quickly; it is hottest near local noon.' : 'At night the surface loses heat to space; with no air, it gets very cold.'),
            sparkline(d.local_time_h.map((t, i) => ({t, k: d.temp_k[i]})), {t: hour, k: truth}),
            h('p', {class: 'src'}, 'The full lunar day at this site, by local time. ', d.source),
            h('div', {class: 'submit'}, h('button', {class: 'btn primary', onclick: () => {
                if (last) {
                    finish('hotcold', game.score, '5 sites');
                } else {
                    game.round++;
                    hotColdRound(game);
                }
            }}, last ? 'See result' : 'Next site')));
    }}, 'Lock in estimate');
    openArena(
        arenaTop(`Round ${game.round + 1} of 5`, game.score),
        h('div', {class: 'hc-row'},
            h('p', {class: 'question'}, `${s.name} (${fmtLat(s.lat)}, ${fmtLon(s.lon)}) at ${hh}:${mm} local solar time. ${sunUp ? 'The Sun is up.' : 'The Sun is down.'} How warm is the surface?`),
            h('figure', {class: 'hc-map'}, siteLocator(s), h('figcaption', {class: 'mono'}, sunUp ? '\u2600 Sun up' : '\u263e Sun down'))),
        h('div', {class: 'guess'}, slider, h('div', {}, out, h('br'), celsius)),
        thermo,
        go);
}

// ---------- Result and leaderboard ----------
function finish(game, score, what) {
    clearInterval(timerId);
    me.best[game] = Math.max(me.best[game] || 0, score);
    save();
    addXp(Math.round(score / 20));
    if (game === 'quiz' && score >= 2000) {
        award('quiz');
    }
    if (game === 'hotcold' && score >= 600) {
        award('thermo');
    }
    const name = h('input', {type: 'text', maxlength: 20, placeholder: 'Your name', value: me.name || '', 'aria-label': 'Name for the leaderboard'});
    const msg = h('span', {class: 'quiet'});
    const post = h('button', {class: 'btn primary', onclick: async () => {
        const n = name.value.trim();
        if (!n) {
            msg.textContent = 'Enter a name first.';
            return;
        }
        post.disabled = true;
        try {
            const r = await fetch('/api/learn/score', {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({name: n, game, score})});
            const j = await r.json();
            if (!r.ok) {
                throw Error(j.error || 'Could not save the score.');
            }
            me.name = n;
            save();
            award('board');
            msg.textContent = `Saved. You are number ${j.rank}.`;
            showBoard(game);
            $('board').scrollIntoView({behavior: 'smooth'});
        } catch (e) {
            msg.textContent = e.message;
            post.disabled = false;
        }
    }}, 'Post to leaderboard');
    openArena(
        h('p', {class: 'kicker mono'}, `RESULT · ${what.toUpperCase()}`),
        h('div', {class: 'final-row'}, scoreRing(score, game === 'quiz' ? 2800 : 1000)),
        h('p', {class: 'quiet'}, `+${Math.round(score / 20)} XP`),
        h('div', {class: 'submit'}, name, post, h('button', {class: 'btn', onclick: () => (game === 'quiz' ? startQuiz() : startHotCold())}, 'Play again'), msg));
}

let boardGame = 'quiz';

async function showBoard(game) {
    boardGame = game;
    for (const b of document.querySelectorAll('[data-board]')) {
        b.classList.toggle('on', b.dataset.board === game);
    }
    try {
        const j = await (await fetch(`/api/learn/leaderboard?game=${game}`)).json();
        const rows = j.top.map((r, i) => h('li', {class: me.name && r.name.toLowerCase() === me.name.toLowerCase() ? 'me' : ''},
            h('span', {class: 'pos'}, String(i + 1).padStart(2, '0')), h('span', {class: 'who'}, r.name), h('span', {class: 'when'}, r.at), h('span', {class: 'pts'}, String(r.score))));
        $('ranks').replaceChildren(...(rows.length ? rows : [h('li', {class: 'empty-row'}, h('span', {class: 'empty'}, 'No scores yet. Be the first.'))]));
    } catch (e) {
        $('ranks').replaceChildren(h('li', {}, h('span', {class: 'empty'}, 'The leaderboard needs the Flask server (lunar-planner).')));
    }
}

async function countPlayers() {
    let n = 0;
    for (const g of ['quiz', 'hotcold']) {
        try {
            n += (await (await fetch(`/api/learn/leaderboard?game=${g}`)).json()).players;
        } catch (e) {
            // ignore
        }
    }
    $('stat-players').textContent = n;
}

for (const b of document.querySelectorAll('[data-board]')) {
    b.addEventListener('click', () => showBoard(b.dataset.board));
}
for (const b of document.querySelectorAll('[data-start]')) {
    b.addEventListener('click', () => (b.dataset.start === 'quiz' ? startQuiz() : startHotCold()));
}

// ================= Scroll: reveal sections, mark the current one in the top bar =================
const revealer = new IntersectionObserver(entries => {
    for (const e of entries) {
        if (e.isIntersecting) {
            e.target.classList.add('in');
            revealer.unobserve(e.target);
        }
    }
}, {rootMargin: '0px 0px -8% 0px'});
for (const el of document.querySelectorAll('[data-reveal]')) {
    revealer.observe(el);
}
const navLinks = [...document.querySelectorAll('.top nav a')];
const sectionSpy = new IntersectionObserver(entries => {
    for (const e of entries) {
        if (e.isIntersecting) {
            for (const a of navLinks) {
                a.classList.toggle('on', a.getAttribute('href') === `#${e.target.id}`);
            }
        }
    }
}, {rootMargin: '-45% 0px -50% 0px'});
for (const id of ['hero', 'lab', 'facts', 'topics', 'guide', 'timeline', 'play', 'board', 'more']) {
    sectionSpy.observe(document.getElementById(id));
}

// ================= Double-click the Moon: open the explorer's street view at that spot =================
const picker = new THREE.Raycaster();

function streetViewUrl(lat, lon, name) {
    const q = new URLSearchParams({view: 'surface', lat: lat.toFixed(5), lon: lon.toFixed(5), name});
    return `/classic?${q}`;
}

canvas.addEventListener('dblclick', e => {
    if (worldName !== 'moon' || !worlds.moon) {
        return;
    }
    const r = canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    picker.setFromCamera(ndc, camera);
    const hit = picker.intersectObject(worlds.moon.mesh, false)[0];
    if (!hit) {
        return;
    }
    // Moon axes: x = (0 N, 0 E), y = north pole, z = (0 N, 90 W). See upAt().
    const p = worlds.moon.mesh.worldToLocal(hit.point.clone()).normalize();
    const lat = Math.asin(Math.max(-1, Math.min(1, p.y))) / DEG;
    const lon = Math.atan2(-p.z, p.x) / DEG;
    const name = `${fmtLat(lat)}, ${fmtLon(lon)}`;
    toast('Opening street view', name);
    canvas.classList.add('leaving');
    setTimeout(() => {
        window.location.href = streetViewUrl(lat, lon, name);
    }, 450);
});

// ================= Colour layers (corner panel on the moving background) =================
let currentLayer = 'photo';

async function drawLayerMap() {
    const cv = $('layer-map');
    const g = cv.getContext('2d');
    const W = cv.width;
    const H = cv.height;
    const img = await layerImage(currentLayer);
    g.fillStyle = '#0a0a0a';
    g.fillRect(0, 0, W, H);
    if (img) {
        g.drawImage(img, 0, 0, W, H);
    }
    g.strokeStyle = 'rgba(255,255,255,0.18)';
    g.lineWidth = 1;
    for (let lon = -150; lon < 180; lon += 30) {
        const x = ((lon + 180) / 360) * W;
        g.beginPath();
        g.moveTo(x, 0);
        g.lineTo(x, H);
        g.stroke();
    }
    for (const lat of [-60, -30, 0, 30, 60]) {
        const y = ((90 - lat) / 180) * H;
        g.beginPath();
        g.moveTo(0, y);
        g.lineTo(W, y);
        g.stroke();
    }
    for (const site of sites) {
        const x = ((site.lon + 180) / 360) * W;
        const y = ((90 - site.lat) / 180) * H;
        const sel = selectedSite && selectedSite.id === site.id;
        g.fillStyle = sel ? '#ffffff' : 'rgba(79,227,193,0.9)';
        g.beginPath();
        g.arc(x, y, sel ? 6 : 3, 0, Math.PI * 2);
        g.fill();
        if (sel) {
            g.strokeStyle = '#000';
            g.lineWidth = 2;
            g.stroke();
        }
    }
    const legend = await layerLegend(currentLayer);
    $('layer-grad').style.background = legend.gradient || 'none';
    $('layer-grad').hidden = !legend.gradient;
    $('layer-lo').textContent = legend.lo || '';
    $('layer-hi').textContent = legend.hi || '';
    $('layer-title').textContent = legend.title;
}

async function setLayer(kind) {
    currentLayer = kind;
    for (const b of document.querySelectorAll('[data-layer]')) {
        b.classList.toggle('on', b.dataset.layer === kind);
    }
    $('layer-map').classList.add('swap');
    setBgLayer(kind);
    const t = await layerTexture(kind);
    if (t && worlds.moon) {
        worlds.moon.mat.map = t;
        worlds.moon.mat.needsUpdate = true;
    }
    await drawLayerMap();
    $('layer-map').classList.remove('swap');
}

// A thin line under the top bar shows how far down the page you are.
function scrollLine() {
    const max = document.documentElement.scrollHeight - window.innerHeight;
    document.documentElement.style.setProperty('--scroll', max > 0 ? (window.scrollY / max).toFixed(4) : '0');
}
window.addEventListener('scroll', scrollLine, {passive: true});
scrollLine();

for (const b of document.querySelectorAll('[data-layer]')) {
    b.addEventListener('click', () => setLayer(b.dataset.layer));
}

// ================= Tabs: Education and Our team =================
function showTab() {
    const team = window.location.hash === '#team';
    $('team').hidden = !team;
    $('view-learn').hidden = team;
    document.body.classList.toggle('on-team', team);
    $('tab-team').classList.toggle('on', team);
    $('tab-learn').classList.toggle('on', !team);
    $('tab-team').setAttribute('aria-selected', String(team));
    $('tab-learn').setAttribute('aria-selected', String(!team));
    if (team) {
        window.scrollTo({top: 0});
    }
}

window.addEventListener('hashchange', showTab);
showTab();

// ================= Start =================
$('stat-q').textContent = QUIZ.length;
mountCardArt();
renderMe();
renderBadges();
showBoard('quiz');
countPlayers();
resize();
let topicCount = 0;
topicCount = initTopics($('topic-tabs'), $('topic-body'), id => {
    if (!me.topics[id]) {
        me.topics[id] = 1;
        addXp(5);
    }
    if (topicCount && Object.keys(me.topics).filter(k => !k.startsWith('g-')).length >= topicCount) {
        award('scholar');
    }
});
$('topic-count').textContent = `${topicCount} short explainers, each with its numbers and sources.`;
let guideCount = 0;
guideCount = initGuide($('guide-tabs'), $('guide-body'), id => {
    if (!me.topics[id]) {
        me.topics[id] = 1;
        addXp(5);
    }
    if (guideCount && Object.keys(me.topics).filter(k => k.startsWith('g-')).length >= guideCount) {
        award('guide');
    }
});
$('guide-count').textContent = `${guideCount} parts of our app: the main site's mission steps and rover tools, and the explorer. Each one opens the real thing.`;
$('more-count').textContent = `${renderFactGrid($('fx-grid'), SOURCES)} facts, each drawn live. Numbers from NASA, with the source under each.`;
loadSites().then(() => {
    showWorld('moon');
    drawLayerMap();
    const n = renderTimeline($('timeline-list'), sites);
    $('tl-count').textContent = `${n} landings with a known year, from our site list. Select one to see it on the 3D Moon.`;
    for (const li of $('timeline-list').children) {
        li.addEventListener('click', () => openFromTimeline(li.dataset.site));
        li.addEventListener('keydown', e => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                openFromTimeline(li.dataset.site);
            }
        });
    }
    const io = new IntersectionObserver(entries => {
        for (const e of entries) {
            if (e.isIntersecting) {
                e.target.classList.add('in');
                io.unobserve(e.target);
            }
        }
    }, {rootMargin: '0px 0px -6% 0px'});
    for (const li of $('timeline-list').children) {
        io.observe(li);
    }
});

function openFromTimeline(id) {
    const s = sites.find(x => x.id === id);
    if (!s) {
        return;
    }
    me.history[id] = 1;
    save();
    if (Object.keys(me.history).length >= 3) {
        award('historian');
    }
    $('lab').scrollIntoView({behavior: 'smooth'});
    if (worldName !== 'moon') {
        showWorld('moon');
    }
    selectSite(s);
}
frame();
