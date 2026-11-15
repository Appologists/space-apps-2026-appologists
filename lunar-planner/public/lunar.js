import * as T from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {initGame, complete, count, collect, showFact, fillFactCard} from './lunar-game.js';
import {openSurface, updateSky, setLayer, setSunlight, setElevationColors, setExaggeration, getView, face as surfaceFace, birdsEye, resizeSurface, setTool, clearMeasure, setSkyTracks, setTracksVisible, snapshot} from './lunar-surface.js';
import {showStreetView, loadEpic, showSdo} from './lunar-bodies.js';
import {initSouthPole, showPage as showSouthPole, refreshTime as refreshSouthPole, spSites, selectSp, topSpId, analyze as analyzeSouthPole} from './lunar-southpole.js';

const $ = id => document.getElementById(id);
const rad = T.MathUtils.degToRad;
const DEG = '\u00b0';
const R_KM = 1737.4;

// ================= Scene =================
const view = $('view');
const renderer = new T.WebGLRenderer({antialias: true, logarithmicDepthBuffer: true});
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
view.prepend(renderer.domElement);
const scene = new T.Scene();
scene.background = new T.Color(0x000000);
// A sharp star field far behind everything (decoration, not a star catalogue).
{
    const n = 7000;
    const pos = new Float32Array(n * 3);
    const col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
        const u = Math.random() * 2 - 1;
        const a = Math.random() * Math.PI * 2;
        const r = Math.sqrt(1 - u * u) * 900;
        pos.set([r * Math.cos(a), u * 900, r * Math.sin(a)], i * 3);
        const b = 0.35 + Math.pow(Math.random(), 3) * 0.65;
        const warm = Math.random() < 0.3;
        col.set([b, b * (warm ? 0.92 : 0.97), b * (warm ? 0.8 : 1)], i * 3);
    }
    const g = new T.BufferGeometry();
    g.setAttribute('position', new T.BufferAttribute(pos, 3));
    g.setAttribute('color', new T.BufferAttribute(col, 3));
    scene.add(new T.Points(g, new T.PointsMaterial({size: 1.6, sizeAttenuation: false, vertexColors: true, depthWrite: false})));
}
const camera = new T.PerspectiveCamera(40, 1, 0.0003, 3000);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.enablePan = false;
controls.minDistance = 1.15;
controls.maxDistance = 60;
const ambient = new T.AmbientLight(0xffffff, 0.1);
scene.add(ambient);
const sunLight = new T.DirectionalLight(0xffffff, 3);
scene.add(sunLight, sunLight.target);
const loader = new T.TextureLoader();

function texture(url, done) {
    loader.load(url, t => {
        t.colorSpace = T.SRGBColorSpace;
        done(t);
    }, undefined, () => {
        setStatus('Image missing: ' + url);
    });
}

function label(text, parent, position, size, color = '#ece8df') {
    const c = document.createElement('canvas');
    c.width = 512;
    c.height = 96;
    const ctx = c.getContext('2d');
    ctx.fillStyle = color;
    ctx.font = '600 40px "Geist", "Segoe UI", sans-serif';
    ctx.textAlign = 'center';
    ctx.shadowColor = '#000';
    ctx.shadowBlur = 12;
    ctx.fillText(text, 256, 64);
    const s = new T.Sprite(new T.SpriteMaterial({map: new T.CanvasTexture(c), depthTest: false, transparent: true}));
    s.scale.set(size, 0.19 * size, 1);
    s.position.copy(position);
    s.renderOrder = 10;
    parent.add(s);
    return s;
}

function glow(color, size) {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const ctx = c.getContext('2d');
    const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
    g.addColorStop(0, color);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 128, 128);
    const s = new T.Sprite(new T.SpriteMaterial({map: new T.CanvasTexture(c), blending: T.AdditiveBlending, depthWrite: false}));
    s.scale.set(size, size, 1);
    return s;
}

// Moon-fixed frame in three.js axes (matches the sphere texture mapping).
function upAt(lat, lon) {
    const p = rad(lat);
    const l = rad(lon);
    return new T.Vector3(Math.cos(p) * Math.cos(l), Math.sin(p), -Math.cos(p) * Math.sin(l));
}

function moonDir(lat, lon, az, el) {
    const p = rad(lat);
    const l = rad(lon);
    const a = rad(az);
    const e = rad(el);
    const east = new T.Vector3(-Math.sin(l), 0, -Math.cos(l));
    const north = new T.Vector3(-Math.sin(p) * Math.cos(l), Math.cos(p), Math.sin(p) * Math.sin(l));
    return east.multiplyScalar(Math.sin(a) * Math.cos(e))
        .addScaledVector(north, Math.cos(a) * Math.cos(e))
        .addScaledVector(upAt(lat, lon), Math.sin(e));
}

// Local site frame: x = east, y = up, -z = north. Units: km.
function skyDir(az, el) {
    const a = rad(az);
    const e = rad(el);
    return new T.Vector3(Math.sin(a) * Math.cos(e), Math.sin(e), -Math.cos(a) * Math.cos(e));
}

// ================= Color maps =================
const ELEV_COLORS = [[0, [35, 58, 150]], [0.238, [37, 157, 192]], [0.476, [95, 213, 164]], [0.714, [241, 198, 83]], [1, [216, 75, 73]]];
const TEMP_COLORS = [[0, [25, 35, 90]], [0.3, [50, 120, 190]], [0.55, [230, 220, 190]], [0.78, [235, 150, 80]], [1, [200, 60, 50]]];
// Single-hue ramps from the team repo (src/surface/lenses.js): blue = elevation, orange = slope.
const BLUE_RAMP = ['#0d366b', '#104281', '#184f95', '#1c5cab', '#256abf', '#2a78d6', '#3987e5', '#5598e7', '#6da7ec', '#86b6ef', '#9ec5f4', '#b7d3f6', '#cde2fb'];
const ORANGE_RAMP = ['#621d00', '#752500', '#8a2e00', '#9e3601', '#b53e00', '#c74b12', '#d85a27', '#e96a38', '#f97948', '#fe9068', '#ffa98a', '#ffbfa9', '#fed5c7'];
const hexStops = ramp => ramp.map((h, i) => [i / (ramp.length - 1), [1, 3, 5].map(k => parseInt(h.slice(k, k + 2), 16))]);
const BLUE_COLORS = hexStops(BLUE_RAMP);
const SLOPE_COLORS = hexStops(ORANGE_RAMP);
const SLOPE_MAX = 25;
// Same stops as the server's Diviner maps (40-400 K).
const DIV_COLORS = [[0, [25, 35, 90]], [0.25, [50, 120, 190]], [0.5, [230, 220, 190]], [0.75, [235, 150, 80]], [1, [200, 60, 50]]];
const TEMP_MIN = 100;
const TEMP_MAX = 400;

function ramp(stops, t) {
    t = Math.max(0, Math.min(1, t));
    for (let i = 1; i < stops.length; i++) {
        if (t <= stops[i][0]) {
            const [t0, a] = stops[i - 1];
            const [t1, b] = stops[i];
            const f = (t - t0) / (t1 - t0);
            return [0, 1, 2].map(k => a[k] + (b[k] - a[k]) * f);
        }
    }
    return stops[stops.length - 1][1];
}

function gradientCss(stops) {
    return 'linear-gradient(90deg,' + stops.map(([t, c]) => `rgb(${c.join(',')}) ${t * 100}%`).join(',') + ')';
}

function tempModel(cosIncidence, sunAu) {
    if (cosIncidence <= 0) {
        return TEMP_MIN;
    }
    const flux = 1361 / (sunAu * sunAu) * cosIncidence;
    return Math.max(TEMP_MIN, Math.pow(flux * 0.88 / (0.95 * 5.670374419e-8), 0.25));
}

let legendNote = '';

function showLegend(kind, min, max) {
    if (!kind) {
        $('legend').hidden = true;
        return;
    }
    $('legend').hidden = false;
    const stops = {temp: TEMP_COLORS, div: DIV_COLORS, elev: BLUE_COLORS, globe: ELEV_COLORS, slope: SLOPE_COLORS}[kind];
    $('legend').querySelector('.bar').style.background = gradientCss(stops);
    $('leg-title').textContent = {temp: 'Estimated temperature', div: legendNote || 'Temperature \u00b7 NASA Diviner', elev: 'Elevation', globe: 'Elevation', slope: 'Slope'}[kind];
    const unit = v => (kind === 'temp' || kind === 'div' ? `${v} K` : kind === 'slope' ? `${v}${DEG}` : `${v.toFixed(1)} km`);
    $('leg-min').textContent = unit(min);
    $('leg-max').textContent = unit(max);
}

// ================= Globe =================
const globe = new T.Group();
scene.add(globe);
const photoMaterial = new T.MeshStandardMaterial({color: 0xffffff, roughness: 1});
const elevMaterial = new T.MeshBasicMaterial({color: 0xffffff});
const tempCanvas = document.createElement('canvas');
tempCanvas.width = 360;
tempCanvas.height = 180;
const tempTexture = new T.CanvasTexture(tempCanvas);
tempTexture.colorSpace = T.SRGBColorSpace;
const tempMaterial = new T.MeshBasicMaterial({map: tempTexture});
// NASA LRO Diviner layers: measured temperature now (by Sun position), day max, night min, thermal composite.
const divMaterial = new T.MeshBasicMaterial({color: 0xffffff});
const divTextures = {};
let divNowKey = '';

function divTexture(url) {
    if (!divTextures[url]) {
        divTextures[url] = loader.load(url, t => {
            t.colorSpace = T.SRGBColorSpace;
            if (map2d) {
                drawMap2d();
            }
        });
        divTextures[url].colorSpace = T.SRGBColorSpace;
    }
    return divTextures[url];
}

function subsolarLon(sunM) {
    // three.js axes: x = 0N 0E, -z = 90E.
    return ((Math.atan2(-sunM.z, sunM.x) * 180 / Math.PI) + 360) % 360;
}
const moon = new T.Mesh(new T.SphereGeometry(1, 128, 96), photoMaterial);
globe.add(moon);
texture('/textures/moon-hd.jpg', t => {
    t.anisotropy = renderer.capabilities.getMaxAnisotropy();
    photoMaterial.map = t;
    photoMaterial.needsUpdate = true;
});
texture('/textures/moon-elevation.png', t => {
    elevMaterial.map = t;
    elevMaterial.needsUpdate = true;
});
const earthMaterial = new T.MeshStandardMaterial({color: 0xffffff, roughness: 0.8});
texture('/textures/earth.png', t => {
    earthMaterial.map = t;
    earthMaterial.needsUpdate = true;
});
const globeEarth = new T.Mesh(new T.SphereGeometry(0.45, 64, 48), earthMaterial);
label('Earth', globeEarth, new T.Vector3(0, 0.7, 0), 1.4, '#9fd0ff');
globeEarth.position.set(-3.6, 0.8, 2.6);
globe.add(globeEarth);
const globeSun = new T.Group();
globeSun.add(new T.Mesh(new T.SphereGeometry(0.7, 32, 24), new T.MeshBasicMaterial({color: 0xfff1c4})));
globeSun.add(glow('rgba(255,200,120,0.9)', 5));
label('Sun', globeSun, new T.Vector3(0, 1.15, 0), 1.4, '#ffcf7a');
globeSun.position.set(6.5, 1.5, -4.5);
globe.add(globeSun);
const sunArrow = new T.ArrowHelper(new T.Vector3(1, 0, 0), new T.Vector3(), 0.55, 0xffb547, 0.08, 0.05);
const earthArrow = new T.ArrowHelper(new T.Vector3(1, 0, 0), new T.Vector3(), 0.55, 0x4ea8ff, 0.08, 0.05);
sunArrow.visible = earthArrow.visible = false;
globe.add(sunArrow, earthArrow);
const pickMarker = new T.Mesh(new T.SphereGeometry(0.012, 12, 8), new T.MeshBasicMaterial({color: 0xffffff}));
pickMarker.visible = false;
globe.add(pickMarker);
const markerGroup = new T.Group();
globe.add(markerGroup);

// Latitude / longitude grid: lines every 15 degrees, labels every 30.
const graticule = new T.Group();
globe.add(graticule);
{
    const lineMat = new T.LineBasicMaterial({color: 0xe7eaef, transparent: true, opacity: 0.13});
    const eqMat = new T.LineBasicMaterial({color: 0x4fe3c1, transparent: true, opacity: 0.45});
    for (let lat = -75; lat <= 75; lat += 15) {
        const pts = [];
        for (let lon = -180; lon <= 180; lon += 3) {
            pts.push(upAt(lat, lon).multiplyScalar(1.002));
        }
        graticule.add(new T.Line(new T.BufferGeometry().setFromPoints(pts), lat === 0 ? eqMat : lineMat));
    }
    for (let lon = -180; lon < 180; lon += 15) {
        const pts = [];
        for (let lat = -90; lat <= 90; lat += 3) {
            pts.push(upAt(lat, lon).multiplyScalar(1.002));
        }
        graticule.add(new T.Line(new T.BufferGeometry().setFromPoints(pts), lon === 0 ? eqMat : lineMat));
    }
    for (let lon = -150; lon <= 180; lon += 30) {
        const text = lon === 0 ? '0\u00b0' : lon === 180 ? '180\u00b0' : `${Math.abs(lon)}\u00b0${lon < 0 ? 'W' : 'E'}`;
        label(text, graticule, upAt(2, lon).multiplyScalar(1.03), 0.32, '#9fe9d6');
    }
    for (let lat = -60; lat <= 60; lat += 30) {
        if (lat !== 0) {
            label(`${Math.abs(lat)}\u00b0${lat < 0 ? 'S' : 'N'}`, graticule, upAt(lat, 2).multiplyScalar(1.03), 0.32, '#9fe9d6');
        }
    }
}
$('grid').onclick = () => {
    graticule.visible = !graticule.visible;
    $('grid').classList.toggle('active', graticule.visible);
};
let globeMap = 'photo';

function updateTempTexture(sunM, sunAu) {
    const ctx = tempCanvas.getContext('2d');
    const img = ctx.createImageData(360, 180);
    for (let y = 0; y < 180; y++) {
        const lat = 89.5 - y;
        for (let x = 0; x < 360; x++) {
            const n = upAt(lat, x - 179.5);
            const t = tempModel(n.dot(sunM), sunAu);
            const c = ramp(TEMP_COLORS, (t - TEMP_MIN) / (TEMP_MAX - TEMP_MIN));
            const k = (y * 360 + x) * 4;
            img.data[k] = c[0];
            img.data[k + 1] = c[1];
            img.data[k + 2] = c[2];
            img.data[k + 3] = 255;
        }
    }
    ctx.putImageData(img, 0, 0);
    tempTexture.needsUpdate = true;
}

function setGlobeMap(kind) {
    globeMap = kind;
    const useDiv = installed.diviner && ['temp', 'max', 'min'].includes(kind);
    moon.material = kind === 'photo' ? photoMaterial : kind === 'elev' ? elevMaterial
        : kind === 'comp' || useDiv ? divMaterial : tempMaterial;
    if (kind === 'max' || kind === 'min') {
        divMaterial.map = divTexture(`/api/diviner/map?kind=${kind}`);
        divMaterial.needsUpdate = true;
    }
    if (kind === 'comp') {
        divMaterial.map = divTexture('/diviner/composite.webp');
        divMaterial.needsUpdate = true;
    }
    divNowKey = '';
    for (const k of ['photo', 'elev', 'temp', 'max', 'min', 'comp']) {
        $('map-' + k).classList.toggle('active', k === kind);
    }
    if (kind === 'temp') {
        complete('heat');
    }
    renderSelected();
}

for (const k of ['photo', 'elev', 'temp', 'max', 'min', 'comp']) {
    $('map-' + k).onclick = () => setGlobeMap(k);
}

// ================= Street view =================
const street = new T.Group();
street.visible = false;
scene.add(street);
const D = 400;
const regolithCanvas = document.createElement('canvas');
regolithCanvas.width = regolithCanvas.height = 256;
{
    const ctx = regolithCanvas.getContext('2d');
    ctx.fillStyle = '#808080';
    ctx.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 6000; i++) {
        const v = 80 + Math.random() * 90;
        ctx.fillStyle = `rgb(${v},${v},${v})`;
        ctx.fillRect(Math.random() * 256, Math.random() * 256, 2, 2);
    }
}
const regolith = new T.CanvasTexture(regolithCanvas);
regolith.wrapS = regolith.wrapT = T.RepeatWrapping;
regolith.repeat.set(400, 400);
const flatMaterial = new T.MeshBasicMaterial({map: regolith, color: 0x555555});
const flatGround = new T.Mesh(new T.CircleGeometry(1200, 96), flatMaterial);
flatGround.rotation.x = -Math.PI / 2;
street.add(flatGround);
// Sky objects follow the eye, so the Sun and Earth stay at infinity while you walk.
const skyAnchor = new T.Group();
street.add(skyAnchor);
for (const [text, az] of [['N', 0], ['NE', 45], ['E', 90], ['SE', 135], ['S', 180], ['SW', 225], ['W', 270], ['NW', 315]]) {
    label(text, skyAnchor, skyDir(az, 3).multiplyScalar(D * 0.9), 22);
}
const skySun = new T.Group();
skySun.add(new T.Mesh(new T.SphereGeometry(D * Math.tan(rad(0.2665)), 24, 16), new T.MeshBasicMaterial({color: 0xfffbea})));
skySun.add(glow('rgba(255,220,150,0.85)', 60));
skyAnchor.add(skySun);
const skyEarth = new T.Mesh(new T.SphereGeometry(D * Math.tan(rad(0.95)), 48, 32), earthMaterial);
skyAnchor.add(skyEarth);
let sunPath = null;
let earthPath = null;
let terrain = null;
let terrainMesh = null;
let streetMap = 'photo';
let exag = 1;
let walker = {e: 0, n: 0};
const keys = new Set();

