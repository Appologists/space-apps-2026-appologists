import * as T from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {initGame, complete, count, collect, showFact, fillFactCard} from './lunar-game.js';
import {openSurface, updateSky, setLayer, setSunlight, setElevationColors, face as surfaceFace, birdsEye, resizeSurface} from './lunar-surface.js';
import {showStreetView, loadEpic, showSdo} from './lunar-bodies.js';

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
const camera = new T.PerspectiveCamera(40, 1, 0.0003, 3000);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.enablePan = false;
controls.minDistance = 1.15;
controls.maxDistance = 60;
scene.add(new T.AmbientLight(0xffffff, 0.1));
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
    ctx.font = '500 44px Georgia, serif';
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

function showLegend(kind, min, max) {
    if (!kind) {
        $('legend').hidden = true;
        return;
    }
    $('legend').hidden = false;
    const stops = {temp: TEMP_COLORS, elev: BLUE_COLORS, globe: ELEV_COLORS, slope: SLOPE_COLORS}[kind];
    $('legend').querySelector('.bar').style.background = gradientCss(stops);
    $('leg-title').textContent = {temp: 'Surface temperature', elev: 'Elevation', globe: 'Elevation', slope: 'Slope'}[kind];
    const unit = v => (kind === 'temp' ? `${v} K` : kind === 'slope' ? `${v}${DEG}` : `${v.toFixed(1)} km`);
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
const moon = new T.Mesh(new T.SphereGeometry(1, 128, 96), photoMaterial);
globe.add(moon);
texture('/textures/moon.jpg', t => {
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
label('Earth', globeEarth, new T.Vector3(0, 0.7, 0), 1.4, '#8fb8de');
globeEarth.position.set(-3.6, 0.8, 2.6);
globe.add(globeEarth);
const globeSun = new T.Group();
globeSun.add(new T.Mesh(new T.SphereGeometry(0.7, 32, 24), new T.MeshBasicMaterial({color: 0xfff1c4})));
globeSun.add(glow('rgba(255,200,120,0.9)', 5));
label('Sun', globeSun, new T.Vector3(0, 1.15, 0), 1.4, '#e8b465');
globeSun.position.set(6.5, 1.5, -4.5);
globe.add(globeSun);
const sunArrow = new T.ArrowHelper(new T.Vector3(1, 0, 0), new T.Vector3(), 0.55, 0xe8b465, 0.08, 0.05);
const earthArrow = new T.ArrowHelper(new T.Vector3(1, 0, 0), new T.Vector3(), 0.55, 0x8fb8de, 0.08, 0.05);
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
    const lineMat = new T.LineBasicMaterial({color: 0xece8df, transparent: true, opacity: 0.16});
    const eqMat = new T.LineBasicMaterial({color: 0xd97757, transparent: true, opacity: 0.55});
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
        label(text, graticule, upAt(2, lon).multiplyScalar(1.03), 0.32, '#f3c9b7');
    }
    for (let lat = -60; lat <= 60; lat += 30) {
        if (lat !== 0) {
            label(`${Math.abs(lat)}\u00b0${lat < 0 ? 'S' : 'N'}`, graticule, upAt(lat, 2).multiplyScalar(1.03), 0.32, '#f3c9b7');
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
    moon.material = {photo: photoMaterial, elev: elevMaterial, temp: tempMaterial}[kind];
    for (const k of ['photo', 'elev', 'temp']) {
        $('map-' + k).classList.toggle('active', k === kind);
    }
    if (kind === 'temp') {
        complete('heat');
    }
    renderSelected();
}

for (const k of ['photo', 'elev', 'temp']) {
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
    sunPath = make('sun_az', 'sun_el', 0xe8b465);
    earthPath = make('earth_az', 'earth_el', 0x8fb8de);
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
fetch('/textures/moon-elevation-grid.bin').then(r => {
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

function currentSample() {
    const c = selected();
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
        const m = new T.Mesh(new T.SphereGeometry(on ? 0.02 : 0.013, 12, 8), new T.MeshBasicMaterial({color: on ? 0xd97757 : 0xece8df}));
        m.position.copy(upAt(c.lat, c.lon).multiplyScalar(1.003));
        m.userData.id = c.id;
        markerGroup.add(m);
        label(c.name, m, new T.Vector3(0, 0.05, 0), 0.42, on ? '#f3c9b7' : '#ece8df');
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
        fitAll();
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
        c.error = e.message;
        setStatus(`${c.name}: ${e.message}`);
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

function renderRank() {
    const body = $('rank-body');
    body.innerHTML = '';
    ranked().forEach((c, i) => {
        const s = c.result.summary;
        const tr = document.createElement('tr');
        if (i === 0) {
            tr.className = 'top';
        }
        const cells = [
            `${i + 1} <span class="medal">${medal(i)}</span>`,
            `${escapeHtml(c.name)}<br><small>${fmtLat(c.lat)}, ${fmtLon(c.lon)}</small>`,
            `${scoreOf(c)}`,
            `${s.both.longest_h} h`,
            s.both.best_start ? `${fmtTime(s.both.best_start)}<br>to ${fmtTime(s.both.best_end)}` : 'none',
            `${s.sun.total_h} h`,
            `${s.earth.total_h} h`,
            s.energy_tracking_kwh_m2.toFixed(1),
            `${Math.round(s.temp_min_k)} to ${Math.round(s.temp_max_k)}`,
            s.meets_requirement ? '<span class="yes">Yes</span>' : '<span class="no">No</span>',
            '<ul>' + notes(c).map(([k, t]) => `<li class="${k === '+' ? 'yes' : k === '-' ? 'no' : ''}">${escapeHtml(t)}</li>`).join('') + '</ul>',
        ];
        cells.forEach((html, j) => {
            const td = document.createElement('td');
            td.innerHTML = html;
            if (j === 2) {
                td.className = 'big';
            }
            tr.append(td);
        });
        tr.onclick = () => {
            setMode('globe');
            selectSite(c.id);
        };
        body.append(tr);
    });
    const failed = candidates.filter(c => c.error);
    $('rank-note').textContent = 'Sites with the longest unbroken time with both sunlight and a view of Earth rank first.'
        + (failed.length ? ` No data for: ${failed.map(c => c.name).join(', ')}.` : '');
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
    const c = candidates.find(k => k.result);
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
    ctx.fillStyle = '#161614';
    ctx.fillRect(0, 0, w, h);
    const c = selected();
    if (!c?.result) {
        return;
    }
    const s = c.result.samples;
    const bw = w / s.length;
    [['sun_ok', '#e8b465'], ['earth_ok', '#8fb8de'], ['both_ok', '#9cc5a1']].forEach(([key, color], r) => {
        ctx.fillStyle = color;
        s.forEach((x, i) => {
            if (x[key]) {
                ctx.fillRect(i * bw, r * h / 3 + 1, Math.ceil(bw), h / 3 - 2);
            }
        });
    });
    ctx.fillStyle = '#ffffff40';
    s.forEach((x, i) => {
        if (x.t.endsWith('T00:00Z')) {
            ctx.fillRect(i * bw, 0, 1, h);
        }
    });
    ctx.fillStyle = '#d97757';
    ctx.fillRect(Number($('timeline').value) * bw + bw / 2 - devicePixelRatio, 0, 2 * devicePixelRatio, h);
}

$('strip').onclick = e => {
    const c = selected();
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
    $('play').innerHTML = '&#9654; Play';
}

$('play').onclick = () => {
    playing = !playing;
    $('play').innerHTML = playing ? '&#10074;&#10074; Pause' : '&#9654; Play';
};

// ================= Side panel =================
function compass(az) {
    const names = ['north', 'north-northeast', 'northeast', 'east-northeast', 'east', 'east-southeast', 'southeast', 'south-southeast',
        'south', 'south-southwest', 'southwest', 'west-southwest', 'west', 'west-northwest', 'northwest', 'north-northwest'];
    return names[Math.round((((az % 360) + 360) % 360) / 22.5) % 16];
}

function renderSelected() {
    const c = selected();
    $('site-name').textContent = c ? c.name : 'No site yet';
    const elev = c ? elevationAt(c.lat, c.lon) : null;
    $('site-coords').textContent = c ? `${fmtLat(c.lat)}, ${fmtLon(c.lon)}` + (elev !== null ? ` \u00b7 ${elev.toFixed(2)} km` : '') : '';
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
    if (!s) {
        for (const id of ['sun-el', 'earth-el', 'temp']) {
            $(id).textContent = '\u2014';
        }
        $('sun-state').textContent = $('earth-state').textContent = $('power').textContent = '';
        $('plain').textContent = c?.error ? `No NASA data: ${c.error}` : 'Add a site, then press Analyze.';
        $('clock').textContent = '\u2014';
        return;
    }
    $('sun-el').textContent = `${s.sun_el.toFixed(1)}${DEG}`;
    $('sun-state').textContent = `${s.sun_az.toFixed(0)}${DEG} ${compass(s.sun_az)} \u00b7 ${nextChange(c, 'sun_ok', 'sets', 'rises')}`;
    $('earth-el').textContent = `${s.earth_el.toFixed(1)}${DEG}`;
    $('earth-state').textContent = `${s.earth_az.toFixed(0)}${DEG} ${compass(s.earth_az)} \u00b7 ${nextChange(c, 'earth_ok', 'sets', 'rises')}`;
    $('temp').textContent = `${Math.round(s.temp_k)} K`;
    $('power').textContent = `${Math.round(s.temp_k - 273.15)} ${DEG}C \u00b7 sunlight ${Math.round(s.flux_w_m2)} W/m\u00b2`;
    $('clock').textContent = fmtTime(s.t) + ' UTC';
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
    if (mode !== 'street') {
        // The Sun is so far away that one direction lights the whole Moon and Earth correctly.
        sunLight.position.copy(sunM).multiplyScalar(50);
    }
    if (globeMap === 'temp') {
        updateTempTexture(sunM, s.sun_au);
        showLegend('temp', TEMP_MIN, TEMP_MAX);
    } else if (globeMap === 'elev') {
        showLegend('globe', -10, 11);
    } else {
        showLegend(null);
    }
}

// ================= Modes and camera =================
const NAV_MODES = ['globe', 'surface', 'street', 'rank', 'missions'];
const PANELS = {rank: 'rank', missions: 'missions', earth: 'earthview', sun: 'sunview'};
let config = {cesium_ion_token: '', google_maps_key: ''};
fetch('/api/config').then(r => r.json()).then(j => {
    config = j;
}).catch(() => {});

function setMode(next) {
    mode = next;
    flight = null;
    for (const id of NAV_MODES) {
        $('mode-' + id).classList.toggle('active', id === mode);
    }
    for (const [m, id] of Object.entries(PANELS)) {
        $(id).hidden = mode !== m;
    }
    globe.visible = mode === 'globe';
    street.visible = mode === 'street';
    renderer.domElement.style.visibility = mode === 'globe' || mode === 'street' ? 'visible' : 'hidden';
    $('cesium').hidden = mode !== 'surface';
    controls.enabled = mode === 'globe';
    $('globe-tools').hidden = mode !== 'globe';
    $('street-tools').hidden = mode !== 'street';
    $('surface-tools').hidden = mode !== 'surface';
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
        $('hint').textContent = 'Drag to rotate \u00b7 Scroll to zoom \u00b7 Click the Moon to look around, or click Earth or the Sun';
        fitAll();
    } else if (mode === 'surface') {
        $('hint').textContent = 'Drag to look \u00b7 W A S D to walk \u00b7 Shift to run \u00b7 Scroll down to stand at eye level';
        const target = nextSurface || (c ? {lat: c.lat, lon: c.lon, name: c.name} : null);
        nextSurface = null;
        if (target) {
            openSurfaceAt(target.lat, target.lon, target.name, target.elevation);
        }
        $('spot').hidden = true;
    } else {
        $('hint').textContent = '';
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
    if (!surfacePos) {
        return;
    }
    if (surfaceElevation) {
        const r = localRange(surfacePos.lat, surfacePos.lon);
        setElevationColors(true, r.min, r.max, BLUE_RAMP);
        showLegend('elev', r.min / 1000, r.max / 1000);
        complete('heat');
    } else {
        setElevationColors(false);
        showLegend(null);
    }
}

$('sf-elev').onclick = () => {
    surfaceElevation = !surfaceElevation;
    applySurfaceElevation();
};

async function openSurfaceAt(lat, lon, label, withElevation) {
    if (withElevation) {
        surfaceElevation = true;
    }
    surfacePos = {lat, lon, label, walked: 0};
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

function renderSurfaceReadout() {
    if (mode !== 'surface' || !surfacePos) {
        return;
    }
    const s = currentSample();
    const el = elevationAt(surfacePos.lat, surfacePos.lon);
    $('readout').hidden = false;
    const temp = s ? tempModel(Math.sin(rad(s.sun_el)), s.sun_au) : null;
    $('readout').innerHTML = `
        <div class="quiet">${escapeHtml(surfacePos.label)}</div>
        <b>${temp !== null ? Math.round(temp) + ' K' : '\u2014'}</b> <span class="quiet">${temp !== null ? Math.round(temp - 273.15) + ' ' + DEG + 'C' : ''}</span>
        <div style="margin-top:6px">${fmtLat(surfacePos.lat)}, ${fmtLon(surfacePos.lon)}</div>
        <div class="quiet">${el !== null ? `Elevation ${el.toFixed(2)} km (LOLA)` : ''}</div>
        <div class="quiet">Walked ${surfacePos.walked < 1000 ? Math.round(surfacePos.walked) + ' m' : (surfacePos.walked / 1000).toFixed(2) + ' km'}</div>
        ${s ? `<div style="margin-top:6px">Sun ${s.sun_el > 0 ? s.sun_el.toFixed(0) + DEG + ' up' : 'below horizon'} \u00b7 Earth ${s.earth_el > 0 ? s.earth_el.toFixed(0) + DEG + ' up' : 'below horizon'}</div>` : ''}`;
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
    $('sf-shadow').textContent = sunlightOn ? 'Real sunlight: on' : 'Real sunlight: off';
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

function globeClick(e) {
    const ray = moonHit(e);
    const hits = ray.intersectObjects([moon, globeEarth, ...globeSun.children.filter(o => o.isMesh), ...markerGroup.children], false);
    const first = hits[0];
    if (!first) {
        return;
    }
    if (first.object.userData.id) {
        selectSite(first.object.userData.id);
        return;
    }
    if (first.object === globeEarth) {
        // The texture coordinate tells us which place on Earth was clicked.
        const lat = first.uv.y * 180 - 90;
        const lng = first.uv.x * 360 - 180;
        openEarth(lat, lng, `${fmtLat(lat)}, ${fmtLon(lng)}`);
        return;
    }
    if (first.object.parent === globeSun) {
        openSun();
        return;
    }
    const p = first.point.clone().normalize();
    const lat = Math.asin(p.y) * 180 / Math.PI;
    const lon = Math.atan2(-p.z, p.x) * 180 / Math.PI;
    const name = `Site ${lat.toFixed(2)}, ${lon.toFixed(2)}`;
    $('name').value = name;
    $('preset').value = '';
    writeCoords(lat, lon);
    const r = renderer.domElement.getBoundingClientRect();
    showSpotPrompt(e.clientX - r.left, e.clientY - r.top, lat, lon, name);
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
        showTip(e.clientX - r.left, e.clientY - r.top, `${fmtLat(lat)}, ${fmtLon(lon)}`,
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
        if (tick > 0.12) {
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
    if (mode === 'globe' || mode === 'street') {
        renderer.render(scene, camera);
    }
});

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
    $('analyze').click();
});
