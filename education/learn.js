// Learn: the education section. 3D lab (Moon with LOLA relief and real landing sites, Earth from NASA
// EPIC, Sun from NASA SDO, Sun-Earth-Moon geometry from Astronomy Engine checked against JPL Horizons),
// a fact deck, two short exercises, and a leaderboard kept by the Flask server (lunar-planner/learn_api.py).
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { Body, GeoMoon, GeoVector, Illumination, MoonPhase } from 'astronomy-engine';
import { BADGES, FACTS, QUIZ, SOURCES } from './content.js';

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
let me = {xp: 0, badges: {}, read: {}, sites: {}, sdo: {}, name: '', elsh: 1};
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

function renderMe() {
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
    loadTexture('/textures/moon_lroc_color_4k.jpg').then(t => {
        mat.map = t;
        mat.needsUpdate = true;
    }).catch(() => {});
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
    return {scene, distance: 4.2, min: 1.6, max: 9, pins: [], relief: false, light: sun};
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
}

function sparkline(values, highlight) {
    const c = h('canvas', {class: 'spark', width: 600, height: 180});
    const g = c.getContext('2d');
    const lo = 0;
    const hi = 420;
    const W = c.width;
    const H = c.height;
    g.strokeStyle = '#1f1f1f';
    g.lineWidth = 1;
    g.font = '20px Geist Mono, monospace';
    g.fillStyle = '#6e6e6e';
    for (const k of [100, 200, 300, 400]) {
        const y = H - ((k - lo) / (hi - lo)) * H;
        g.beginPath();
        g.moveTo(0, y);
        g.lineTo(W, y);
        g.stroke();
        g.fillText(`${k} K`, 4, y - 4);
    }
    // Plot by local time (0-24 h), so noon sits in the middle.
    const pts = values.map(v => [v.t, v.k]).sort((a, b) => a[0] - b[0]);
    g.strokeStyle = '#f5c96b';
    g.lineWidth = 3;
    g.beginPath();
    pts.forEach(([t, k], i) => {
        const x = (t / 24) * W;
        const y = H - ((k - lo) / (hi - lo)) * H;
        if (i === 0) {
            g.moveTo(x, y);
        } else {
            g.lineTo(x, y);
        }
    });
    g.stroke();
    if (highlight) {
        const x = (highlight.t / 24) * W;
        const y = H - ((highlight.k - lo) / (hi - lo)) * H;
        g.fillStyle = '#45d483';
        g.beginPath();
        g.arc(x, y, 8, 0, Math.PI * 2);
        g.fill();
    }
    return c;
}