async function loadTerrain(c) {
    if (terrain && terrain.siteId === c.id) {
        return;
    }
    terrain = null;
    if (terrainMesh) {
        street.remove(terrainMesh);
        terrainMesh.geometry.dispose();
        terrainMesh = null;
    }
    walker = {e: 0, n: 0};
    await statusReady;
    if (!installed.terrain) {
        setStatus('Terrain is not installed yet. Run build_terrain.py once, then reload.');
        updateStreet();
        return;
    }
    setStatus('Loading terrain...');
    try {
        const r = await fetch(`/api/terrain?lat=${c.lat}&lon=${c.lon}&half_km=40&n=161`);
        const j = await r.json();
        if (!r.ok) {
            throw Error(j.error);
        }
        if (selectedId !== c.id) {
            return;
        }
        terrain = {
            siteId: c.id, n: j.n, half: j.half_km, s: j.spacing_km,
            z: Float32Array.from(j.z_km), h: Float32Array.from(j.elevation_km), siteElev: j.site_elevation_km,
        };
        terrain.minH = Math.min(...terrain.h);
        terrain.maxH = Math.max(...terrain.h);
        buildTerrainMesh();
        computeHorizon();
        lastShadeKey = '';
        setStatus('');
    } catch (e) {
        setStatus(e.message);
    }
    updateStreet();
}

function zAt(e, n) {
    const t = terrain;
    const fi = Math.max(0, Math.min(t.n - 1.001, (e + t.half) / t.s));
    const fj = Math.max(0, Math.min(t.n - 1.001, (t.half - n) / t.s));
    const i = Math.floor(fi);
    const j = Math.floor(fj);
    const a = fi - i;
    const b = fj - j;
    const k = j * t.n + i;
    return t.z[k] * (1 - a) * (1 - b) + t.z[k + 1] * a * (1 - b) + t.z[k + t.n] * (1 - a) * b + t.z[k + t.n + 1] * a * b;
}

function buildTerrainMesh() {
    const t = terrain;
    const pos = new Float32Array(t.n * t.n * 3);
    for (let j = 0; j < t.n; j++) {
        for (let i = 0; i < t.n; i++) {
            const k = j * t.n + i;
            pos[k * 3] = -t.half + i * t.s;
            pos[k * 3 + 1] = t.z[k] * exag;
            pos[k * 3 + 2] = -(t.half - j * t.s);
        }
    }
    const index = [];
    for (let j = 0; j < t.n - 1; j++) {
        for (let i = 0; i < t.n - 1; i++) {
            const a = j * t.n + i;
            index.push(a, a + t.n, a + 1, a + 1, a + t.n, a + t.n + 1);
        }
    }
    const g = new T.BufferGeometry();
    g.setAttribute('position', new T.BufferAttribute(pos, 3));
    g.setAttribute('color', new T.BufferAttribute(new Float32Array(t.n * t.n * 3), 3));
    g.setIndex(index);
    if (terrainMesh) {
        street.remove(terrainMesh);
        terrainMesh.geometry.dispose();
    }
    terrainMesh = new T.Mesh(g, new T.MeshBasicMaterial({vertexColors: true}));
    street.add(terrainMesh);
    flatGround.position.y = (Math.min(...t.z) - 0.5) * exag;
    lastShadeKey = '';
}

function computeHorizon() {
    const t = terrain;
    const eye = zAt(0, 0) + Number($('camera').value) / 1000;
    t.horizon = [];
    for (let az = 0; az < 360; az += 2) {
        const se = Math.sin(rad(az));
        const cn = Math.cos(rad(az));
        let best = -90;
        for (let d = t.s; d < t.half; d += t.s / 2) {
            const angle = Math.atan2(zAt(d * se, d * cn) - eye, d) * 180 / Math.PI;
            best = Math.max(best, angle);
        }
        t.horizon.push(best);
    }
}

function horizonAt(az) {
    if (!terrain?.horizon) {
        return 0;
    }
    const i = Math.round((((az % 360) + 360) % 360) / 2) % 180;
    return terrain.horizon[i];
}

let lastShadeKey = '';

function shadeTerrain(sample) {
    const t = terrain;
    const key = `${sample.t}|${streetMap}|${exag}|${t.siteId}`;
    if (key === lastShadeKey) {
        return;
    }
    lastShadeKey = key;
    const a = rad(sample.sun_az);
    const el = rad(sample.sun_el);
    const sun = [Math.sin(a) * Math.cos(el), Math.cos(a) * Math.cos(el), Math.sin(el)];
    const tanEl = Math.tan(el);
        const colors = terrainMesh.geometry.attributes.color.array;
    t.lit = new Uint8Array(t.n * t.n);
    t.cosi = new Float32Array(t.n * t.n);
    for (let j = 0; j < t.n; j++) {
        for (let i = 0; i < t.n; i++) {
            const k = j * t.n + i;
            const i0 = Math.max(0, i - 1);
            const i1 = Math.min(t.n - 1, i + 1);
            const j0 = Math.max(0, j - 1);
            const j1 = Math.min(t.n - 1, j + 1);
            const dzde = (t.z[j * t.n + i1] - t.z[j * t.n + i0]) / ((i1 - i0) * t.s);
            const dzdn = (t.z[j0 * t.n + i] - t.z[j1 * t.n + i]) / ((j1 - j0) * t.s);
            const len = Math.hypot(dzde, dzdn, 1);
            const nx = -dzde / len;
            const ny = -dzdn / len;
            const nz = 1 / len;
            let cosi = nx * sun[0] + ny * sun[1] + nz * sun[2];
            let lit = sample.sun_el > -0.3 && cosi > 0;
            if (lit) {
                const e0 = -t.half + i * t.s;
                const n0 = t.half - j * t.s;
                const z0 = t.z[k] + 0.002;
                for (let d = t.s; d < 2 * t.half; d += t.s) {
                    const e = e0 + d * sun[0] / Math.max(1e-6, Math.cos(el));
                    const n = n0 + d * sun[1] / Math.max(1e-6, Math.cos(el));
                    if (Math.abs(e) > t.half || Math.abs(n) > t.half) {
                        break;
                    }
                    if (zAt(e, n) > z0 + d * tanEl) {
                        lit = false;
                        break;
                    }
                }
            }
            t.lit[k] = lit ? 1 : 0;
            t.cosi[k] = lit ? cosi : 0;
            let c;
            if (streetMap === 'temp') {
                const temp = tempModel(lit ? cosi : 0, sample.sun_au);
                c = ramp(TEMP_COLORS, (temp - TEMP_MIN) / (TEMP_MAX - TEMP_MIN)).map(v => v / 255);
            } else if (streetMap === 'elev') {
                const f = (t.h[k] - t.minH) / Math.max(0.001, t.maxH - t.minH);
                c = ramp(BLUE_COLORS, f).map(v => v / 255);
            } else if (streetMap === 'slope') {
                const slopeDeg = Math.atan(Math.hypot(dzde, dzdn)) * 180 / Math.PI;
                c = ramp(SLOPE_COLORS, slopeDeg / SLOPE_MAX).map(v => v / 255);
            } else {
                const v = 0.025 + 0.6 * (lit ? cosi : 0);
                c = [v, v, v * 0.97];
            }
            colors[k * 3] = c[0];
            colors[k * 3 + 1] = c[1];
            colors[k * 3 + 2] = c[2];
        }
    }
    terrainMesh.geometry.attributes.color.needsUpdate = true;
}

function updateStreet() {
    const c = selected();
    const s = currentSample();
    if (!c || !s) {
        return;
    }
    skySun.position.copy(skyDir(s.sun_az, s.sun_el)).multiplyScalar(D);
    skyEarth.position.copy(skyDir(s.earth_az, s.earth_el)).multiplyScalar(D);
    if (mode === 'street') {
        sunLight.position.copy(skyDir(s.sun_az, s.sun_el)).multiplyScalar(50);
    }
    const day = s.sun_el > 0 ? 0.2 + 0.5 * Math.min(1, Math.sin(rad(s.sun_el)) * 3) : 0.04;
    flatMaterial.color.setScalar(day);
    if (terrain && terrainMesh) {
        shadeTerrain(s);
        if (streetMap === 'elev') {
            showLegend('elev', terrain.minH, terrain.maxH);
        } else if (streetMap === 'temp') {
            showLegend('temp', TEMP_MIN, TEMP_MAX);
        } else if (streetMap === 'slope') {
            showLegend('slope', 0, SLOPE_MAX);
        } else {
            showLegend(null);
        }
    }
    renderReadout(c, s);
}

function renderReadout(c, s) {
    if (mode !== 'street') {
        $('readout').hidden = true;
        return;
    }
    $('readout').hidden = false;
    const eyeKm = Number($('camera').value) / 1000;
    let tempK;
    let elevKm = null;
    let slope = null;
    let sunVisible = s.sun_el > 0;
    let earthVisible = s.earth_el > 0;
    if (terrain && terrain.lit) {
        const t = terrain;
        const i = Math.round((walker.e + t.half) / t.s);
        const j = Math.round((t.half - walker.n) / t.s);
        const k = Math.max(0, Math.min(t.n * t.n - 1, j * t.n + i));
        tempK = tempModel(t.lit[k] ? t.cosi[k] : 0, s.sun_au);
        elevKm = t.h[k];
        const dzde = (zAt(walker.e + t.s, walker.n) - zAt(walker.e - t.s, walker.n)) / (2 * t.s);
        const dzdn = (zAt(walker.e, walker.n + t.s) - zAt(walker.e, walker.n - t.s)) / (2 * t.s);
        slope = Math.atan(Math.hypot(dzde, dzdn)) * 180 / Math.PI;
        if (walker.e === 0 && walker.n === 0) {
            sunVisible = s.sun_el > horizonAt(s.sun_az);
            earthVisible = s.earth_el > horizonAt(s.earth_az);
        } else {
            sunVisible = t.lit[k] === 1;
        }
    } else {
        tempK = tempModel(Math.sin(rad(s.sun_el)), s.sun_au);
    }
    const lat = c.lat + walker.n / R_KM * 180 / Math.PI;
    const lon = c.lon + walker.e / (R_KM * Math.max(0.01, Math.cos(rad(c.lat)))) * 180 / Math.PI;
    const state = (vis, el) => (vis ? 'in view' : el > 0 ? 'behind terrain' : 'below horizon');
    $('readout').innerHTML = `
        <div class="quiet">Temperature here</div>
        <b>${Math.round(tempK)} K</b> <span class="quiet">${Math.round(tempK - 273.15)} ${DEG}C</span>
        <div style="margin-top:6px">${fmtLat(lat)}, ${fmtLon(lon)}</div>
        <div class="quiet">${elevKm !== null ? `Elevation ${elevKm.toFixed(2)} km &middot; slope ${slope.toFixed(1)}${DEG}` : ''}</div>
        <div class="quiet">${walker.e || walker.n ? `${Math.hypot(walker.e, walker.n).toFixed(1)} km from site` : 'At the site'}</div>
        <div style="margin-top:6px">Sun ${state(sunVisible, s.sun_el)} &middot; Earth ${state(earthVisible, s.earth_el)}</div>`;
}

function buildPaths() {
    for (const p of [sunPath, earthPath]) {
        if (p) {
            skyAnchor.remove(p);
        }
    }
    sunPath = earthPath = null;
    const c = selected();
    if (!c?.result) {
        return;
    }
    const make = (az, el, color) => {
        const pts = c.result.samples.map(x => skyDir(x[az], x[el]).multiplyScalar(D * 0.98));
        const line = new T.Line(new T.BufferGeometry().setFromPoints(pts), new T.LineDashedMaterial({color, dashSize: 4, gapSize: 4, transparent: true, opacity: 0.7}));
        line.computeLineDistances();
        skyAnchor.add(line);
        return line;
    };
    sunPath = make('sun_az', 'sun_el', 0xffb547);
    earthPath = make('earth_az', 'earth_el', 0x4ea8ff);
}

function setStreetMap(kind) {
    streetMap = kind;
    for (const k of ['photo', 'elev', 'temp', 'slope']) {
        $('st-' + k).classList.toggle('active', k === kind);
    }
    if (kind === 'temp') {
        complete('heat');
    }
    if (kind === 'slope') {
        complete('slope');
    }
    updateStreet();
}

for (const k of ['photo', 'elev', 'temp', 'slope']) {
    $('st-' + k).onclick = () => setStreetMap(k);
}
$('st-exag').onclick = () => {
    exag = exag === 1 ? 3 : exag === 3 ? 5 : 1;
    $('st-exag').innerHTML = `Relief &times;${exag}`;
    if (terrain) {
        buildTerrainMesh();
        updateStreet();
    }
};

// ================= Coordinates =================
function readCoords() {
    const lat = Math.abs(Number($('lat').value)) * ($('ns').value === 'S' ? -1 : 1);
    const lon = Math.abs(Number($('lon').value)) * ($('ew').value === 'W' ? -1 : 1);
    return {lat, lon};
}

function writeCoords(lat, lon) {
    lon = ((lon + 540) % 360) - 180;
    $('lat').value = Math.abs(lat).toFixed(4);
    $('ns').value = lat < 0 ? 'S' : 'N';
    $('lon').value = Math.abs(lon).toFixed(4);
    $('ew').value = lon < 0 ? 'W' : 'E';
    coordsChanged();
}

function dms(v) {
    const a = Math.abs(v);
    const d = Math.floor(a);
    const m = Math.floor((a - d) * 60);
    const s = ((a - d) * 60 - m) * 60;
    return `${d}${DEG} ${String(m).padStart(2, '0')}' ${s.toFixed(1).padStart(4, '0')}"`;
}

function fmtLat(v) {
    return `${Math.abs(v).toFixed(4)}${DEG} ${v < 0 ? 'S' : 'N'}`;
}

function fmtLon(v) {
    return `${Math.abs(v).toFixed(4)}${DEG} ${v < 0 ? 'W' : 'E'}`;
}

function coordsValid() {
    const lat = Math.abs(Number($('lat').value));
    const lon = Math.abs(Number($('lon').value));
    return $('lat').value !== '' && $('lon').value !== '' && lat <= 90 && lon <= 180;
}

function coordsChanged() {
    if (!coordsValid()) {
        $('dms').textContent = 'Latitude 0 to 90, longitude 0 to 180.';
        pickMarker.visible = false;
        return;
    }
    const {lat, lon} = readCoords();
    const e = elevationAt(lat, lon);
    $('dms').textContent = `${dms(lat)} ${lat < 0 ? 'S' : 'N'}, ${dms(lon)} ${lon < 0 ? 'W' : 'E'}` + (e !== null ? ` \u00b7 ${e.toFixed(2)} km` : '');
    pickMarker.position.copy(upAt(lat, lon).multiplyScalar(1.004));
    pickMarker.visible = true;
}

for (const id of ['lat', 'lon', 'ns', 'ew']) {
    $(id).addEventListener('input', coordsChanged);
}

let elevationGrid = null;
let installed = {terrain: false, elevation_grid: false, cesium: false, google: false};
const statusReady = fetch('/api/status').then(r => r.json()).then(j => {
    installed = j;
}).catch(() => {});
statusReady.then(() => (installed.elevation_grid ? fetch('/textures/moon-elevation-grid.bin') : Promise.reject())).then(r => {
    if (!r.ok) {
        throw Error();
    }
    return r.arrayBuffer();
}).then(b => {
    elevationGrid = new Int16Array(b);
    coordsChanged();
    renderSelected();
}).catch(() => {});

function elevationAt(lat, lon) {
    if (!elevationGrid || elevationGrid.length !== 1440 * 720) {
        return null;
    }
    const x = Math.min(1439, Math.floor(((((lon + 180) % 360) + 360) % 360) * 4));
    const y = Math.min(719, Math.max(0, Math.floor((90 - lat) * 4)));
    return elevationGrid[y * 1440 + x] / 1000;
}

// ================= State =================
let presets = [];
let siteSources = {};
let candidates = [];
let nextId = 1;
let selectedId = null;
let mode = 'globe';
let playing = false;
let tick = 0;
let last = performance.now();
let yaw = 90;
let pitch = 8;
let drag = null;
let flight = null;
let map2d = false;
let dayNight = true;
let lastSunM = new T.Vector3(1, 0, 0);

// Curated sites come from the team repo's data/sites.json, each with its source.
async function loadSites() {
    try {
        const r = await fetch('/data/sites.json');
        const j = await r.json();
        siteSources = j.sources || {};
        presets = j.sites.map(x => ({...x, categoryLabel: (j.categories || {})[x.category] || x.category}));
    } catch (e) {
        presets = [{id: 'apollo-11', name: 'Apollo 11', lat: 0.67416, lon: 23.47314, category: 'apollo', categoryLabel: 'Apollo landing'}];
    }
    const sel = $('preset');
    sel.innerHTML = '';
    sel.add(new Option(`Choose one of ${presets.length} known sites`, ''));
    const groups = {};
    presets.forEach((p, i) => {
        if (!groups[p.categoryLabel]) {
            groups[p.categoryLabel] = document.createElement('optgroup');
            groups[p.categoryLabel].label = p.categoryLabel;
            sel.append(groups[p.categoryLabel]);
        }
        groups[p.categoryLabel].append(new Option(p.name + (p.year ? ` (${p.year})` : ''), i));
    });
}

$('preset').onchange = () => {
    const p = presets[Number($('preset').value)];
    if (!p) {
        return;
    }
    $('name').value = p.name;
    writeCoords(p.lat, p.lon);
    flyToSite(p.lat, p.lon);
};

function presetFor(c) {
    return presets.find(p => p.name === c.name && Math.abs(p.lat - c.lat) < 1e-6) || null;
}
$('start').value = new Date().toISOString().slice(0, 10);

function setStatus(text) {
    $('status').textContent = text;
}

function selected() {
    return candidates.find(c => c.id === selectedId) || null;
}

// Where the time strip, clock and overhead panels take their data from:
// the spot you stand on in surface mode, otherwise the selected site.
function timeSource() {
    if (mode === 'surface' && surfaceSpot?.result) {
        return surfaceSpot;
    }
    return selected();
}

function currentSample() {
    const c = timeSource();
    if (!c?.result) {
        return null;
    }
    return c.result.samples[Math.min(Number($('timeline').value), c.result.samples.length - 1)];
}

function addCandidate(name, lat, lon) {
    const c = {id: nextId++, name, lat, lon, result: null, error: null};
    candidates.push(c);
    selectedId = c.id;
    rebuildMarkers();
    renderList();
    return c;
}

function rebuildMarkers() {
    markerGroup.clear();
    for (const c of candidates) {
        const on = c.id === selectedId;
        const m = new T.Mesh(new T.SphereGeometry(on ? 0.02 : 0.013, 12, 8), new T.MeshBasicMaterial({color: on ? 0xffffff : 0xb9c3cf}));
        m.position.copy(upAt(c.lat, c.lon).multiplyScalar(1.003));
        m.userData.id = c.id;
        markerGroup.add(m);
        label(c.name, m, new T.Vector3(0, 0.05, 0), 0.42, on ? '#ffffff' : '#c3cad5');
    }
}

function renderList() {
    const ul = $('candidates');
    ul.innerHTML = '';
    for (const c of candidates) {
        const li = document.createElement('li');
        li.className = c.id === selectedId ? 'selected' : '';
        const span = document.createElement('span');
        span.textContent = c.name;
        const em = document.createElement('em');
        em.textContent = c.error ? 'failed' : c.result ? `${scoreOf(c)} pts` : '';
        const x = document.createElement('button');
        x.innerHTML = '&times;';
        x.title = 'Remove';
        x.onclick = e => {
            e.stopPropagation();
            candidates = candidates.filter(k => k !== c);
            if (selectedId === c.id) {
                selectedId = candidates[0]?.id ?? null;
            }
            rebuildMarkers();
            renderList();
            renderRank();
            selectSite(selectedId);
        };
        li.append(span, em, x);
        li.onclick = () => selectSite(c.id);
        ul.append(li);
    }
}

function selectSite(id) {
    selectedId = id;
    rebuildMarkers();
    renderList();
    const c = selected();
    renderSelected();
    if (!c) {
        return;
    }
    buildPaths();
    if (mode === 'globe') {
        moonView();
    }
    if (mode === 'street') {
        loadTerrain(c);
    }
    if (mode === 'surface') {
        openSurfaceAt(c.lat, c.lon, c.name);
    }
}

$('goto').onclick = () => {
    if (!coordsValid()) {
        return;
    }
    const {lat, lon} = readCoords();
    setMode('globe');
    flyToSite(lat, lon);
};

$('add').onclick = () => {
    if (!coordsValid()) {
        coordsChanged();
        return;
    }
    const {lat, lon} = readCoords();
    const c = addCandidate($('name').value.trim() || `${fmtLat(lat)}, ${fmtLon(lon)}`, lat, lon);
    complete('add-site');
    analyzeOne(c).then(() => {
        setupTimeline();
        renderRank();
        selectSite(c.id);
        checkAchievements();
    });
};

// ================= NASA requests =================
function query(c) {
    const p = new URLSearchParams({
        lat: c.lat, lon: c.lon, start: $('start').value, days: $('days').value,
        sun_min: $('sunmin').value, earth_min: $('earthmin').value,
        panel_m: $('panel').value, antenna_m: $('antenna').value, need_h: $('need').value,
    });
    return '/api/site?' + p.toString();
}

async function analyzeOne(c) {
    c.error = null;
    setStatus(`Getting NASA data for ${c.name}...`);
    try {
        const r = await fetch(query(c));
        const j = await r.json();
        if (!r.ok) {
            throw Error(j.error || 'Request failed');
        }
        c.result = j;
        setStatus('');
    } catch (e) {
        c.result = null;
        c.error = 'NASA Horizons did not answer. Check the internet connection and press Analyze again.';
        setStatus(c.error);
    }
    renderList();
}

$('analyze').onclick = async () => {
    $('analyze').disabled = true;
    for (let i = 0; i < candidates.length; i++) {
        setStatus(`Getting NASA data: ${i + 1} of ${candidates.length}`);
        await analyzeOne(candidates[i]);
    }
    $('analyze').disabled = false;
    setStatus('');
    setupTimeline();
    renderRank();
    checkAchievements();
    selectSite(ranked()[0]?.id ?? selectedId);
};

// ================= Ranking =================
// Weighted score, like the team repo's rankSites: each criterion gives 0-1, weights set what matters.
// The mission need is a must-have: sites that meet it always rank above sites that do not.
function checkAchievements() {
    const done = candidates.filter(c => c.result);
    if (done.length) {
        complete('analyze');
    }
    if (done.length >= 6) {
        complete('planner');
    }
    for (const c of done) {
        const m = c.result.summary;
        if (m.meets_requirement) {
            complete('need');
        }
        if (m.both.longest_h >= 100) {
            complete('longday');
        }
        if (Math.abs(c.lat) >= 85) {
            complete('pole');
        }
        if (m.earth.total_h === 0) {
            complete('farside');
        }
    }
}

function weights() {
    return {sun: Number($('w-sun').value), earth: Number($('w-earth').value), both: Number($('w-both').value)};
}

function scoreOf(c) {
    const m = c.result.summary;
    const hours = c.result.samples.length * c.result.window.step_minutes / 60;
    const parts = {
        sun: 0.7 * m.sun.longest_h / hours + 0.3 * m.sun.total_h / hours,
        earth: 0.5 * m.earth.longest_h / hours + 0.5 * m.earth.total_h / hours,
        both: 0.7 * m.both.longest_h / hours + 0.3 * m.both.total_h / hours,
    };
    const w = weights();
    const sum = w.sun + w.earth + w.both;
    if (sum <= 0) {
        return 0;
    }
    return Math.round(100 * (w.sun * parts.sun + w.earth * parts.earth + w.both * parts.both) / sum);
}

function ranked() {
    return candidates.filter(c => c.result).sort((a, b) => {
        const A = a.result.summary;
        const B = b.result.summary;
        return (B.meets_requirement - A.meets_requirement)
            || (scoreOf(b) - scoreOf(a))
            || (B.both.longest_h - A.both.longest_h);
    });
}

function medal(i) {
    return ['\u{1F947}', '\u{1F948}', '\u{1F949}'][i] || '';
}

for (const id of ['w-sun', 'w-earth', 'w-both']) {
    $(id).addEventListener('input', () => {
        $(id + '-v').textContent = $(id).value;
        renderRank();
        renderList();
    });
}

function notes(c) {
    const s = c.result.summary;
    const hours = c.result.samples.length * c.result.window.step_minutes / 60;
    const out = [];
    if (s.meets_requirement) {
        out.push(['+', `${s.both.longest_h} h of power and Earth contact without a break`]);
    } else {
        out.push(['-', `Best unbroken Sun + Earth is ${s.both.longest_h} h`]);
    }
    if (s.earth.total_h === 0) {
        out.push(['-', 'Earth never in view: needs a relay satellite']);
    } else if (s.earth.total_h >= hours) {
        out.push(['+', 'Earth in view the whole time: direct link']);
    } else {
        out.push(['-', `Earth in view ${Math.round(100 * s.earth.total_h / hours)}% of the time`]);
    }
    if (s.both.segments > 1) {
        out.push(['-', `Sun + Earth time is split into ${s.both.segments} parts`]);
    }
    if (s.sun.total_h === 0) {
        out.push(['-', 'No sunlight in this window']);
    } else if (s.sun.total_h < hours) {
        out.push(['-', 'Night falls: about 100 K, heaters needed']);
    }
    if (s.temp_max_k > 370) {
        out.push(['-', `Hot at midday: about ${Math.round(s.temp_max_k)} K`]);
    }
    if (s.both.best_touches_window_edge && s.both.longest_h > 0) {
        out.push(['', 'Best run continues past the window']);
    }
    return out;
}

function fmtTime(t) {
    return t ? t.replace('T', ' ').replace('Z', '') : '-';
}

function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, ch => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[ch]));
}

function scoreColor(v) {
    return v >= 70 ? 'var(--good)' : v >= 45 ? 'var(--sun)' : 'var(--warn)';
}

function renderRank() {
    const body = $('rank-body');
    body.innerHTML = '';
    ranked().forEach((c, i) => {
        const s = c.result.summary;
        const card = document.createElement('div');
        card.className = 'cmp' + (i === 0 ? ' top' : '');
        const score = scoreOf(c);
        const rows = [
            ['Unbroken Sun + Earth', `${s.both.longest_h} h`],
            ['Sunlit', `${s.sun.total_h} h`],
            ['Earth in view', `${s.earth.total_h} h`],
            ['Energy, tracking panel', `${s.energy_tracking_kwh_m2.toFixed(1)} kWh/m\u00b2`],
            ['Temperature', `${Math.round(s.temp_min_k)} to ${Math.round(s.temp_max_k)} K`],
            ['Best window', s.both.best_start ? `${fmtTime(s.both.best_start).slice(5)} \u2192 ${fmtTime(s.both.best_end).slice(5)}` : 'none'],
        ];
        card.innerHTML = `
            <div class="cmp-top">
                <div><span class="cmp-rank">#${i + 1} ${medal(i)}</span><h4>${escapeHtml(c.name)}</h4><small class="mono">${fmtLat(c.lat)}, ${fmtLon(c.lon)}</small></div>
                <div class="cmp-score" style="color:${scoreColor(score)}">${score}</div>
            </div>
            <table>${rows.map(([k, v]) => `<tr><td>${k}</td><td>${v}</td></tr>`).join('')}</table>
            <canvas></canvas>
            <p><span class="need ${s.meets_requirement ? 'yes' : 'no'}">${s.meets_requirement ? 'Meets your need' : 'Misses your need'}</span></p>
            <ul>${notes(c).map(([k, t]) => `<li class="${k === '+' ? 'yes' : k === '-' ? 'no' : ''}">${escapeHtml(t)}</li>`).join('')}</ul>`;
        card.onclick = () => {
            selectSite(c.id);
            setMode('globe');
        };
        body.append(card);
        requestAnimationFrame(() => drawBars(card.querySelector('canvas'), c));
    });
    const failed = candidates.filter(c => c.error);
    $('rank-note').textContent = 'Sites with the longest unbroken time with both sunlight and a view of Earth rank first.'
        + (failed.length ? ` No data for: ${failed.map(c => c.name).join(', ')}.` : '');
    renderTimelinePage();
    updateZones();
}

// Three thin bars (Sun, Earth, both) across the window, with the time cursor.
function drawBars(cv, c, cursor = true) {
    if (!cv || !c?.result) {
        return;
    }
    const w = Math.max(1, Math.round(cv.clientWidth * devicePixelRatio));
    const h = Math.max(1, Math.round(cv.clientHeight * devicePixelRatio));
    cv.width = w;
    cv.height = h;
    const ctx = cv.getContext('2d');
    ctx.fillStyle = 'rgba(255,255,255,0.04)';
    ctx.fillRect(0, 0, w, h);
    const smp = c.result.samples;
    const bw = w / smp.length;
    [['sun_ok', '#ffb547'], ['earth_ok', '#4ea8ff'], ['both_ok', '#3ddc97']].forEach(([key, color], r) => {
        ctx.fillStyle = color;
        smp.forEach((x, i) => {
            if (x[key]) {
                ctx.fillRect(i * bw, r * h / 3 + 1, Math.ceil(bw), h / 3 - 2);
            }
        });
    });
    if (cursor) {
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(Number($('timeline').value) * bw, 0, Math.max(1, devicePixelRatio), h);
    }
}

$('csv').onclick = () => {
    const rows = [['rank', 'site', 'score', 'lat', 'lon', 'unbroken_sun_earth_h', 'best_start_utc', 'best_end_utc', 'sun_earth_total_h', 'sunlit_h', 'earth_h', 'energy_kwh_m2', 'temp_min_k', 'temp_max_k', 'need_met']];
    ranked().forEach((c, i) => {
        const s = c.result.summary;
        rows.push([i + 1, c.name, scoreOf(c), c.lat, c.lon, s.both.longest_h, s.both.best_start, s.both.best_end, s.both.total_h, s.sun.total_h, s.earth.total_h, s.energy_tracking_kwh_m2, s.temp_min_k, s.temp_max_k, s.meets_requirement]);
    });
    const text = rows.map(r => r.map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], {type: 'text/csv'}));
    a.download = 'lunar-site-ranking.csv';
    a.click();
};

// ================= Timeline =================
function setupTimeline() {
    const c = candidates.find(k => k.result) || (surfaceSpot?.result ? surfaceSpot : null);
    const n = c ? c.result.samples.length : 0;
    $('timeline').max = Math.max(0, n - 1);
    $('timeline').value = Math.min(Number($('timeline').value), Math.max(0, n - 1));
    $('timeline').disabled = $('play').disabled = n === 0;
}

function drawStrip() {
    const cv = $('strip');
    const w = Math.max(1, Math.round(cv.clientWidth * devicePixelRatio));
    const h = Math.max(1, Math.round(cv.clientHeight * devicePixelRatio));
    if (cv.width !== w || cv.height !== h) {
        cv.width = w;
        cv.height = h;
    }
    const ctx = cv.getContext('2d');
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(255,255,255,0.045)';
    ctx.fillRect(0, 0, w, h);
    const c = timeSource();
    if (!c?.result) {
        $('daylabels').innerHTML = '';
        return;
    }
    const s = c.result.samples;
    const bw = w / s.length;
    const sunH = Math.round(h * 0.66);
    const gap = Math.max(2, Math.round(h * 0.08));
    const real = s.length && terrainClear(s[0], 'sun') !== null;
    s.forEach((x, i) => {
        const sunReal = real ? terrainClear(x, 'sun') : null;
        const color = sunReal === null ? (x.sun_el > 0.27 ? '#f2b84b' : x.sun_el > -0.27 ? '#8a6a3c' : null) : (sunReal ? '#f2b84b' : null);
        if (color) {
            ctx.fillStyle = color;
            ctx.fillRect(i * bw, 0, Math.ceil(bw), sunH);
        }
        if (real ? terrainClear(x, 'earth') : x.earth_ok) {
            ctx.fillStyle = '#7fb2ff';
            ctx.fillRect(i * bw, sunH + gap, Math.ceil(bw), h - sunH - gap);
        }
    });
    ctx.fillStyle = 'rgba(255,255,255,0.14)';
    const labels = [];
    s.forEach((x, i) => {
        if (x.t.endsWith('T00:00Z')) {
            ctx.fillRect(i * bw, 0, Math.max(1, devicePixelRatio), h);
            const d = new Date(x.t);
            labels.push(`<span style="left:${(100 * i / s.length).toFixed(2)}%">${d.toLocaleDateString('en-GB', {weekday: 'short', day: 'numeric', timeZone: 'UTC'})}</span>`);
        }
    });
    $('daylabels').innerHTML = labels.join('');
    const x = Math.min(Number($('timeline').value), s.length - 1) * bw + bw / 2;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(x - devicePixelRatio, 0, 2 * devicePixelRatio, h);
}

$('strip').onclick = e => {
    const c = timeSource();
    if (!c?.result) {
        return;
    }
    const r = $('strip').getBoundingClientRect();
    $('timeline').value = Math.floor((e.clientX - r.left) / r.width * c.result.samples.length);
    stop();
    renderSelected();
};
$('timeline').oninput = () => {
    stop();
    renderSelected();
};

function stop() {
    playing = false;
    $('play').innerHTML = '&#9654;';
}

$('play').onclick = () => {
    playing = !playing;
    $('play').innerHTML = playing ? '&#10074;&#10074;' : '&#9654;';
};

// Time-lapse speed, in simulated hours per real second.
let speedHours = 6;

// ================= Side panel =================
function compass(az) {
    const names = ['north', 'north-northeast', 'northeast', 'east-northeast', 'east', 'east-southeast', 'southeast', 'south-southeast',
        'south', 'south-southwest', 'southwest', 'west-southwest', 'west', 'west-northwest', 'northwest', 'north-northwest'];
    return names[Math.round((((az % 360) + 360) % 360) / 22.5) % 16];
}

// "south polar highlands", "near side plains": a plain name for the kind of place.
function regionName(lat, lon) {
    const e = elevationAt(lat, lon);
    const ground = e === null ? '' : e > 1 ? ' highlands' : e < -1.5 ? ' lowlands' : ' plains';
    const where = lat <= -75 ? 'south polar' : lat >= 75 ? 'north polar' : Math.abs(lon) <= 90 ? 'near side' : 'far side';
    return where + ground;
}

function whereLine(lat, lon) {
    return `\u2248 ${Math.abs(lat).toFixed(1)}\u00b0${lat < 0 ? 'S' : 'N'} \u00b7 ${Math.abs(lon).toFixed(1)}\u00b0${lon < 0 ? 'W' : 'E'} \u00b7 ${regionName(lat, lon)}`;
}

function pill(el, text, kind) {
    el.textContent = text;
    el.className = 'pill' + (kind ? ' ' + kind : '');
}

function bigNum(value, unit) {
    return `${value}<small>${unit}</small>`;
}

// "If you landed here this week": four big numbers for a site (or the spot you stand on).
function renderWeek() {
    const show = (mode === 'globe' || mode === 'surface');
    const c = timeSource();
    if (!show || !c?.result) {
        $('week').hidden = true;
        return;
    }
    $('week').hidden = false;
    const stepH = c.result.window.step_minutes / 60;
    const samples = c.result.samples;
    const hours = samples.length * stepH;
    // In the surface view, once the real horizon is loaded, every number uses it; otherwise a smooth Moon.
    const real = samples.length && terrainClear(samples[0], 'sun') !== null;
    const sunOk = samples.map(x => (real ? terrainClear(x, 'sun') : x.sun_ok));
    const earthOk = samples.map(x => (real ? terrainClear(x, 'earth') : x.earth_ok));
    const run = flags => {
        let best = 0;
        let n = 0;
        for (const f of flags) {
            n = f ? n + 1 : 0;
            best = Math.max(best, n);
        }
        return best * stepH;
    };
    const sunRun = run(sunOk);
    const night = run(sunOk.map(f => !f));
    const lit = sunOk.filter(Boolean).length * stepH;
    const both = sunOk.filter((f, i) => f && earthOk[i]).length * stepH;
    const big = h => (h >= 48 ? bigNum((h / 24).toFixed(1), 'days') : bigNum(Math.round(h), 'h'));
    $('wk-sun').innerHTML = big(sunRun);
    $('wk-night').innerHTML = big(night);
    $('wk-lit').innerHTML = bigNum(Math.round((100 * lit) / hours), '%');
    $('wk-both').innerHTML = bigNum(Math.round(both), 'h');
    $('wk-note').textContent = `${c.name} \u00b7 ${c.result.window.days} days from ${c.result.window.start.slice(0, 10)} UTC \u00b7 ${real ? 'real terrain horizon' : 'smooth-Moon horizon'}`;
}