function moonInfo() {
    const s = selectedSite;
    if (!s) {
        return [
            h('h3', {class: 'px'}, 'THE MOON'),
            h('p', {class: 'sub'}, `${sites.length} landing sites · select a marker`),
            h('div', {class: 'live'}, h('b', {}, 'DATA'), 'Colour: LRO LROC mosaic (NASA SVS). ',
                worlds.moon.relief ? 'Relief: LOLA heights, drawn 4× taller than real.' : 'Relief: run build_terrain.py to add LOLA heights.'),
            h('dl', {class: 'kv'},
                h('dt', {}, 'Apollo landings'), h('dd', {}, 'white'),
                h('dt', {}, 'Robotic landers'), h('dd', {}, 'violet'),
                h('dt', {}, 'South-pole features'), h('dd', {}, 'teal')),
            factList('moon', 3),
        ];
    }
    const src = siteSources[s.source];
    const d = s.diviner;
    const kids = [
        h('h3', {class: 'px'}, s.name.toUpperCase()),
        h('p', {class: 'sub'}, `${fmtLat(s.lat)}, ${fmtLon(s.lon)} · ${s.category === 'south-pole' ? 'south-pole feature' : s.category}${s.agency ? ' · ' + s.agency : ''}${s.year ? ' · ' + s.year : ''}`),
    ];
    if (d) {
        const curve = d.local_time_h.map((t, i) => ({t, k: d.temp_k[i]}));
        kids.push(
            h('div', {class: 'live'}, h('b', {}, 'MEASURED TEMPERATURE · LRO DIVINER'),
                `${Math.round(d.min_k)} K at night to ${Math.round(d.max_k)} K at noon (${Math.round(d.min_k - 273.15)} to ${Math.round(d.max_k - 273.15)} °C).`),
            sparkline(curve),
            h('p', {class: 'src'}, 'Temperature through one lunar day, by local time (0 h = midnight, 12 h = noon). ', d.source),
        );
    } else {
        kids.push(h('div', {class: 'live'}, h('b', {}, 'MEASURED TEMPERATURE'), 'Loading LRO Diviner data…'));
    }
    kids.push(h('p', {class: 'src'}, 'Coordinates: ', src ? h('a', {href: src.url, target: '_blank', rel: 'noopener'}, src.title) : s.source));
    kids.push(h('button', {class: 'btn', onclick: () => {
        selectedSite = null;
        for (const p of worlds.moon.pins) {
            p.el.classList.remove('sel');
        }
        renderInfo();
    }}, 'All sites'));
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
        h('p', {class: 'sub'}, m && m.date_utc ? `Photographed ${m.date_utc} UTC by EPIC on DSCOVR` : 'Latest EPIC image'),
        w.error ? h('div', {class: 'live'}, h('b', {}, 'NOT AVAILABLE'), w.error) : h('div', {class: 'live'}, h('b', {}, 'LIVE · NASA EPIC'),
            m && m.centroid && m.centroid.lat !== undefined ? `Centred on ${fmtLat(m.centroid.lat)}, ${fmtLon(m.centroid.lon)}. ` : '',
            'DSCOVR orbits about 1.5 million km away, between Earth and the Sun, so it always sees the full sunlit side. The far half of this globe is dark because no camera sees it from there.'),
        m && m.caption ? h('p', {class: 'src'}, `NASA caption: ${m.caption}`) : null,
        factList('earth', 3),
        sourceLink('epic'),
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
        h('p', {class: 'sub'}, 'Latest images from NASA\'s Solar Dynamics Observatory'),
        h('div', {class: 'chips'}, SDO.map(c => h('button', {class: c.id === w.channel ? 'on' : '', onclick: () => setSdo(w, c.id)}, c.label))),
        w.error ? h('div', {class: 'live'}, h('b', {}, 'NOT AVAILABLE'), w.error) : h('div', {class: 'live'}, h('b', {}, `LIVE · ${ch.label}`), ch.text),
        h('p', {class: 'src'}, 'SDO sees only the side facing Earth. The far half of this globe repeats that image, dimmed.'),
        factList('sun', 3),
        sourceLink('sdo'),
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
    loadTexture('/textures/moon_lroc_color_4k.jpg').then(t => {
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
        h('p', {class: 'src'}, 'The dashed line points to the Sun. The Moon\'s lit half always faces it; the phase is how much of that half we see from Earth.'),
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
    return h('ul', {}, list.map(f => h('li', {}, f.text, h('br'), sourceLink(f.src))));
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
        moon: 'Relief 4× · markers from data/sites.json',
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

// ================= Fact deck =================
let filter = 'all';

function renderDeck() {
    const list = FACTS.map((f, i) => ({...f, i})).filter(f => filter === 'all' || f.body === filter);
    $('deck').replaceChildren(...list.map(f => {
        const card = h('button', {class: `card ${f.body}${me.read[f.i] ? ' read' : ''}`, 'aria-label': `Fact ${f.i + 1} about the ${f.body}`},
            h('div', {class: 'in'},
                h('div', {class: 'face front'}, h('span', {class: 'tag'}, f.body.toUpperCase()), h('span', {class: 'px'}, `FACT ${String(f.i + 1).padStart(2, '0')}`)),
                h('div', {class: 'face back'}, h('p', {}, f.text), sourceLink(f.src))));
        card.addEventListener('click', e => {
            if (e.target.closest('a')) {
                return;
            }
            card.classList.toggle('flip');
            if (!me.read[f.i]) {
                me.read[f.i] = true;
                card.classList.add('read');
                addXp(5);
                if (Object.keys(me.read).length >= 10) {
                    award('reader');
                }
            }
        });
        return card;
    }));
}

for (const b of document.querySelectorAll('[data-filter]')) {
    b.addEventListener('click', () => {
        filter = b.dataset.filter;
        for (const x of document.querySelectorAll('[data-filter]')) {
            x.classList.toggle('on', x === b);
        }
        renderDeck();
    });
}

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
    const game = {qs: shuffle(QUIZ).slice(0, 10), i: 0, score: 0, streak: 0};
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
        if (o && o.right) {
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
    slider.addEventListener('input', () => {
        out.textContent = `${slider.value} K`;
        celsius.textContent = `${Math.round(slider.value - 273.15)} °C`;
    });
    const thermo = h('div', {class: 'thermo'});
    const pos = k2 => `${(100 * (k2 - 40)) / 360}%`;
    const go = h('button', {class: 'btn primary', onclick: () => {
        go.disabled = true;
        slider.disabled = true;
        const guess = Number(slider.value);
        const err = Math.abs(guess - truth);
        const pts = Math.max(0, Math.round(200 - 2 * err));
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
        h('p', {class: 'question'}, `${s.name} (${fmtLat(s.lat)}, ${fmtLon(s.lon)}) at ${hh}:${mm} local solar time. ${sunUp ? 'The Sun is up.' : 'The Sun is down.'} How warm is the surface?`),
        h('div', {class: 'guess'}, slider, h('div', {}, out, h('br'), celsius)),
        thermo,
        go);
}

// ---------- Result and leaderboard ----------
function finish(game, score, what) {
    clearInterval(timerId);
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
        h('div', {class: 'final'}, String(score)),
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
        $('ranks').replaceChildren(...(rows.length ? rows : [h('li', {}, h('span', {class: 'empty'}, 'No scores yet. Be the first.'))]));
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

// ================= Start =================
$('stat-q').textContent = QUIZ.length;
renderMe();
renderBadges();
renderDeck();
showBoard('quiz');
countPlayers();
resize();
loadSites().then(() => showWorld('moon'));
frame();