function renderSelected() {
    const c = selected();
    $('site-name').textContent = c ? c.name : 'No site yet';
    $('site-coords').textContent = c ? whereLine(c.lat, c.lon) : '';
    const meta = $('site-meta');
    meta.innerHTML = '';
    const pre = c ? presetFor(c) : null;
    if (pre) {
        const src = siteSources[pre.source];
        meta.append(`${pre.categoryLabel}${pre.agency ? ' \u00b7 ' + pre.agency : ''}${pre.year ? ' \u00b7 ' + pre.year : ''} \u00b7 `);
        if (src) {
            const a = document.createElement('a');
            a.href = src.url;
            a.target = '_blank';
            a.rel = 'noopener';
            a.textContent = 'source';
            a.title = src.title;
            meta.append(a);
        }
    }
    const dl = $('summary');
    dl.innerHTML = '';
    drawStrip();
    const s = currentSample();
    renderWeek();
    if (!s) {
        for (const id of ['sun-el', 'earth-el', 'temp', 'height']) {
            $(id).textContent = '\u2014';
        }
        pill($('pill-sun'), '\u2014');
        pill($('pill-earth'), '\u2014');
        $('sun-state').textContent = $('earth-state').textContent = $('power').textContent = '';
        $('plain').textContent = c?.error ? `No NASA data: ${c.error}` : 'Add a site, then press Analyze.';
        $('clock').textContent = '\u2014';
        return;
    }
    $('sun-el').textContent = `az ${s.sun_az.toFixed(1)}${DEG} \u00b7 el ${s.sun_el.toFixed(2)}${DEG}`;
    $('sun-state').textContent = `${compass(s.sun_az)} \u00b7 ${nextChange(c, 'sun_ok', 'sets', 'rises')}`;
    $('earth-el').textContent = `az ${s.earth_az.toFixed(1)}${DEG} \u00b7 el ${s.earth_el.toFixed(2)}${DEG}`;
    $('earth-state').textContent = `${compass(s.earth_az)} \u00b7 ${nextChange(c, 'earth_ok', 'sets', 'rises')}`;
    pill($('pill-sun'), s.sun_el > 0.27 ? 'full sun' : s.sun_el > -0.27 ? 'partial sun' : 'in shadow', s.sun_el > 0.27 ? 'sun' : s.sun_el > -0.27 ? 'part' : '');
    pill($('pill-earth'), s.earth_ok ? 'Earth in view' : 'Earth has set', s.earth_ok ? 'earth' : '');
    $('temp').textContent = `${Math.round(s.temp_k)} K`;
    $('temp-label').textContent = 'Temperature';
    const hKm = elevationAt(c.lat, c.lon);
    $('height').textContent = hKm === null ? '\u2014' : `${hKm >= 0 ? '+' : ''}${(hKm * 1000).toFixed(0)} m`;
    drawTempChart(c, subsolarLon(moonDir(c.lat, c.lon, s.sun_az, s.sun_el)));
    $('power').textContent = `${Math.round(s.temp_k - 273.15)} ${DEG}C \u00b7 ${installed.diviner ? 'measured by NASA Diviner' : 'our estimate'} \u00b7 sunlight ${Math.round(s.flux_w_m2)} W/m\u00b2`;
    {
        const i = Math.min(Number($('timeline').value), c.result.samples.length - 1);
        const stepH = c.result.window.step_minutes / 60;
        const day = Math.floor(i * stepH / 24) + 1;
        const when = new Date(s.t);
        const dateText = when.toLocaleDateString('en-GB', {day: 'numeric', month: 'short', timeZone: 'UTC'});
        const longDate = when.toLocaleDateString('en-GB', {weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC'}).replace(',', '');
        $('clock').innerHTML = `${longDate} <small>${s.t.slice(11, 16)} UTC \u00b7 day ${day} of ${c.result.window.days}</small>`;
        void dateText;
    }
    const sunText = s.sun_el > 0.5 ? `the Sun is ${s.sun_el.toFixed(0)}${DEG} up in the ${compass(s.sun_az)}` : s.sun_ok ? `the Sun is right on the horizon in the ${compass(s.sun_az)}` : 'the Sun is below the horizon';
    const earthText = s.earth_el > 0 ? `Earth is ${s.earth_el.toFixed(0)}${DEG} up in the ${compass(s.earth_az)}` : 'Earth is below the horizon';
    const verdict = s.both_ok ? 'A rover here has solar power and a direct link to Earth.'
        : s.sun_ok ? 'A rover here has power, but no direct link to Earth.'
            : s.earth_ok ? 'A rover here can talk to Earth, but has no solar power.'
                : 'A rover here has no solar power and no link to Earth.';
    $('plain').textContent = `Right now, ${sunText}, and ${earthText}. ${verdict}`;
    const m = c.result.summary;
    const items = [
        ['Unbroken Sun + Earth', `${m.both.longest_h} h`],
        ['Best window starts', fmtTime(m.both.best_start)],
        ['Best window ends', fmtTime(m.both.best_end)],
        ['Sunlit', `${m.sun.total_h} h`],
        ['Earth in view', `${m.earth.total_h} h`],
        ['Energy, tracking panel', `${m.energy_tracking_kwh_m2} kWh/m\u00b2`],
        ['Energy, flat panel', `${m.energy_flat_kwh_m2} kWh/m\u00b2`],
        ['Temperature range', `${Math.round(m.temp_min_k)} to ${Math.round(m.temp_max_k)} K`],
        ['Distance to Earth', `${Math.round(m.mean_earth_km).toLocaleString()} km`],
    ];
    for (const [a, b] of items) {
        const dt = document.createElement('dt');
        dt.textContent = a;
        const dd = document.createElement('dd');
        dd.textContent = b;
        dl.append(dt, dd);
    }
    placeGlobeBodies(c, s);
    updateStreet();
    if (mode === 'surface') {
        updateSky(s);
        renderSurfaceReadout();
    }
    drawSky($('skychart'), c, s);
    if (mode === 'timeline') {
        drawSky($('skychart-big'), c, s);
        for (const row of document.querySelectorAll('.tl-row')) {
            drawBars(row.querySelector('canvas'), candidates.find(k => k.id === Number(row.dataset.id)));
        }
    }
    if (map2d && mode === 'globe') {
        drawMap2d();
    }
    refreshSouthPole();
}

// "Sets in 32 h" / "rises in 5 h", like the team repo's site card.
function nextChange(c, key, setWord, riseWord) {
    const samples = c.result.samples;
    const i0 = Math.min(Number($('timeline').value), samples.length - 1);
    const now = samples[i0][key];
    for (let i = i0 + 1; i < samples.length; i++) {
        if (samples[i][key] !== now) {
            const h = (i - i0) * c.result.window.step_minutes / 60;
            const when = h >= 48 ? `${(h / 24).toFixed(1)} days` : `${Math.round(h)} h`;
            return `${now ? setWord : riseWord} in ${when}`;
        }
    }
    return now ? 'up all window' : 'down all window';
}

function placeGlobeBodies(c, s) {
    const sunM = moonDir(c.lat, c.lon, s.sun_az, s.sun_el);
    const earthM = moonDir(c.lat, c.lon, s.earth_az, s.earth_el);
    const site = upAt(c.lat, c.lon).multiplyScalar(1.003);
    globeSun.position.copy(sunM).multiplyScalar(6.5);
    globeEarth.position.copy(earthM).multiplyScalar(3.6);
    sunArrow.position.copy(site);
    sunArrow.setDirection(sunM);
    earthArrow.position.copy(site);
    earthArrow.setDirection(earthM);
    sunArrow.visible = mode === 'globe' && s.sun_el > -2;
    earthArrow.visible = mode === 'globe' && s.earth_el > -2;
    lastSunM = sunM.clone();
    if (mode !== 'street') {
        // The Sun is so far away that one direction lights the whole Moon and Earth correctly.
        sunLight.position.copy(sunM).multiplyScalar(50);
        sunLight.intensity = dayNight ? 3 : 0;
        ambient.intensity = dayNight ? 0.1 : 1.7;
    }
    if (globeMap === 'temp' && installed.diviner) {
        const ss = Math.round(subsolarLon(sunM));
        if (`${ss}` !== divNowKey) {
            divNowKey = `${ss}`;
            divMaterial.map = divTexture(`/api/diviner/map?kind=now&sslon=${ss}`);
            divMaterial.needsUpdate = true;
        }
        legendNote = `Measured now \u00b7 NASA Diviner \u00b7 Sun over ${ss}\u00b0E`;
        showLegend('div', 40, 400);
    } else if (globeMap === 'temp') {
        updateTempTexture(sunM, s.sun_au);
        showLegend('temp', TEMP_MIN, TEMP_MAX);
    } else if (globeMap === 'max' || globeMap === 'min') {
        legendNote = globeMap === 'max' ? 'Hottest of 24 Diviner snapshots' : 'Coldest of 24 Diviner snapshots';
        showLegend('div', 40, 400);
    } else if (globeMap === 'comp') {
        showLegend(null);
    } else if (globeMap === 'elev') {
        showLegend('globe', -10, 11);
    } else {
        showLegend(null);
    }
}

// ================= Modes and camera =================
const NAV_MODES = ['globe', 'southpole', 'surface', 'street', 'rank', 'timeline', 'past', 'missions'];
const PANELS = {rank: 'rank', missions: 'missions', earth: 'earthview', sun: 'sunview', timeline: 'timelineview', past: 'pastview', southpole: 'spview'};
let config = {cesium_ion_token: '', google_maps_key: ''};
fetch('/api/config').then(r => r.json()).then(j => {
    config = j;
}).catch(() => {});

function setMode(next) {
    if (next !== mode) {
        view.classList.add('switching');
        setTimeout(() => view.classList.remove('switching'), 260);
    }
    mode = next;
    flight = null;
    for (const id of NAV_MODES) {
        $('mode-' + id).classList.toggle('active', id === mode);
    }
    for (const [m, id] of Object.entries(PANELS)) {
        $(id).hidden = mode !== m;
    }
    const isPage = Boolean(PANELS[mode]);
    document.body.dataset.mode = mode;
    document.body.classList.toggle('page-open', isPage);
    // The Moon stays behind the full pages, so the view never goes blank.
    globe.visible = mode === 'globe' || isPage;
    street.visible = mode === 'street';
    renderer.domElement.style.visibility = (mode === 'globe' && !map2d) || mode === 'street' || isPage ? 'visible' : 'hidden';
    $('map2d').hidden = !(mode === 'globe' && map2d);
    $('cesium').hidden = mode !== 'surface';
    controls.enabled = mode === 'globe';
    $('globe-tools').hidden = mode !== 'globe';
    $('street-tools').hidden = mode !== 'street';
    $('surface-tools').hidden = mode !== 'surface';
    $('compass').hidden = mode !== 'surface';
    $('minimap').hidden = mode !== 'surface';
    $('readout').hidden = !(mode === 'street' || mode === 'surface');
    $('legend').hidden = true;
    $('cursor').textContent = '';
    $('fact').hidden = true;
    camera.fov = mode === 'street' ? 70 : 40;
    camera.updateProjectionMatrix();
    const c = selected();
    if (mode === 'street') {
        $('hint').textContent = 'Drag to look \u00b7 W A S D or arrow keys to walk \u00b7 Shift to run';
        if (c) {
            loadTerrain(c);
        }
        const s = currentSample();
        if (s) {
            yaw = s.sun_el > 0 ? s.sun_az : s.earth_az;
            pitch = 8;
        }
    } else if (mode === 'globe') {
        $('hint').textContent = 'drag rotate \u00b7 scroll zoom \u00b7 click the Moon to stand there \u00b7 click Earth or the Sun';
        moonView();
    } else if (mode === 'surface') {
        $('hint').textContent = 'drag look around \u00b7 click walk there \u00b7 WASD move \u00b7 scroll zoom';
        const target = nextSurface || (c ? {lat: c.lat, lon: c.lon, name: c.name} : null);
        nextSurface = null;
        if (target) {
            openSurfaceAt(target.lat, target.lon, target.name, target.elevation);
        }
        $('spot').hidden = true;
    } else {
        $('hint').textContent = '';
    }
    if (mode === 'timeline') {
        renderTimelinePage();
    }
    if (mode === 'past') {
        renderPast();
    }
    if (mode === 'southpole') {
        showSouthPole();
        complete('pole');
    }
    if (mode === 'rank') {
        renderRank();
    }
    renderSelected();
}

for (const id of NAV_MODES) {
    $('mode-' + id).onclick = () => setMode(id);
}
for (const b of document.querySelectorAll('[data-close]')) {
    b.onclick = () => setMode('globe');
}

// ---------- Moon surface (Cesium) ----------
let surfacePos = null;
let nextSurface = null;
// Horizons analysis for the exact spot you stand on (time strip, week card, overhead panel).
let surfaceSpot = null;

async function loadSurfaceSpot(lat, lon, name) {
    const spot = {id: -1, name, lat, lon, result: null};
    surfaceSpot = spot;
    try {
        const r = await fetch(query(spot));
        if (r.ok) {
            spot.result = await r.json();
        }
    } catch (e) {
        // Keep the selected site's data if Horizons does not answer.
    }
    if (surfaceSpot === spot && mode === 'surface') {
        setupTimeline();
        renderSelected();
        if (spot.result) {
            setSkyTracks(spot.result.samples);
            setTracksVisible(tracksOn);
        }
        drawHorizon();
    }
}

let surfaceElevation = false;

// Elevation range around a point from the LOLA grid: middle 96%, rounded out to 100 m (as in the team repo).
function localRange(lat, lon) {
    if (!elevationGrid) {
        return {min: -3000, max: 3000};
    }
    const vals = [];
    const dLon = Math.min(180, 2.5 / Math.max(0.05, Math.cos(rad(lat))));
    for (let la = lat - 2.5; la <= lat + 2.5; la += 0.25) {
        for (let lo = lon - dLon; lo <= lon + dLon; lo += Math.max(0.25, dLon / 20)) {
            const v = elevationAt(Math.max(-89.9, Math.min(89.9, la)), lo);
            if (v !== null) {
                vals.push(v * 1000);
            }
        }
    }
    vals.sort((a, b) => a - b);
    const at = q => vals[Math.round(q * (vals.length - 1))];
    const min = Math.floor(at(0.02) / 100) * 100;
    const max = Math.ceil(at(0.98) / 100) * 100;
    return {min, max: max > min ? max : min + 100};
}

function applySurfaceElevation() {
    $('sf-elev').classList.toggle('active', surfaceElevation);
    $('sf-real').classList.toggle('active', !surfaceElevation);
    if (!surfacePos) {
        return;
    }
    if (surfaceElevation) {
        // Same range as the corner mini-map, so the ground and the map share one colour scale.
        const near = miniPatch && Math.abs(miniPatch.lat - surfacePos.openLat) < 1e-6 && Math.abs(miniPatch.lon - surfacePos.openLon) < 1e-6;
        const r = near ? {min: miniPatch.lo * 1000, max: Math.max(miniPatch.hi * 1000, miniPatch.lo * 1000 + 20)} : localRange(surfacePos.lat, surfacePos.lon);
        setElevationColors(true, r.min, r.max, MINI_HEX);
        complete('heat');
    } else {
        setElevationColors(false);
    }
    showLegend(null);
}

$('sf-elev').onclick = () => {
    surfaceElevation = true;
    applySurfaceElevation();
};
$('sf-real').onclick = () => {
    surfaceElevation = false;
    applySurfaceElevation();
};

async function openSurfaceAt(lat, lon, label, withElevation) {
    await statusReady;
    if (withElevation) {
        surfaceElevation = true;
    }
    surfacePos = {lat, lon, label, walked: 0, openLat: lat, openLon: lon};
    $('sf-name').textContent = label;
    $('sf-where').textContent = whereLine(lat, lon);
    for (const b of document.querySelectorAll('[data-jump]')) {
        const p = presets.find(x => x.id === b.dataset.jump);
        b.classList.toggle('active', Boolean(p && Math.abs(p.lat - lat) < 1e-6 && Math.abs(p.lon - lon) < 1e-6));
    }
    loadSurfaceSpot(lat, lon, label);
    loadHorizon(lat, lon);
    complete('surface');
    if (presets.some(p => p.category === 'apollo' && p.name === label)) {
        collect('apollo', label, 3, 'apollo3');
    }
    showFact('moon');
    const s = currentSample();
    try {
        await openSurface($('cesium'), {
            lat, lon, sample: s, token: config.cesium_ion_token, eyeM: Number($('camera').value),
            startHighM: withElevation ? 250 : undefined,
            hasTerrain: installed.terrain,
            fallbackHeightM: (elevationAt(lat, lon) ?? 0) * 1000,
            yaw: s ? (s.sun_el > 0 ? s.sun_az : s.earth_az) : 0,
            onStatus: setStatus,
            onPoint: pt => {
                if (!pt) {
                    hideTip();
                    return;
                }
                const d = pt.distanceM < 1000 ? `${Math.round(pt.distanceM)} m away` : `${(pt.distanceM / 1000).toFixed(1)} km away`;
                showTip(pt.x, pt.y, `${fmtLat(pt.lat)}, ${fmtLon(pt.lon)}`, `Elevation ${(pt.heightM / 1000).toFixed(2)} km \u00b7 ${d}`);
            },
            onMeasure: showMeasure,
            onWalk: (m, la, lo) => {
                surfacePos.walked = m;
                surfacePos.lat = la;
                surfacePos.lon = lo;
                if (m >= 1000) {
                    complete('walk');
                }
                renderSurfaceReadout();
            },
        });
    } catch (e) {
        setStatus('Surface view could not start: ' + e.message);
    }
    applySurfaceElevation();
    renderSurfaceReadout();
}

// "If you landed here this week" and "What's overhead", filled with real data.
let pointInfo = null;
let pointKey = '';

function fetchPoint(lat, lon) {
    const key = `${lat.toFixed(3)},${lon.toFixed(3)}`;
    if (key === pointKey || !installed.terrain) {
        return;
    }
    pointKey = key;
    fetch(`/api/point?lat=${lat}&lon=${lon}`).then(r => (r.ok ? r.json() : null)).then(j => {
        pointInfo = j;
        renderSurfaceReadout();
    }).catch(() => {});
}

function longestFalse(samples, key, stepH) {
    let best = 0;
    let run = 0;
    for (const x of samples) {
        run = x[key] ? 0 : run + 1;
        best = Math.max(best, run);
    }
    return best * stepH;
}

function renderSurfaceReadout() {
    if (mode !== 'surface' || !surfacePos) {
        return;
    }
    drawHorizon();
    const s = currentSample();
    fetchPoint(surfacePos.lat, surfacePos.lon);
    $('readout').hidden = false;
    const sunReal = terrainClear(s, 'sun');
    const earthReal = terrainClear(s, 'earth');
    const lit = s && (sunReal === null ? s.sun_el > 0.27 : sunReal);
    const partial = s && !lit && sunReal === null && s.sun_el > -0.27;
    const home = s && (earthReal === null ? s.earth_ok : earthReal);
    const basis = sunReal === null ? 'smooth Moon' : 'real terrain';
    const hKm = pointInfo ? pointInfo.elevation_km : elevationAt(surfacePos.lat, surfacePos.lon);
    const height = hKm === null || hKm === undefined ? '\u2014' : `${hKm >= 0 ? '+' : ''}${(hKm * 1000).toFixed(1)} m`;
    const slope = pointInfo ? `${pointInfo.slope_deg.toFixed(1)}\u00b0` : '\u2014';
    const temp = s ? (installed.diviner && s.temp_k ? s.temp_k : tempModel(Math.sin(rad(s.sun_el)), s.sun_au)) : null;
    const walked = surfacePos.walked < 1000 ? Math.round(surfacePos.walked) + ' m' : (surfacePos.walked / 1000).toFixed(2) + ' km';
    $('readout').innerHTML = `
        <p class="kicker">What's overhead</p>
        <div class="rows over">
            <span><i class="dot sun"></i>Sun</span><b>${s ? `az ${s.sun_az.toFixed(1)}\u00b0 \u00b7 el ${s.sun_el.toFixed(2)}\u00b0` : '\u2014'}</b>
            <span><i class="dot earth"></i>Earth</span><b>${s ? `az ${s.earth_az.toFixed(1)}\u00b0 \u00b7 el ${s.earth_el.toFixed(2)}\u00b0` : '\u2014'}</b>
            <span>Is the rover in sun?</span><b><i class="pill ${lit ? 'sun' : partial ? 'part' : ''}">${s ? (lit ? 'full sun' : partial ? 'partial sun' : (sunReal === false && s.sun_el > 0 ? 'terrain shadow' : 'in shadow')) : '\u2014'}</i></b>
            <span>Can it call home?</span><b><i class="pill ${home ? 'earth' : ''}">${s ? (home ? 'Earth in view' : (earthReal === false && s.earth_el > 0 ? 'behind terrain' : 'Earth has set')) : '\u2014'}</i></b>
            <small class="full">Sun and Earth checked against the ${basis} horizon</small>
            <span>Height</span><b>${height}</b>
            <span>Ground slope</span><b>${slope}</b>
            <span>Temperature</span><b>${temp ? Math.round(temp) + ' K' : '\u2014'}</b>
            <small class="full">${installed.diviner ? 'Measured by NASA Diviner' : 'Our estimate'} \u00b7 walked ${walked}</small>
        </div>`;
}

$('sf-trek').onclick = () => {
    setLayer('lola');
    $('sf-trek').classList.add('active');
    $('sf-3d').classList.remove('active');
};
$('sf-3d').onclick = async () => {
    if (await setLayer('ion')) {
        $('sf-3d').classList.add('active');
        $('sf-trek').classList.remove('active');
    }
};
$('sf-sun').onclick = () => {
    const s = currentSample();
    if (s) {
        surfaceFace(s.sun_az, s.sun_el);
    }
};
$('sf-earth').onclick = () => {
    const s = currentSample();
    if (s) {
        surfaceFace(s.earth_az, s.earth_el);
    }
};
$('sf-up').onclick = () => birdsEye();
let sunlightOn = false;
$('sf-shadow').onclick = () => {
    sunlightOn = !sunlightOn;
    setSunlight(sunlightOn);
    $('sf-shadow').classList.toggle('active', sunlightOn);
};

// ---------- Earth and Sun ----------
function openEarth(lat, lng, label) {
    setMode('earth');
    complete('earth');
    loadEpic();
    fillFactCard($('earth-fact'), 'earth');
    showStreetView(config.google_maps_key, lat, lng, label, setStatus);
}

for (const b of document.querySelectorAll('[data-place]')) {
    b.onclick = () => {
        const [la, lo, name] = b.dataset.place.split(',');
        collect('centers', name, 3, 'centers');
        fillFactCard($('earth-fact'), 'earth');
        showStreetView(config.google_maps_key, Number(la), Number(lo), name, setStatus);
    };
}

function openSun() {
    setMode('sun');
    complete('sun');
    fillFactCard($('sun-fact'), 'sun');
    showSdo('0171');
    collect('sdo', '0171', 4, 'spectrum');
}

for (const b of document.querySelectorAll('[data-sdo]')) {
    b.onclick = () => {
        showSdo(b.dataset.sdo);
        collect('sdo', b.dataset.sdo, 4, 'spectrum');
        fillFactCard($('sun-fact'), 'sun');
    };
}

function fitAll() {
    const c = selected();
    const box = new T.Box3();
    for (const [p, r] of [[new T.Vector3(), 1.1], [globeEarth.position, 0.9], [globeSun.position, 1.4]]) {
        box.expandByPoint(p.clone().addScalar(r));
        box.expandByPoint(p.clone().addScalar(-r));
    }
    const sphere = box.getBoundingSphere(new T.Sphere());
    const n = new T.Vector3().crossVectors(globeEarth.position, globeSun.position);
    if (n.lengthSq() < 1e-6) {
        n.set(0, 0.3, 1);
    }
    n.normalize();
    if (c) {
        const up = upAt(c.lat, c.lon);
        if (n.dot(up) < 0) {
            n.negate();
        }
        n.addScaledVector(up, 0.6).normalize();
    }
    const half = Math.min(rad(camera.fov / 2), Math.atan(Math.tan(rad(camera.fov / 2)) * camera.aspect));
    const dist = sphere.radius / Math.sin(half) * 1.02;
    flyTo(sphere.center.clone().addScaledVector(n, dist), sphere.center);
}

// A large Moon that fills the view, turned toward the selected site (as in the team mockup).
function moonView() {
    const c = selected();
    const dir = c ? upAt(Math.max(-60, Math.min(60, c.lat)), c.lon) : upAt(0, 0);
    flyTo(dir.multiplyScalar(3.3).add(new T.Vector3(0.25, 0, 0)), new T.Vector3(0.25, 0, 0));
}

function flyToSite(lat, lon) {
    flyTo(upAt(lat, lon).multiplyScalar(2.2), new T.Vector3());
}

$('fit').onclick = fitAll;
$('closeup').onclick = () => {
    const c = selected();
    if (c) {
        flyToSite(c.lat, c.lon);
    }
};

function face(key) {
    const s = currentSample();
    if (!s) {
        return;
    }
    yaw = s[key + '_az'];
    pitch = Math.max(2, s[key + '_el']);
}

$('look-sun').onclick = () => face('sun');
$('look-earth').onclick = () => face('earth');

function flyTo(position, target) {
    flight = {position: position.clone(), target: target.clone()};
}

function resize() {
    const w = view.clientWidth;
    const h = view.clientHeight;
    renderer.setSize(w, h);
    camera.aspect = w / Math.max(1, h);
    if (document.body.classList.contains('at-home') && camera.view && camera.view.enabled) {
        camera.setViewOffset(w, h, -w * 0.2, 0, w, h);
    }
    camera.updateProjectionMatrix();
    drawStrip();
    resizeSurface();
}

new ResizeObserver(resize).observe(view);

// ================= Input =================
const raycaster = new T.Raycaster();

function moonHit(e) {
    const r = renderer.domElement.getBoundingClientRect();
    raycaster.setFromCamera(new T.Vector2((e.clientX - r.left) / r.width * 2 - 1, -(e.clientY - r.top) / r.height * 2 + 1), camera);
    return raycaster;
}

// A click (press and release without dragging) on the Moon, Earth or Sun opens its view.
let press = null;
renderer.domElement.addEventListener('pointerdown', e => {
    press = {x: e.clientX, y: e.clientY, t: performance.now()};
});
renderer.domElement.addEventListener('pointerup', e => {
    if (!press || mode !== 'globe') {
        return;
    }
    const moved = Math.hypot(e.clientX - press.x, e.clientY - press.y);
    const quick = performance.now() - press.t < 400;
    press = null;
    if (moved < 5 && quick) {
        globeClick(e);
    }
});

function bodyOf(obj) {
    for (let o = obj; o; o = o.parent) {
        if (o === globeEarth) {
            return 'earth';
        }
        if (o === globeSun) {
            return 'sun';
        }
        if (o.userData && o.userData.id) {
            return 'marker';
        }
        if (o === moon) {
            return 'moon';
        }
    }
    return null;
}

// Fly in until a body fills the view (the label or the body itself can be clicked).
function zoomToBody(center, radius) {
    const half = Math.min(rad(camera.fov / 2), Math.atan(Math.tan(rad(camera.fov / 2)) * camera.aspect));
    const dist = radius / Math.sin(half) * 1.04;
    const from = camera.position.clone().sub(center);
    if (from.lengthSq() < 1e-6) {
        from.set(0, 0, 1);
    }
    flyTo(center.clone().addScaledVector(from.normalize(), dist), center.clone());
}

function bodyCard(title, sub, lookLabel, onLook, otherLabel, onOther) {
    const card = $('spot');
    $('spot-where').textContent = title;
    $('spot-elev').textContent = sub;
    $('spot-look').textContent = lookLabel;
    $('spot-add').textContent = otherLabel;
    card.style.left = `${view.clientWidth / 2 - 125}px`;
    card.style.top = `${view.clientHeight - 260}px`;
    card.hidden = false;
    $('spot-look').onclick = () => {
        card.hidden = true;
        onLook();
    };
    $('spot-add').onclick = () => {
        card.hidden = true;
        onOther();
    };
    $('spot-close').onclick = () => {
        card.hidden = true;
    };
}

function globeClick(e) {
    const ray = moonHit(e);
    const hits = ray.intersectObjects([moon, globeEarth, globeSun, ...markerGroup.children], true);
    const first = hits.find(h => bodyOf(h.object));
    if (!first) {
        return;
    }
    const body = bodyOf(first.object);
    if (body === 'marker') {
        let o = first.object;
        while (o && !o.userData.id) {
            o = o.parent;
        }
        selectSite(o.userData.id);
        return;
    }
    if (body === 'earth') {
        zoomToBody(globeEarth.position, 0.45);
        // Texture coordinate of the click picks the place on Earth (if the globe itself was hit).
        const lat = first.object === globeEarth && first.uv ? first.uv.y * 180 - 90 : 28.5729;
        const lng = first.object === globeEarth && first.uv ? first.uv.x * 360 - 180 : -80.649;
        showFact('earth');
        bodyCard('Earth', `As seen from the Moon \u00b7 ${fmtLat(lat)}, ${fmtLon(lng)} under the pointer`,
            'Street View here', () => openEarth(lat, lng, `${fmtLat(lat)}, ${fmtLon(lng)}`),
            'NASA photo', () => openEarth(28.5729, -80.649, 'Kennedy Space Center'));
        return;
    }
    if (body === 'sun') {
        zoomToBody(globeSun.position, 0.7);
        showFact('sun');
        bodyCard('The Sun', 'Direction from the selected site, from NASA/JPL Horizons',
            'See it now (NASA SDO)', () => openSun(), 'Back to the Moon', () => moonView());
        return;
    }
    const p = first.point.clone().normalize();
    const lat = Math.asin(p.y) * 180 / Math.PI;
    const lon = Math.atan2(-p.z, p.x) * 180 / Math.PI;
    const name = `Site ${lat.toFixed(2)}, ${lon.toFixed(2)}`;
    $('name').value = name;
    $('preset').value = '';
    writeCoords(lat, lon);
    // Zoom in on the clicked spot, then drop into the 3D surface view right there.
    zoomToBody(new T.Vector3(), 1.0);
    flight.position = upAt(lat, lon).multiplyScalar(flight.position.length() * 0.7);
    setStatus(`Landing at ${fmtLat(lat)}, ${fmtLon(lon)}...`);
    setTimeout(() => {
        nextSurface = {lat, lon, name, elevation: true};
        setMode('surface');
    }, 650);
}

// After you see a spot, a small card offers Street View there (with elevation colours) or adding it as a site.
function showSpotPrompt(x, y, lat, lon, name) {
    hideTip();
    const card = $('spot');
    const el = elevationAt(lat, lon);
    $('spot-where').textContent = `${fmtLat(lat)}, ${fmtLon(lon)}`;
    $('spot-elev').textContent = el !== null ? `Elevation ${el.toFixed(2)} km (NASA LOLA)` : '';
    card.style.left = `${Math.min(x, view.clientWidth - 280)}px`;
    card.style.top = `${Math.min(y, view.clientHeight - 150)}px`;
    card.hidden = false;
    $('spot-look').textContent = 'Look around here';
    $('spot-add').textContent = 'Add site';
    $('spot-look').onclick = () => {
        card.hidden = true;
        nextSurface = {lat, lon, name, elevation: true};
        setMode('surface');
    };
    $('spot-add').onclick = () => {
        card.hidden = true;
        $('add').click();
    };
    $('spot-close').onclick = () => {
        card.hidden = true;
    };
}

function showTip(x, y, main, sub) {
    const tip = $('cursor');
    tip.className = 'tip';
    tip.style.left = `${x}px`;
    tip.style.top = `${y}px`;
    tip.textContent = main;
    if (sub) {
        const sm = document.createElement('small');
        sm.textContent = sub;
        tip.append(sm);
    }
}

function hideTip() {
    $('cursor').textContent = '';
}

renderer.domElement.addEventListener('pointerleave', hideTip);

let hoverQueued = false;
renderer.domElement.addEventListener('pointermove', e => {
    if (drag) {
        yaw -= (e.clientX - drag.x) * 0.15;
        pitch = T.MathUtils.clamp(pitch + (e.clientY - drag.y) * 0.15, -60, 89);
        drag = {x: e.clientX, y: e.clientY};
        return;
    }
    if (mode !== 'globe' || hoverQueued) {
        return;
    }
    hoverQueued = true;
    requestAnimationFrame(() => {
        hoverQueued = false;
        const hit = moonHit(e).intersectObject(moon, false)[0];
        if (!hit) {
            hideTip();
            return;
        }
        const p = hit.point.clone().normalize();
        const lat = Math.asin(p.y) * 180 / Math.PI;
        const lon = Math.atan2(-p.z, p.x) * 180 / Math.PI;
        const el = elevationAt(lat, lon);
        const r = renderer.domElement.getBoundingClientRect();
        const near = nearestSite(lat, lon, 2.5);
        showTip(e.clientX - r.left, e.clientY - r.top, near ? `${near.name} \u00b7 score ${scoreOf(near)}` : `${fmtLat(lat)}, ${fmtLon(lon)}`,
            (el !== null ? `Elevation ${el.toFixed(2)} km \u00b7 ` : '') + 'click to look around');
    });
});
renderer.domElement.addEventListener('pointerdown', e => {
    flight = null;
    if (mode === 'street') {
        drag = {x: e.clientX, y: e.clientY};
        renderer.domElement.setPointerCapture(e.pointerId);
    }
});
for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) {
    renderer.domElement.addEventListener(name, () => {
        drag = null;
    });
}
window.addEventListener('keydown', e => {
    if (mode === 'street' && !(e.target instanceof HTMLInputElement)) {
        keys.add(e.key.toLowerCase());
        if (e.key.startsWith('Arrow')) {
            e.preventDefault();
        }
    }
});
window.addEventListener('keyup', e => {
    keys.delete(e.key.toLowerCase());
});
window.addEventListener('blur', () => keys.clear());

function walk(dt) {
    let f = 0;
    let r = 0;
    if (keys.has('w') || keys.has('arrowup')) {
        f += 1;
    }
    if (keys.has('s') || keys.has('arrowdown')) {
        f -= 1;
    }
    if (keys.has('d') || keys.has('arrowright')) {
        r += 1;
    }
    if (keys.has('a') || keys.has('arrowleft')) {
        r -= 1;
    }
    if (!f && !r) {
        return;
    }
    const speed = (keys.has('shift') ? 3 : 0.4) * dt;
    const a = rad(yaw);
    walker.e += (Math.sin(a) * f + Math.cos(a) * r) * speed;
    walker.n += (Math.cos(a) * f - Math.sin(a) * r) * speed;
    const lim = terrain ? terrain.half - 1 : 50;
    walker.e = Math.max(-lim, Math.min(lim, walker.e));
    walker.n = Math.max(-lim, Math.min(lim, walker.n));
    const s = currentSample();
    const c = selected();
    if (s && c) {
        renderReadout(c, s);
    }
}

// ================= Loop =================
renderer.setAnimationLoop(now => {
    const dt = Math.min((now - last) / 1000, 0.1);
    last = now;
    if (playing) {
        tick += dt;
        const anyRes = candidates.find(k => k.result);
        const stepH = anyRes ? anyRes.result.window.step_minutes / 60 : 1;
        if (tick > stepH / speedHours) {
            tick = 0;
            const next = Number($('timeline').value) + 1;
            if (next > Number($('timeline').max)) {
                stop();
            } else {
                $('timeline').value = next;
                renderSelected();
            }
        }
    }
    if (mode === 'surface') {
        drawCompass();
    }
    if (mode === 'street') {
        walk(dt);
        const ground = terrain ? zAt(walker.e, walker.n) * exag : 0;
        camera.position.set(walker.e, ground + Number($('camera').value) / 1000, -walker.n);
        camera.lookAt(camera.position.clone().add(skyDir(yaw, pitch)));
        skyAnchor.position.copy(camera.position);
    } else {
        if (flight) {
            const f = 1 - Math.exp(-5 * dt);
            camera.position.lerp(flight.position, f);
            controls.target.lerp(flight.target, f);
            if (camera.position.distanceTo(flight.position) < 0.01) {
                flight = null;
            }
        }
        controls.update();
    }
    if ((mode === 'globe' && !map2d) || mode === 'street' || PANELS[mode] || document.body.classList.contains('at-home')) {
        renderer.render(scene, camera);
    }
    if (mode === 'globe' || PANELS[mode]) {
        pulseZones(now);
    }
});


// ================= Temperature through a lunar day (NASA Diviner) =================
const tempCurves = {};

function drawTempChart(c, sslon) {
    const cv = $('tempchart');
    if (!cv || !installed.diviner) {
        if (cv) {
            cv.hidden = true;
        }
        return;
    }
    const key = `${c.lat.toFixed(3)},${c.lon.toFixed(3)}`;
    if (!tempCurves[key]) {
        tempCurves[key] = 'loading';
        fetch(`/api/diviner/point?lat=${c.lat}&lon=${c.lon}`).then(r => r.json()).then(j => {
            tempCurves[key] = j;
            renderSelected();
        }).catch(() => {
            delete tempCurves[key];
        });
        return;
    }
    const d = tempCurves[key];
    if (d === 'loading') {
        return;
    }
    const W = cv.clientWidth;
    const H = cv.clientHeight;
    cv.width = W * devicePixelRatio;
    cv.height = H * devicePixelRatio;
    const g = cv.getContext('2d');
    g.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
    g.clearRect(0, 0, W, H);
    const pad = {l: 34, r: 8, t: 10, b: 18};
    const X = h => pad.l + h / 24 * (W - pad.l - pad.r);
    const Y = k => pad.t + (1 - (k - 40) / 360) * (H - pad.t - pad.b);
    g.fillStyle = 'rgba(255,255,255,0.04)';
    g.fillRect(X(18), pad.t, X(24) - X(18), H - pad.t - pad.b);
    g.fillRect(X(0), pad.t, X(6) - X(0), H - pad.t - pad.b);
    g.fillStyle = '#5b6676';
    g.font = '10px "Geist Mono", monospace';
    for (const k of [100, 200, 300, 400]) {
        g.fillText(`${k}K`, 0, Y(k) + 3);
    }
    [['0h', 0], ['6h', 6], ['noon', 12], ['18h', 18], ['24h', 24]].forEach(([t, h]) => g.fillText(t, X(h) - 8, H - 4));
    const pts = d.local_time_h.map((h, i) => [h, d.temp_k[i]]).sort((a, b) => a[0] - b[0]);
    pts.push([pts[0][0] + 24, pts[0][1]]);
    pts.unshift([pts[pts.length - 2][0] - 24, pts[pts.length - 2][1]]);
    const grad = g.createLinearGradient(0, Y(400), 0, Y(40));
    grad.addColorStop(0, '#c83c32');
    grad.addColorStop(0.5, '#e6dcbe');
    grad.addColorStop(1, '#3278be');
    g.strokeStyle = grad;
    g.lineWidth = 2;
    g.beginPath();
    pts.forEach(([h, k], i) => (i ? g.lineTo(X(h), Y(k)) : g.moveTo(X(h), Y(k))));
    g.stroke();
    const localNow = (((12 + (c.lon - sslon) / 15) % 24) + 24) % 24;
    let tNow = null;
    for (let i = 0; i < pts.length - 1; i++) {
        if (localNow >= pts[i][0] && localNow <= pts[i + 1][0]) {
            const f = (localNow - pts[i][0]) / (pts[i + 1][0] - pts[i][0] || 1);
            tNow = pts[i][1] + (pts[i + 1][1] - pts[i][1]) * f;
        }
    }
    if (tNow !== null) {
        g.fillStyle = '#ffffff';
        g.beginPath();
        g.arc(X(localNow), Y(tNow), 4.5, 0, Math.PI * 2);
        g.fill();
        g.font = '11px "Geist", sans-serif';
        g.fillText(`now ${Math.round(tNow)} K`, Math.min(X(localNow) + 7, W - 70), Y(tNow) - 7);
    }
    $('tempchart-note').textContent = `Measured by NASA LRO Diviner (0.5\u00b0 cell, about 15 km): ${Math.round(d.min_k)} K (${Math.round(d.min_k - 273)} \u00b0C) to ${Math.round(d.max_k)} K (${Math.round(d.max_k - 273)} \u00b0C). Local time ${localNow.toFixed(1)} h.`;
}


// ================= Surface: compass tape and mini-map (after the team's reference site) =================
function drawCompass() {
    const cv = $('compass');
    const v = getView();
    const W = cv.clientWidth;
    const H = cv.clientHeight;
    if (cv.width !== W * devicePixelRatio) {
        cv.width = W * devicePixelRatio;
        cv.height = H * devicePixelRatio;
    }
    const g = cv.getContext('2d');
    g.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
    g.clearRect(0, 0, W, H);
    const span = 120;
    const px = d => W / 2 + ((((d - v.yaw) % 360) + 540) % 360 - 180) / span * W;
    g.strokeStyle = '#6b6760';
    g.fillStyle = '#a39e95';
    g.font = '10px "IBM Plex Mono", monospace';
    g.textAlign = 'center';
    const names = {0: 'N', 45: 'NE', 90: 'E', 135: 'SE', 180: 'S', 225: 'SW', 270: 'W', 315: 'NW'};
    for (let d = 0; d < 360; d += 5) {
        const x = px(d);
        if (x < 0 || x > W) {
            continue;
        }
        const major = d % 45 === 0;
        g.beginPath();
        g.moveTo(x, H - 4);
        g.lineTo(x, H - (major ? 16 : d % 15 === 0 ? 11 : 7));
        g.stroke();
        if (major) {
            g.fillStyle = '#ece8e1';
            g.font = '600 12px "IBM Plex Mono", monospace';
            g.fillText(names[d], x, 15);
            g.font = '10px "IBM Plex Mono", monospace';
            g.fillStyle = '#a39e95';
        } else if (d % 15 === 0) {
            g.fillText(String(d), x, 15);
        }
    }
    const s = currentSample();
    if (s) {
        for (const [az, color, name] of [[s.sun_az, '#ffb547', 'SUN'], [s.earth_az, '#4ea8ff', 'EARTH']]) {
            let x = px(az);
            const off = x < 6 || x > W - 6;
            x = Math.max(8, Math.min(W - 8, x));
            g.fillStyle = color;
            g.beginPath();
            if (off) {
                const dir = x < W / 2 ? -1 : 1;
                g.moveTo(x + dir * 6, 26);
                g.lineTo(x - dir * 2, 21);
                g.lineTo(x - dir * 2, 31);
            } else {
                g.arc(x, 26, 4, 0, Math.PI * 2);
            }
            g.fill();
            g.font = '600 9px "IBM Plex Mono", monospace';
            g.fillText(name, Math.max(22, Math.min(W - 22, x + (off ? (x < W / 2 ? 22 : -24) : 0))), 40);
        }
    }
    g.fillStyle = '#ff6b3d';
    g.beginPath();
    g.moveTo(W / 2 - 5, H);
    g.lineTo(W / 2 + 5, H);
    g.lineTo(W / 2, H - 7);
    g.fill();
    drawMinimap(v);
}

// Vivid elevation gradient for the corner mini-map (low blue, high red), stretched to the local range.
const MINI_COLORS = [[0, [40, 70, 210]], [0.22, [40, 160, 235]], [0.45, [70, 215, 150]], [0.65, [240, 220, 70]], [0.85, [245, 140, 50]], [1, [225, 50, 45]]];
const MINI_HEX = Array.from({length: 11}, (_, i) => '#' + ramp(MINI_COLORS, i / 10).map(v => Math.round(v).toString(16).padStart(2, '0')).join(''));
let miniPatch = null;
let miniKey = '';

function loadMinimap(lat, lon) {
    const key = `${lat.toFixed(4)},${lon.toFixed(4)}`;
    if (key === miniKey || !installed.terrain) {
        return;
    }
    miniKey = key;
    fetch(`/api/terrain?lat=${lat}&lon=${lon}&half_km=6&n=97`).then(r => (r.ok ? r.json() : null)).then(j => {
        if (!j) {
            return;
        }
        const n = j.n;
        const img = document.createElement('canvas');
        img.width = img.height = n;
        const g = img.getContext('2d');
        const data = g.createImageData(n, n);
        const h = j.elevation_km;
        const lo = Math.min(...h);
        const hi = Math.max(...h);
        for (let i = 0; i < n * n; i++) {
            const c = ramp(MINI_COLORS, (h[i] - lo) / Math.max(0.001, hi - lo));
            const x = i % n;
            const y = Math.floor(i / n);
            const right = h[y * n + Math.min(n - 1, x + 1)];
            const up = h[Math.max(0, y - 1) * n + x];
            const shade = 0.75 + Math.max(-0.25, Math.min(0.25, ((h[i] - right) + (up - h[i])) * 8));
            data.data.set([c[0] * shade, c[1] * shade, c[2] * shade, 255], i * 4);
        }
        g.putImageData(data, 0, 0);
        miniPatch = {img, lat, lon, half: j.half_km, lo, hi};
        if (surfaceElevation) {
            applySurfaceElevation();
        }
    }).catch(() => {});
}

function drawMinimap(v) {
    const cv = $('minimap');
    if (!surfacePos) {
        return;
    }
    loadMinimap(surfacePos.openLat ?? surfacePos.lat, surfacePos.openLon ?? surfacePos.lon);
    const W = cv.clientWidth;
    const H = cv.clientHeight;
    if (cv.width !== W * devicePixelRatio || cv.height !== H * devicePixelRatio) {
        cv.width = W * devicePixelRatio;
        cv.height = H * devicePixelRatio;
    }
    const g = cv.getContext('2d');
    g.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
    g.clearRect(0, 0, W, H);
    // The canvas is a panel: draw the map inset, with the gradient scale under it.
    const P = 12;
    g.translate(P, P);
    const M = W - 2 * P;
    const r = 8;
    g.save();
    g.beginPath();
    g.roundRect(0, 0, M, M, r);
    g.clip();
    g.fillStyle = '#101010';
    g.fillRect(0, 0, M, M);
    if (!miniPatch) {
        g.fillStyle = '#8d877d';
        g.font = '11px "IBM Plex Mono", monospace';
        g.fillText(installed.terrain ? 'loading terrain\u2026' : 'run build_terrain.py', 12, 22);
        g.fillText(installed.terrain ? '' : 'for the elevation map', 12, 38);
        g.restore();
        return;
    }
    g.imageSmoothingEnabled = true;
    g.imageSmoothingQuality = 'high';
    g.drawImage(miniPatch.img, 0, 0, M, M);
    const kmPerPx = 2 * miniPatch.half / M;
    const dn = (v.lat - miniPatch.lat) * Math.PI / 180 * R_KM;
    const de = (v.lon - miniPatch.lon) * Math.PI / 180 * R_KM * Math.cos(rad(miniPatch.lat));
    const x = Math.max(6, Math.min(M - 6, M / 2 + de / kmPerPx));
    const y = Math.max(6, Math.min(M - 6, M / 2 - dn / kmPerPx));
    // View cone, then the "you are here" dot.
    const a = rad(v.yaw);
    const cone = g.createRadialGradient(x, y, 0, x, y, 46);
    cone.addColorStop(0, 'rgba(255,255,255,0.45)');
    cone.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = cone;
    g.beginPath();
    g.moveTo(x, y);
    g.arc(x, y, 46, a - Math.PI / 2 - 0.5, a - Math.PI / 2 + 0.5);
    g.closePath();
    g.fill();
    g.fillStyle = '#ffffff';
    g.strokeStyle = 'rgba(0,0,0,0.6)';
    g.lineWidth = 2;
    g.beginPath();
    g.arc(x, y, 5, 0, Math.PI * 2);
    g.fill();
    g.stroke();
    // Scale bar.
    const barKm = miniPatch.half >= 5 ? 2 : 1;
    g.fillStyle = 'rgba(0,0,0,0.45)';
    g.fillRect(8, M - 26, barKm / kmPerPx + 44, 18);
    g.fillStyle = '#ffffff';
    g.fillRect(12, M - 15, barKm / kmPerPx, 2);
    g.font = '600 10px "IBM Plex Mono", monospace';
    g.fillText(`${barKm} km`, 16 + barKm / kmPerPx, M - 11);
    g.restore();
    // Gradient scale under the map: the same colours as the ground in Elevation view.
    const grad = g.createLinearGradient(0, 0, M, 0);
    MINI_COLORS.forEach(([t, c]) => grad.addColorStop(t, `rgb(${c.join(',')})`));
    g.fillStyle = grad;
    g.beginPath();
    g.roundRect(0, M + 10, M, 6, 3);
    g.fill();
    g.fillStyle = '#a39e95';
    g.font = '10px "IBM Plex Mono", monospace';
    const lo = `${Math.round(miniPatch.lo * 1000)} m`;
    const hi = `${miniPatch.hi >= 0 ? '+' : ''}${Math.round(miniPatch.hi * 1000)} m`;
    g.textAlign = 'left';
    g.fillText(lo, 0, M + 32);
    g.textAlign = 'center';
    g.fillText('elevation', M / 2, M + 32);
    g.textAlign = 'right';
    g.fillText(hi, M, M + 32);
    g.textAlign = 'left';
}

// ================= Globe extras: day/night, grid, quick views, 2D map =================
$('daynight').onchange = () => {
    dayNight = $('daynight').checked;
    renderSelected();
    if (!currentSample()) {
        sunLight.intensity = dayNight ? 3 : 0;
        ambient.intensity = dayNight ? 0.1 : 1.7;
    }
    if (map2d) {
        drawMap2d();
    }
};
$('grid-toggle').onchange = () => {
    graticule.visible = $('grid-toggle').checked;
    if (map2d) {
        drawMap2d();
    }
};
$('go-near').onclick = () => flyTo(upAt(0, 0).multiplyScalar(2.6), new T.Vector3());
$('go-far').onclick = () => flyTo(upAt(0, 180).multiplyScalar(2.6), new T.Vector3());
$('go-all').onclick = () => fitAll();
$('go-south').onclick = () => flyTo(upAt(-72, 0).multiplyScalar(2.2), new T.Vector3());

function setDim(is2d) {
    map2d = is2d;
    $('dim-2d').classList.toggle('active', is2d);
    $('dim-3d').classList.toggle('active', !is2d);
    setMode('globe');
    if (is2d) {
        drawMap2d();
    }
}

$('dim-2d').onclick = () => setDim(true);
$('dim-3d').onclick = () => setDim(false);

const mapCanvas = $('map2d');
let mapRect = {x: 0, y: 0, w: 1, h: 1};

function mapImage() {
    if (globeMap === 'elev') {
        return elevMaterial.map?.image;
    }
    if (moon.material === divMaterial) {
        return divMaterial.map?.image;
    }
    if (globeMap === 'temp') {
        return tempCanvas;
    }
    return photoMaterial.map?.image;
}

function drawMap2d() {
    const W = view.clientWidth;
    const H = view.clientHeight;
    const dpr = devicePixelRatio;
    mapCanvas.width = W * dpr;
    mapCanvas.height = H * dpr;
    const ctx = mapCanvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    // Fit a 2:1 map between the side panels.
    const left = W > 1100 ? 340 : 20;
    const right = W > 1100 ? 350 : 20;
    const availW = W - left - right;
    const availH = H - 130 - 100;
    const w = Math.min(availW, availH * 2);
    const h = w / 2;
    mapRect = {x: left + (availW - w) / 2, y: 130 + (availH - h) / 2, w, h};
    const img = mapImage();
    ctx.fillStyle = '#111';
    ctx.fillRect(mapRect.x, mapRect.y, w, h);
    if (img) {
        ctx.drawImage(img, mapRect.x, mapRect.y, w, h);
    }
    if (dayNight && currentSample()) {
        // Night side: where the Sun is below the local horizon, with a soft terminator.
        const shade = document.createElement('canvas');
        shade.width = 360;
        shade.height = 180;
        const sctx = shade.getContext('2d');
        const img2 = sctx.createImageData(360, 180);
        for (let y = 0; y < 180; y++) {
            for (let x = 0; x < 360; x++) {
                const d = upAt(89.5 - y, x - 179.5).dot(lastSunM);
                img2.data[(y * 360 + x) * 4 + 3] = Math.round(150 * Math.min(1, Math.max(0, (0.05 - d) / 0.1)));
            }
        }
        sctx.putImageData(img2, 0, 0);
        ctx.imageSmoothingEnabled = true;
        ctx.drawImage(shade, mapRect.x, mapRect.y, w, h);
    }
    if (graticule.visible) {
        ctx.strokeStyle = 'rgba(231, 234, 239, 0.14)';
        ctx.fillStyle = 'rgba(159, 233, 214, 0.8)';
        ctx.font = '11px "Geist Mono", monospace';
        ctx.lineWidth = 1;
        for (let lon = -180; lon <= 180; lon += 30) {
            const p = toMap(0, lon);
            ctx.beginPath();
            ctx.moveTo(p.x, mapRect.y);
            ctx.lineTo(p.x, mapRect.y + h);
            ctx.stroke();
            if (lon > -180 && lon < 180) {
                ctx.fillText(lon === 0 ? '0\u00b0' : `${Math.abs(lon)}\u00b0${lon < 0 ? 'W' : 'E'}`, p.x + 3, mapRect.y + h - 4);
            }
        }
        for (let lat = -60; lat <= 60; lat += 30) {
            const p = toMap(lat, -180);
            ctx.beginPath();
            ctx.moveTo(mapRect.x, p.y);
            ctx.lineTo(mapRect.x + w, p.y);
            ctx.stroke();
            ctx.fillText(lat === 0 ? '0\u00b0' : `${Math.abs(lat)}\u00b0${lat < 0 ? 'S' : 'N'}`, mapRect.x + 4, p.y - 3);
        }
    }
    // Good zones and sites.
    for (const c of candidates) {
        const p = toMap(c.lat, c.lon);
        if (c.result) {
            const sc = scoreOf(c);
            const r = 8 + sc / 4;
            const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r);
            g.addColorStop(0, `rgba(79, 227, 193, ${0.25 + sc / 200})`);
            g.addColorStop(1, 'rgba(79, 227, 193, 0)');
            ctx.fillStyle = g;
            ctx.beginPath();
            ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.fillStyle = c.id === selectedId ? '#ffffff' : '#c3cad5';
        ctx.beginPath();
        ctx.arc(p.x, p.y, c.id === selectedId ? 4 : 3, 0, Math.PI * 2);
        ctx.fill();
        ctx.font = '12px "Geist", sans-serif';
        ctx.fillText(c.name, p.x + 7, p.y - 6);
    }
    ctx.strokeStyle = 'rgba(255,255,255,0.15)';
    ctx.strokeRect(mapRect.x, mapRect.y, w, h);
}

function toMap(lat, lon) {
    return {x: mapRect.x + (lon + 180) / 360 * mapRect.w, y: mapRect.y + (90 - lat) / 180 * mapRect.h};
}

function fromMap(x, y) {
    const lon = (x - mapRect.x) / mapRect.w * 360 - 180;
    const lat = 90 - (y - mapRect.y) / mapRect.h * 180;
    if (lon < -180 || lon > 180 || lat < -90 || lat > 90) {
        return null;
    }
    return {lat, lon};
}

mapCanvas.addEventListener('pointermove', e => {
    const r = mapCanvas.getBoundingClientRect();
    const g = fromMap(e.clientX - r.left, e.clientY - r.top);
    if (!g) {
        hideTip();
        return;
    }
    const near = nearestSite(g.lat, g.lon, 3);
    const el = elevationAt(g.lat, g.lon);
    showTip(e.clientX - r.left, e.clientY - r.top, near ? `${near.name} \u00b7 score ${scoreOf(near)}` : `${fmtLat(g.lat)}, ${fmtLon(g.lon)}`,
        (el !== null ? `Elevation ${el.toFixed(2)} km \u00b7 ` : '') + 'click to choose');
});
mapCanvas.addEventListener('pointerleave', hideTip);
mapCanvas.addEventListener('click', e => {
    const r = mapCanvas.getBoundingClientRect();
    const g = fromMap(e.clientX - r.left, e.clientY - r.top);
    if (!g) {
        return;
    }
    const name = `Site ${g.lat.toFixed(2)}, ${g.lon.toFixed(2)}`;
    $('name').value = name;
    writeCoords(g.lat, g.lon);
    nextSurface = {lat: g.lat, lon: g.lon, name, elevation: true};
    setMode('surface');
});

function nearestSite(lat, lon, maxDeg) {
    let best = null;
    let bestD = maxDeg;
    for (const c of candidates) {
        if (!c.result) {
            continue;
        }
        const d = Math.acos(Math.min(1, upAt(lat, lon).dot(upAt(c.lat, c.lon)))) * 180 / Math.PI;
        if (d < bestD) {
            bestD = d;
            best = c;
        }
    }
    return best;
}

// ================= Glowing zones: analyzed sites, brighter = better score =================
const zoneGroup = new T.Group();
globe.add(zoneGroup);

let spZones = [];

function updateZones() {
    zoneGroup.clear();
    // South-pole sites from the NASA 5 m data: small glows, brighter = better score.
    for (const z of spZones) {
        const g = glow('rgba(79,227,193,0.95)', 0.02 + 0.05 * z.score / 100);
        g.position.copy(upAt(z.lat, z.lon).multiplyScalar(1.004));
        g.material.depthTest = true;
        g.userData.base = 0.3 + 0.6 * z.score / 100;
        zoneGroup.add(g);
    }
    for (const c of candidates) {
        if (!c.result) {
            continue;
        }
        const sc = scoreOf(c);
        const z = glow('rgba(79,227,193,0.95)', 0.06 + 0.3 * sc / 100);
        z.position.copy(upAt(c.lat, c.lon).multiplyScalar(1.006));
        z.material.depthTest = true;
        z.userData.base = 0.35 + 0.5 * sc / 100;
        zoneGroup.add(z);
    }
}

function pulseZones(now) {
    zoneGroup.children.forEach((z, i) => {
        z.material.opacity = z.userData.base * (0.75 + 0.25 * Math.sin(now / 650 + i * 1.7));
    });
}

// ================= Sky chart: Sun and Earth paths seen from the site =================
function drawSky(cv, c, s) {
    if (!cv || cv.offsetParent === null) {
        return;
    }
    const W = cv.clientWidth;
    const H = cv.clientHeight;
    const dpr = devicePixelRatio;
    cv.width = W * dpr;
    cv.height = H * dpr;
    const ctx = cv.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    if (!c?.result) {
        ctx.fillStyle = '#5b6676';
        ctx.font = '12px "Geist", sans-serif';
        ctx.fillText('Analyze a site to see its sky.', 12, 22);
        return;
    }
    const smp = c.result.samples;
    const maxEl = Math.max(10, ...smp.map(x => Math.max(x.sun_el, x.earth_el))) + 5;
    const minEl = -10;
    const pad = {l: 30, r: 8, t: 10, b: 18};
    const X = az => pad.l + (az / 360) * (W - pad.l - pad.r);
    const Y = el => pad.t + (1 - (el - minEl) / (maxEl - minEl)) * (H - pad.t - pad.b);
    ctx.fillStyle = 'rgba(255,255,255,0.05)';
    ctx.fillRect(pad.l, Y(0), W - pad.l - pad.r, Y(minEl) - Y(0));
    ctx.strokeStyle = 'rgba(255,255,255,0.18)';
    ctx.beginPath();
    ctx.moveTo(pad.l, Y(0));
    ctx.lineTo(W - pad.r, Y(0));
    ctx.stroke();
    ctx.fillStyle = '#5b6676';
    ctx.font = '10px "Geist Mono", monospace';
    [['N', 0], ['E', 90], ['S', 180], ['W', 270], ['N', 360]].forEach(([t, az]) => ctx.fillText(t, X(az) - 3, H - 4));
    const step = maxEl > 40 ? 30 : maxEl > 20 ? 10 : 5;
    for (let el = 0; el <= maxEl; el += step) {
        ctx.fillText(`${el}\u00b0`, 2, Y(el) + 3);
    }
    const path = (azKey, elKey, color) => {
        ctx.strokeStyle = color;
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        let prev = null;
        for (const x of smp) {
            const px = X(x[azKey]);
            const py = Y(x[elKey]);
            if (prev === null || Math.abs(x[azKey] - prev) > 180) {
                ctx.moveTo(px, py);
            } else {
                ctx.lineTo(px, py);
            }
            prev = x[azKey];
        }
        ctx.stroke();
        ctx.setLineDash([]);
    };
    path('sun_az', 'sun_el', 'rgba(255,181,71,0.75)');
    path('earth_az', 'earth_el', 'rgba(78,168,255,0.75)');
    if (s) {
        const dot = (az, el, color, label) => {
            ctx.fillStyle = color;
            ctx.beginPath();
            ctx.arc(X(az), Y(el), 5, 0, Math.PI * 2);
            ctx.fill();
            ctx.font = '11px "Geist", sans-serif';
            ctx.fillText(label, X(az) + 7, Y(el) - 6);
        };
        dot(s.sun_az, s.sun_el, '#ffb547', 'Sun');
        dot(s.earth_az, s.earth_el, '#4ea8ff', 'Earth');
    }
}

// ================= Timeline page =================
function renderTimelinePage() {
    const box = $('tl-rows');
    if (!box) {
        return;
    }
    box.innerHTML = '';
    for (const c of ranked()) {
        const row = document.createElement('div');
        row.className = 'tl-row' + (c.id === selectedId ? ' sel' : '');
        row.dataset.id = c.id;
        row.innerHTML = `<div><b>${escapeHtml(c.name)}</b><small class="mono">${fmtLat(c.lat)}, ${fmtLon(c.lon)}</small></div><canvas></canvas><span class="s">${scoreOf(c)}</span>`;
        row.onclick = e => {
            const cv = row.querySelector('canvas');
            const r = cv.getBoundingClientRect();
            if (e.target === cv) {
                $('timeline').value = Math.floor((e.clientX - r.left) / r.width * c.result.samples.length);
            }
            selectSite(c.id);
            renderTimelinePage();
        };
        box.append(row);
    }
    const c = selected();
    $('tl-sky-title').textContent = c ? `Sky from ${c.name}` : 'Sky from the site';
    requestAnimationFrame(() => {
        for (const row of box.querySelectorAll('.tl-row')) {
            drawBars(row.querySelector('canvas'), candidates.find(k => k.id === Number(row.dataset.id)));
        }
        drawSky($('skychart-big'), selected(), currentSample());
    });
}

// ================= Past missions =================
// Landing dates, surface stay and samples: NASA KSC Apollo flight summary; NSSDCA landing table.
const APOLLO = [
    {n: 11, id: 'apollo-11', site: 'Tranquility Base', region: 'Sea of Tranquility', date: '20 Jul 1969', hours: 21.6, kg: 21.55},
    {n: 12, id: 'apollo-12', site: 'Ocean of Storms', region: 'Near Surveyor 3', date: '19 Nov 1969', hours: 31.5, kg: 34},
    {n: 14, id: 'apollo-14', site: 'Fra Mauro', region: 'Fra Mauro highlands', date: '5 Feb 1971', hours: 33.5, kg: 42},
    {n: 15, id: 'apollo-15', site: 'Hadley-Apennine', region: 'Hadley Rille, Apennine Mountains', date: '30 Jul 1971', hours: 66.9, kg: 76.7},
    {n: 16, id: 'apollo-16', site: 'Descartes', region: 'Descartes Highlands', date: '21 Apr 1972', hours: 71, kg: 95},
    {n: 17, id: 'apollo-17', site: 'Taurus-Littrow', region: 'Taurus-Littrow valley', date: '11 Dec 1972', hours: 75, kg: 110.4},
];

function renderPast() {
    const box = $('apollo-cards');
    if (box.childElementCount) {
        return;
    }
    for (const a of APOLLO) {
        const p = presets.find(x => x.id === a.id);
        const card = document.createElement('div');
        card.className = 'apollo';
        card.title = 'Look around this landing site';
        card.innerHTML = `<span class="no-big">${a.n}</span>
            <div><b>${a.site}</b><small>${a.region} \u00b7 ${a.date}</small></div>
            <div class="stats">on surface <strong>${a.hours} h</strong><br>samples <strong>${a.kg} kg</strong></div>`;
        card.onclick = () => {
            if (p) {
                complete('surface');
                collect('apollo', p.name, 3, 'apollo3');
                nextSurface = {lat: p.lat, lon: p.lon, name: p.name};
                setMode('surface');
            }
        };
        box.append(card);
    }
}

$('past-show').onclick = () => {
    setMode('globe');
    flyTo(upAt(5, 10).multiplyScalar(3.2), new T.Vector3());
};
$('past-compare').onclick = async () => {
    for (const id of ['apollo-11', 'shackleton', 'malapert']) {
        const p = presets.find(x => x.id === id);
        if (p && !candidates.some(c => c.name === p.name)) {
            addCandidate(p.name, p.lat, p.lon);
        }
    }
    setMode('rank');
    for (const c of candidates.filter(k => !k.result)) {
        await analyzeOne(c);
    }
    setupTimeline();
    renderRank();
    checkAchievements();
};

// ================= Site card buttons, speed, surface quick jumps =================
$('act-look').onclick = () => setMode('surface');
$('act-heat').onclick = () => setMode('street');
const SPEEDS = [1, 3, 6, 12, 24];
$('speed').oninput = () => {
    speedHours = SPEEDS[Number($('speed').value)];
    $('speed-v').textContent = `${speedHours} h/s`;
};
$('sf-back').onclick = () => setMode('globe');
$('sf-add').onclick = async () => {
    if (!surfacePos) {
        return;
    }
    const c = addCandidate(surfacePos.label, surfacePos.openLat, surfacePos.openLon);
    complete('add-site');
    setStatus(`${surfacePos.label} added to the ranking.`);
    await analyzeOne(c);
    setupTimeline();
    renderRank();
    checkAchievements();
};
for (const b of document.querySelectorAll('[data-jump]')) {
    b.onclick = () => {
        const p = presets.find(x => x.id === b.dataset.jump);
        if (p) {
            openSurfaceAt(p.lat, p.lon, p.name, surfaceElevation);
        }
    };
}
$('sf-exag').oninput = () => {
    const x = Number($('sf-exag').value);
    setExaggeration(x);
    $('sf-exag-v').textContent = `${x.toFixed(1)}\u00d7`;
};

// ================= South pole page hooks =================
initSouthPole({
    window: () => ({start: $('start').value, days: $('days').value, need: $('need').value}),
    timeIndex: () => Number($('timeline').value),
    lookAround: (lat, lon, name) => {
        nextSurface = {lat, lon, name, elevation: true};
        setMode('surface');
    },
    addSite: async (name, lat, lon) => {
        const c = addCandidate(name, lat, lon);
        complete('add-site');
        await analyzeOne(c);
        setupTimeline();
        renderRank();
        checkAchievements();
        setStatus(`${name} added to the ranking.`);
    },
    showOnMoon: (lat, lon) => {
        setMode('globe');
        flyTo(upAt(lat, lon).multiplyScalar(2.3), new T.Vector3());
    },
    onResults: list => {
        spZones = list;
        updateZones();
    },
});


// ================= Search: Ctrl/Cmd + K palette and the home "ask" box =================
function parseCoords(q) {
    // "12.5, -30", "12.5N 30W", "-89.44, -137.1"
    const m = q.trim().match(/^(-?\d+(?:\.\d+)?)\s*([NS])?\s*[, ]\s*(-?\d+(?:\.\d+)?)\s*([EW])?$/i);
    if (!m) {
        return null;
    }
    let lat = Number(m[1]) * (m[2] && m[2].toUpperCase() === 'S' ? -1 : 1);
    let lon = Number(m[3]) * (m[4] && m[4].toUpperCase() === 'W' ? -1 : 1);
    if (Math.abs(lat) > 90 || Math.abs(lon) > 360) {
        return null;
    }
    lon = ((lon + 540) % 360) - 180;
    return {lat, lon};
}

function goToCoords(lat, lon) {
    const name = `Site ${lat.toFixed(2)}, ${lon.toFixed(2)}`;
    $('name').value = name;
    writeCoords(lat, lon);
    if (map2d) {
        setDim(false);
    }
    setMode('globe');
    flyTo(upAt(lat, lon).multiplyScalar(2.4), new T.Vector3());
    setTimeout(() => showSpotPrompt(view.clientWidth / 2, view.clientHeight / 2, lat, lon, name), 900);
}

function pickPreset(p) {
    $('name').value = p.name;
    writeCoords(p.lat, p.lon);
    let c = candidates.find(k => k.name === p.name);
    setMode('globe');
    if (!c) {
        c = addCandidate(p.name, p.lat, p.lon);
        analyzeOne(c).then(() => {
            setupTimeline();
            renderRank();
            selectSite(c.id);
            checkAchievements();
        });
    } else {
        selectSite(c.id);
    }
    flyTo(upAt(p.lat, p.lon).multiplyScalar(2.6), new T.Vector3());
}

function searchItems(q) {
    const query = q.trim().toLowerCase();
    const out = [];
    const coords = parseCoords(q);
    if (coords) {
        out.push({group: 'Coordinates', icon: '\u2316', label: `Go to ${fmtLat(coords.lat)}, ${fmtLon(coords.lon)}`, sub: 'look around or add it', run: () => goToCoords(coords.lat, coords.lon)});
    }
    const intents = [
        {k: ['best', 'south pole', 'where should', 'land', 'safe', 'optimal'], label: 'Best landing sites near the south pole', sub: 'NASA 5 m data, real horizons', run: () => {
            setMode('southpole');
            setTimeout(() => {
                const id = topSpId();
                if (id) {
                    selectSp(id);
                }
            }, 2500);
        }},
        {k: ['hot', 'hottest', 'heat', 'max', 'warm'], label: 'Hottest temperatures (Day max map)', sub: 'NASA Diviner', run: () => {
            setMode('globe');
            setGlobeMap('max');
            showFact('moon');
        }},
        {k: ['cold', 'coldest', 'night', 'min', 'freez', 'ice'], label: 'Coldest temperatures (Night min map)', sub: 'NASA Diviner', run: () => {
            setMode('globe');
            setGlobeMap('min');
        }},
        {k: ['temperature', 'temp', 'thermal', 'diviner', 'how hot', 'how cold'], label: 'Temperature right now, measured', sub: 'NASA Diviner, follows the time slider', run: () => {
            setMode('globe');
            setGlobeMap('temp');
            showFact('moon');
        }},
        {k: ['composite', 'rgb'], label: 'Diviner thermal composite', sub: 'NASA image layer', run: () => {
            setMode('globe');
            setGlobeMap('comp');
        }},
        {k: ['elevation', 'height', 'altitude'], label: 'Elevation map', sub: 'NASA LOLA', run: () => {
            setMode('globe');
            setGlobeMap('elev');
        }},
        {k: ['2d', 'flat map', 'map'], label: '2D map', sub: 'whole Moon at once', run: () => setDim(true)},
        {k: ['3d', 'globe'], label: '3D globe', sub: '', run: () => setDim(false)},
        {k: ['earth', 'street view', 'google'], label: 'Earth: Street View and EPIC photo', sub: '', run: () => openEarth(28.5729, -80.649, 'Kennedy Space Center')},
        {k: ['sun', 'sdo', 'solar'], label: 'The Sun right now (NASA SDO)', sub: '', run: () => openSun()},
    ];
    const pages = [
        ['globe', 'Moon', 'the 3D Moon'], ['southpole', 'South pole', 'NASA 5 m sites'], ['surface', 'Surface', 'stand on the Moon'],
        ['street', 'Heatmaps', 'elevation, slope, temperature'], ['rank', 'Compare', 'sites side by side'], ['timeline', 'Timeline', 'hour by hour'],
        ['past', 'Past missions', 'Apollo landings'], ['missions', 'Missions', 'XP and quiz'],
    ];
    const hit = (text) => !query || text.toLowerCase().includes(query) || query.split(/\s+/).every(w => text.toLowerCase().includes(w));
    for (const it of intents) {
        if (query && it.k.some(k => query.includes(k) || k.startsWith(query))) {
            out.push({group: 'Answers', icon: '\u2192', ...it});
        }
    }
    for (const p of presets) {
        if (hit(`${p.name} ${p.categoryLabel} ${p.agency || ''}`)) {
            out.push({group: 'Known sites', icon: '\u25cf', label: p.name, sub: `${p.categoryLabel}${p.year ? ' \u00b7 ' + p.year : ''}`, run: () => pickPreset(p)});
        }
    }
    for (const s of spSites()) {
        if (query && hit(`${s.label} south pole ${s.kind === 'roi' ? 'nasa region' : 'flat'}`)) {
            out.push({group: 'South pole (NASA 5 m data)', icon: s.kind === 'roi' ? '\u25cb' : '\u25c7', label: s.label, sub: s.score !== undefined ? `score ${s.score}` : `${fmtLat(s.lat)}`, run: () => {
                setMode('southpole');
                setTimeout(() => selectSp(s.id), 300);
            }});
        }
    }
    for (const [id, label, sub] of pages) {
        if (hit(label)) {
            out.push({group: 'Pages', icon: '\u00bb', label, sub, run: () => setMode(id)});
        }
    }
    if (hit('Education') || hit('learn') || hit('quiz') || hit('facts')) {
        out.push({group: 'Pages', icon: '\u00bb', label: 'Education', sub: '3D lab, facts, quiz and leaderboard (opens /learn)', run: () => {
            window.location.href = '/learn';
        }});
    }
    return out.slice(0, 40);
}

let palItems = [];
let palIndex = 0;

function renderPalette() {
    const list = $('pal-list');
    list.innerHTML = '';
    palItems = searchItems($('pal-input').value);
    let group = '';
    palItems.forEach((it, i) => {
        if (it.group !== group) {
            group = it.group;
            const g = document.createElement('li');
            g.className = 'group';
            g.textContent = group;
            list.append(g);
        }
        const li = document.createElement('li');
        li.className = i === palIndex ? 'on' : '';
        const icon = document.createElement('i');
        icon.textContent = it.icon;
        const name = document.createElement('span');
        name.textContent = it.label;
        const sub = document.createElement('small');
        sub.textContent = it.sub || '';
        li.append(icon, name, sub);
        li.onmousemove = () => {
            if (palIndex !== i) {
                palIndex = i;
                renderPalette();
            }
        };
        li.onclick = () => runPalette(i);
        list.append(li);
    });
    if (!palItems.length) {
        const li = document.createElement('li');
        li.className = 'group';
        li.textContent = 'No match. Try a site name, "south pole", "coldest", or coordinates like -89.4, -137.';
        list.append(li);
    }
}

function runPalette(i) {
    const it = palItems[i];
    closePalette();
    if (it) {
        if (!$('home').hidden) {
            leaveHome(mode);
        }
        setTimeout(() => it.run(), 50);
    }
}

function openPalette(text = '') {
    $('palette').hidden = false;
    $('pal-input').value = text;
    palIndex = 0;
    renderPalette();
    setTimeout(() => $('pal-input').focus(), 20);
}

function closePalette() {
    $('palette').hidden = true;
}

$('open-palette').onclick = () => openPalette();
$('pal-input').addEventListener('input', () => {
    palIndex = 0;
    renderPalette();
});
$('pal-input').addEventListener('keydown', e => {
    if (e.key === 'ArrowDown') {
        palIndex = Math.min(palItems.length - 1, palIndex + 1);
        renderPalette();
        e.preventDefault();
    } else if (e.key === 'ArrowUp') {
        palIndex = Math.max(0, palIndex - 1);
        renderPalette();
        e.preventDefault();
    } else if (e.key === 'Enter') {
        runPalette(palIndex);
    } else if (e.key === 'Escape') {
        closePalette();
    }
});
$('palette').addEventListener('click', e => {
    if (e.target === $('palette')) {
        closePalette();
    }
});
window.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        if ($('palette').hidden) {
            openPalette();
        } else {
            closePalette();
        }
    }
});

// Home ask box: run the best match for what was typed.
$('ask-form').addEventListener('submit', e => {
    e.preventDefault();
    const q = $('ask').value.trim();
    if (!q) {
        return;
    }
    const items = searchItems(q);
    if (items.length) {
        palItems = items;
        runPalette(0);
    } else {
        openPalette(q);
    }
});
for (const b of document.querySelectorAll('[data-ask]')) {
    b.onclick = () => {
        $('ask').value = b.dataset.ask;
        $('ask-form').requestSubmit();
    };
}

// ================= Home =================
document.body.classList.add('at-home');

function homeView() {
    const W = view.clientWidth;
    const H = view.clientHeight;
    camera.setViewOffset(W, H, -W * 0.2, 0, W, H);
    controls.autoRotate = true;
    controls.autoRotateSpeed = 0.35;
}

function leaveHome(target) {
    camera.clearViewOffset();
    controls.autoRotate = false;
    const home = $('home');
    home.classList.add('leaving');
    document.body.classList.remove('at-home');
    setTimeout(() => {
        home.hidden = true;
        resize();
        setMode(target);
    }, 450);
}

function showHome() {
    setMode('globe');
    homeView();
    const home = $('home');
    home.hidden = false;
    requestAnimationFrame(() => {
        home.classList.remove('leaving');
        document.body.classList.add('at-home');
    });
}

$('home-start').onclick = () => leaveHome('globe');
$('home-drop').onclick = () => {
    leaveHome('surface');
};
for (const b of document.querySelectorAll('[data-go]')) {
    b.onclick = () => leaveHome(b.dataset.go);
}
$('brand').onclick = showHome;

// ================= Start =================
camera.position.set(1, 2, 12);
initGame();
loadSites().then(() => {
    for (const id of ['apollo-11', 'apollo-15', 'change-4', 'chandrayaan-3', 'shackleton']) {
        const p = presets.find(x => x.id === id);
        if (p) {
            addCandidate(p.name, p.lat, p.lon);
        }
    }
    if (!candidates.length) {
        addCandidate('Apollo 11', 0.67416, 23.47314);
    }
    selectedId = candidates[0].id;
    writeCoords(candidates[0].lat, candidates[0].lon);
    $('name').value = candidates[0].name;
    renderList();
    rebuildMarkers();
    resize();
    setMode('globe');
    if (document.body.classList.contains('at-home')) {
        homeView();
        flyTo(upAt(8, 25).multiplyScalar(3.1), new T.Vector3());
    }
    $('analyze').click();
    // Deep link from the education page: /classic?view=surface&lat=..&lon=..&name=.. opens the street view there.
    const deep = new URLSearchParams(window.location.search);
    if (deep.get('view') === 'surface') {
        const lat = Number(deep.get('lat'));
        const lon = Number(deep.get('lon'));
        if (Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 360) {
            nextSurface = {lat, lon, name: (deep.get('name') || 'Selected site').slice(0, 60), elevation: true};
            leaveHome('surface');
        }
    }
});


// ================= Surface tools: measure, real horizon, snapshot =================
let tracksOn = true;

function setSurfaceTool(name) {
    setTool(name);
    for (const b of document.querySelectorAll('#sf-tools [data-tool]')) {
        b.classList.toggle('active', b.dataset.tool === name);
    }
    $('hint').textContent = name === 'measure'
        ? 'click two points on the ground · Esc clears'
        : 'drag look around · click walk there · WASD move · scroll zoom';
}

function showMeasure(m) {
    const out = $('measure-out');
    if (!m) {
        out.hidden = true;
        return;
    }
    out.hidden = false;
    if (m.pending) {
        out.textContent = 'First point set. Click a second point.';
        return;
    }
    const dist = m.groundM < 1000 ? `${m.groundM.toFixed(0)} m` : `${(m.groundM / 1000).toFixed(2)} km`;
    out.replaceChildren(
        ...[['Ground distance', dist], ['Height change', `${m.dh >= 0 ? '+' : ''}${m.dh.toFixed(0)} m`], ['Mean slope', `${m.grade.toFixed(1)}°`], ['Bearing', `${m.bearing.toFixed(0)}° ${compass(m.bearing)}`]]
            .map(([k, v]) => {
                const d = document.createElement('div');
                const a = document.createElement('span');
                const b = document.createElement('b');
                a.textContent = k;
                b.textContent = v;
                d.append(a, b);
                return d;
            }));
}

for (const b of document.querySelectorAll('#sf-tools [data-tool]')) {
    b.onclick = () => setSurfaceTool(b.dataset.tool);
}

$('sf-tracks').onclick = () => {
    tracksOn = !tracksOn;
    $('sf-tracks').classList.toggle('active', tracksOn);
    setTracksVisible(tracksOn);
};

$('sf-snap').onclick = () => {
    const url = snapshot();
    if (!url) {
        return;
    }
    const a = document.createElement('a');
    const name = (surfacePos?.label || 'surface').replace(/[^\w-]+/g, '-').toLowerCase();
    a.href = url;
    a.download = `lunar-${name}-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '')}.png`;
    a.click();
    setStatus('Snapshot saved.');
};

// ---- Real horizon (the team's terrain service and horizonProfile, from src/terrain/polar-grid.js) ----
/** In the surface view, once the real horizon is loaded: is the Sun (or Earth) clear of the terrain? Else null. */
function terrainClear(sample, key) {
    if (mode !== 'surface' || !hz.panel || !sample || !surfacePos || hz.lat !== surfacePos.openLat || hz.lon !== surfacePos.openLon) {
        return null;
    }
    const profile = key === 'sun' ? hz.panel : hz.antenna;
    return sample[key + '_el'] > hz.grid.horizonAt(profile, sample[key + '_az']);
}

const hz = {lat: null, lon: null, patch: null, eye: null, panel: null, antenna: null, grid: null, error: '', open: false, full: false};

async function loadHorizon(lat, lon) {
    hz.lat = lat;
    hz.lon = lon;
    hz.patch = null;
    hz.error = '';
    try {
        hz.grid = hz.grid || await import('/src/terrain/polar-grid.js');
        const r = await fetch(`/api/terrain/polar?lat=${lat}&lon=${lon}&source=auto`);
        if (!r.ok) {
            const j = await r.json().catch(() => ({}));
            throw new Error(j.error || 'No terrain data here.');
        }
        const patch = hz.grid.decodePatch(await r.arrayBuffer());
        if (hz.lat !== lat || hz.lon !== lon) {
            return;
        }
        hz.patch = patch;
        hz.panel = hz.grid.horizonProfile(patch, Number($('panel').value) || 1.5);
        hz.antenna = hz.grid.horizonProfile(patch, Number($('antenna').value) || 2);
        $('hz-source').textContent = patch.sourceLabel ? `NASA LOLA, ${patch.sourceLabel}` : 'NASA LOLA';
        renderWeek();
        drawStrip();
        renderSurfaceReadout();
    } catch (e) {
        hz.error = e.message || 'The real horizon needs the team app files (src/) and terrain data.';
    }
    drawHorizon();
}

function hzStats() {
    const c = surfaceSpot?.result;
    if (!c || !hz.panel) {
        return null;
    }
    const step = c.window.step_minutes / 60;
    const at = (profile, az) => hz.grid.horizonAt(profile, az);
    const runs = flags => {
        let best = 0;
        let run = 0;
        for (const f of flags) {
            run = f ? run + 1 : 0;
            best = Math.max(best, run);
        }
        return best * step;
    };
    const sunReal = c.samples.map(x => x.sun_el > at(hz.panel, x.sun_az));
    const earthReal = c.samples.map(x => x.earth_el > at(hz.antenna, x.earth_az));
    const n = c.samples.length;
    return {
        sunPct: (100 * sunReal.filter(Boolean).length) / n,
        sunPctSmooth: (100 * c.samples.filter(x => x.sun_ok).length) / n,
        sunRun: runs(sunReal),
        earthPct: (100 * earthReal.filter(Boolean).length) / n,
        earthPctSmooth: (100 * c.samples.filter(x => x.earth_ok).length) / n,
        sunReal,
        earthReal,
    };
}

function drawHorizon() {
    if (!hz.open) {
        return;
    }
    const cv = $('hz-chart');
    const W = cv.clientWidth;
    const H = cv.clientHeight;
    cv.width = W * devicePixelRatio;
    cv.height = H * devicePixelRatio;
    const g = cv.getContext('2d');
    g.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
    g.clearRect(0, 0, W, H);
    const note = $('hz-note');
    const stats = $('hz-stats');
    stats.replaceChildren();
    if (!hz.panel) {
        g.fillStyle = '#a39e95';
        g.font = '13px "IBM Plex Mono", monospace';
        g.fillText(hz.error || 'Loading terrain around this spot…', 16, 28);
        note.textContent = '';
        return;
    }
    const c = surfaceSpot?.result;
    const samples = c ? c.samples : [];
    const L = 44;
    const R = 12;
    const T = 10;
    const B = 22;
    const pw = W - L - R;
    const ph = H - T - B;
    let top = 10;
    let bottom = -4;
    for (const v of hz.panel) {
        top = Math.max(top, v + 3);
        bottom = Math.min(bottom, v - 2);
    }
    if (hz.full) {
        for (const x of samples) {
            top = Math.max(top, x.sun_el + 3, x.earth_el + 3);
        }
        top = Math.min(90, top);
    }
    const X = az => L + (az / 360) * pw;
    const Y = el => T + ((top - el) / (top - bottom)) * ph;
    // Grid.
    g.font = '10px "IBM Plex Mono", monospace';
    g.strokeStyle = 'rgba(255,255,255,0.07)';
    g.fillStyle = '#6b6760';
    const stepEl = top - bottom > 40 ? 15 : top - bottom > 16 ? 5 : 2;
    for (let e = Math.ceil(bottom / stepEl) * stepEl; e <= top; e += stepEl) {
        g.beginPath();
        g.moveTo(L, Y(e));
        g.lineTo(L + pw, Y(e));
        g.stroke();
        g.fillText(`${e}°`, 8, Y(e) + 3);
    }
    ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW', 'N'].forEach((name, i) => {
        const x = X(i * 45);
        g.beginPath();
        g.moveTo(x, T);
        g.lineTo(x, T + ph);
        g.stroke();
        g.fillText(name, x - 4, H - 6);
    });
    // Level horizon (0 deg) and the real terrain.
    g.strokeStyle = 'rgba(255,255,255,0.25)';
    g.setLineDash([4, 4]);
    g.beginPath();
    g.moveTo(L, Y(0));
    g.lineTo(L + pw, Y(0));
    g.stroke();
    g.setLineDash([]);
    g.beginPath();
    g.moveTo(L, T + ph);
    const n = hz.panel.length;
    for (let j = 0; j <= n; j++) {
        g.lineTo(X((j / n) * 360), Y(hz.panel[j % n]));
    }
    g.lineTo(L + pw, T + ph);
    g.closePath();
    const fill = g.createLinearGradient(0, T, 0, T + ph);
    fill.addColorStop(0, 'rgba(120,108,92,0.85)');
    fill.addColorStop(1, 'rgba(40,36,32,0.95)');
    g.fillStyle = fill;
    g.fill();
    g.strokeStyle = '#d6b98c';
    g.lineWidth = 1.5;
    g.stroke();
    g.lineWidth = 1;
    // Sun and Earth tracks over the window: bright where they clear the terrain, dim where it hides them.
    const st = hzStats();
    const dots = (key, real, on, off) => {
        samples.forEach((x, i) => {
            const el = x[key + '_el'];
            if (el > top || el < bottom) {
                return;
            }
            g.fillStyle = real && real[i] ? on : off;
            g.beginPath();
            g.arc(X(x[key + '_az']), Y(el), 2.2, 0, Math.PI * 2);
            g.fill();
        });
    };
    dots('earth', st?.earthReal, '#7fb2ff', 'rgba(127,178,255,0.25)');
    dots('sun', st?.sunReal, '#f2b84b', 'rgba(242,184,75,0.25)');
    const now = currentSample();
    if (now) {
        for (const [key, color] of [['earth', '#7fb2ff'], ['sun', '#f2b84b']]) {
            const el = now[key + '_el'];
            if (el <= top && el >= bottom) {
                g.strokeStyle = '#ffffff';
                g.lineWidth = 2;
                g.fillStyle = color;
                g.beginPath();
                g.arc(X(now[key + '_az']), Y(el), 6, 0, Math.PI * 2);
                g.fill();
                g.stroke();
                g.lineWidth = 1;
            }
        }
    }
    if (st) {
        const chip = (label, value, sub) => {
            const d = document.createElement('div');
            const a = document.createElement('span');
            const b = document.createElement('b');
            const s2 = document.createElement('small');
            a.textContent = label;
            b.textContent = value;
            s2.textContent = sub;
            d.append(a, b, s2);
            return d;
        };
        stats.append(
            chip('Sunlit, real terrain', `${st.sunPct.toFixed(0)}%`, `smooth Moon ${st.sunPctSmooth.toFixed(0)}%`),
            chip('Longest sunlit run', `${Math.round(st.sunRun)} h`, `panel ${$('panel').value} m up`),
            chip('Earth in view, real terrain', `${st.earthPct.toFixed(0)}%`, `smooth Moon ${st.earthPctSmooth.toFixed(0)}%`),
        );
    }
    const p = hz.patch;
    note.textContent = `Highest terrain seen from ${$('panel').value} m above the ground in every direction, out to 300 km (720 directions). `
        + `Dots: the Sun and Earth each ${c ? c.window.step_minutes : 60} min over the mission window; dim where terrain hides them. `
        + `Terrain: ${p.sourceLabel || p.dataset}, about ${Math.round(p.pixelM)} m per pixel.`;
}

function setHorizonOpen(open) {
    hz.open = open;
    const panel = $('horizon-panel');
    panel.classList.toggle('open', open);
    panel.setAttribute('aria-hidden', String(!open));
    $('sf-horizon').classList.toggle('active', open);
    if (open) {
        requestAnimationFrame(drawHorizon);
    }
}

$('sf-horizon').onclick = () => setHorizonOpen(!hz.open);
$('hz-close').onclick = () => setHorizonOpen(false);
$('hz-near').onclick = () => {
    hz.full = false;
    $('hz-near').classList.add('active');
    $('hz-full').classList.remove('active');
    drawHorizon();
};
$('hz-full').onclick = () => {
    hz.full = true;
    $('hz-full').classList.add('active');
    $('hz-near').classList.remove('active');
    drawHorizon();
};
$('hz-chart').addEventListener('mousemove', e => {
    if (!hz.panel) {
        return;
    }
    const r = $('hz-chart').getBoundingClientRect();
    const az = Math.max(0, Math.min(360, ((e.clientX - r.left - 44) / (r.width - 56)) * 360));
    showTip(e.clientX, e.clientY, `Azimuth ${az.toFixed(1)}° ${compass(az)}`, `Terrain horizon ${hz.grid.horizonAt(hz.panel, az).toFixed(2)}°`);
});
$('hz-chart').addEventListener('mouseleave', () => hideTip());
new ResizeObserver(() => drawHorizon()).observe($('horizon-panel'));

window.addEventListener('keydown', e => {
    if (mode !== 'surface' || e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.metaKey || e.ctrlKey) {
        return;
    }
    const k = e.key.toLowerCase();
    if (k === 'm') {
        const on = !document.querySelector('#sf-tools [data-tool="measure"]').classList.contains('active');
        setSurfaceTool(on ? 'measure' : 'walk');
    } else if (k === 'h') {
        setHorizonOpen(!hz.open);
    } else if (k === 'p') {
        $('sf-snap').click();
    } else if (k === 'escape') {
        clearMeasure();
        setHorizonOpen(false);
    }
});
