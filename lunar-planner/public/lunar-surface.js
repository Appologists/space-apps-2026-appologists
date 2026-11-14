// Moon surface view with CesiumJS: Cesium Moon 3D tiles (ion asset 2684829) and the
// NASA Moon Trek LRO WAC global mosaic (WMTS). Sun lighting comes from our Horizons sample.

const CESIUM_VERSION = '1.135';
const CESIUM_BASE = `https://cesium.com/downloads/cesiumjs/releases/${CESIUM_VERSION}/Build/Cesium/`;
const MOON_ASSET_ID = 2684829;
const TREK_URL = 'https://trek.nasa.gov/tiles/Moon/EQ/LRO_WAC_Mosaic_Global_303ppd_v02/1.0.0/{Style}/{TileMatrixSet}/{TileMatrix}/{TileRow}/{TileCol}.jpg';

let C = null;
let viewer = null;
let tileset = null;
let tilesetReady = Promise.resolve(null);
let sunEntity = null;
let earthEntity = null;
let site = null;
let yawDeg = 0;
let pitchDeg = 0;
let eyeM = 1.7;
let walked = 0;
let onWalk = null;
let onStatus = () => {};
let onPoint = null;
let lastSample = null;
let sunlightOn = false;
let elevationOn = false;

// Lighting: real Sun when "Real sunlight" is on; otherwise a fixed light from the north-west
// (standard hill shading) whenever elevation colours are on, so the shape of the ground shows.
function applyLight() {
    if (!viewer || !site) {
        return;
    }
    const globe = viewer.scene.globe;
    if (sunlightOn && lastSample) {
        const d = dirAt(site.lat, site.lon, lastSample.sun_az, lastSample.sun_el);
        viewer.scene.light = new C.DirectionalLight({direction: C.Cartesian3.negate(d, new C.Cartesian3()), intensity: 2.2});
        globe.enableLighting = true;
    } else if (elevationOn) {
        const d = dirAt(site.lat, site.lon, 315, 30);
        viewer.scene.light = new C.DirectionalLight({direction: C.Cartesian3.negate(d, new C.Cartesian3()), intensity: 2.6});
        globe.enableLighting = true;
    } else {
        globe.enableLighting = false;
    }
}
const keys = new Set();

function loadScript(src) {
    return new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = src;
        s.onload = resolve;
        s.onerror = () => reject(new Error('Could not load ' + src));
        document.head.append(s);
    });
}

async function loadCesium() {
    if (window.Cesium) {
        return window.Cesium;
    }
    window.CESIUM_BASE_URL = CESIUM_BASE;
    const css = document.createElement('link');
    css.rel = 'stylesheet';
    css.href = CESIUM_BASE + 'Widgets/widgets.css';
    document.head.append(css);
    await loadScript(CESIUM_BASE + 'Cesium.js');
    return window.Cesium;
}

async function createViewer(container, token) {
    C = await loadCesium();
    C.Ellipsoid.default = C.Ellipsoid.MOON;
    if (token) {
        C.Ion.defaultAccessToken = token;
    }
    // Real 3D terrain from NASA LOLA (served by our own server), so the surface works without any ion asset.
    const moonScheme = new C.GeographicTilingScheme({ellipsoid: C.Ellipsoid.MOON, numberOfLevelZeroTilesX: 2, numberOfLevelZeroTilesY: 1});
    const lolaTerrain = new C.CustomHeightmapTerrainProvider({
        width: 65,
        height: 65,
        tilingScheme: moonScheme,
        ellipsoid: C.Ellipsoid.MOON,
        credit: new C.Credit('Terrain: NASA LRO LOLA'),
        callback: (x, y, level) => {
            if (level > 10) {
                return undefined;
            }
            return fetch(`/api/heightmap?level=${level}&x=${x}&y=${y}`)
                .then(r => (r.ok ? r.arrayBuffer() : null))
                .then(b => (b ? new Float32Array(b) : new Float32Array(65 * 65)));
        },
    });
    viewer = new C.Viewer(container, {
        globe: new C.Globe(C.Ellipsoid.MOON),
        terrainProvider: lolaTerrain,
        baseLayer: false,
        baseLayerPicker: false,
        geocoder: false,
        homeButton: false,
        sceneModePicker: false,
        navigationHelpButton: false,
        animation: false,
        timeline: false,
        fullscreenButton: false,
        infoBox: false,
        selectionIndicator: false,
        shadows: false,
        skyAtmosphere: false,
    });
    const scene = viewer.scene;
    scene.backgroundColor = C.Color.BLACK;
    scene.globe.baseColor = C.Color.fromCssColorString('#3a3a37');
    scene.globe.enableLighting = false;
    scene.globe.depthTestAgainstTerrain = true;
    scene.globe.showGroundAtmosphere = false;
    if (scene.fog) {
        scene.fog.enabled = false;
    }
    if (scene.sun) {
        scene.sun.show = false;
    }
    if (scene.moon) {
        scene.moon.show = false;
    }
    scene.screenSpaceCameraController.enableInputs = false;
    scene.camera.frustum.near = 0.5;

    const trek = new C.WebMapTileServiceImageryProvider({
        url: TREK_URL,
        layer: 'LRO_WAC_Mosaic_Global_303ppd_v02',
        style: 'default',
        format: 'image/jpeg',
        tileMatrixSetID: 'default028mm',
        maximumLevel: 8,
        tilingScheme: moonScheme,
        credit: new C.Credit('NASA Moon Trek \u00b7 LRO WAC global mosaic'),
    });
    viewer.imageryLayers.addImageryProvider(trek);

    // Load the 3D Moon in the background so the camera works at once.
    tilesetReady = C.Cesium3DTileset.fromIonAssetId(MOON_ASSET_ID, {enableCollision: true}).then(t => {
        tileset = t;
        t.show = false;
        scene.primitives.add(t);
        return t;
    }).catch(() => {
        tileset = null;
        return null;
    });

    sunEntity = viewer.entities.add({
        position: C.Cartesian3.ZERO,
        point: {pixelSize: 26, color: C.Color.fromCssColorString('#fff3cf'), outlineColor: C.Color.fromCssColorString('#e8b465'), outlineWidth: 6},
        label: {text: 'Sun', font: '16px Georgia, serif', fillColor: C.Color.fromCssColorString('#e8b465'), pixelOffset: new C.Cartesian2(0, -30)},
    });
    earthEntity = viewer.entities.add({
        position: C.Cartesian3.ZERO,
        point: {pixelSize: 34, color: C.Color.fromCssColorString('#4f86c6'), outlineColor: C.Color.fromCssColorString('#cfe3f7'), outlineWidth: 2},
        label: {text: 'Earth', font: '16px Georgia, serif', fillColor: C.Color.fromCssColorString('#8fb8de'), pixelOffset: new C.Cartesian2(0, -32)},
    });

    bindInput(container);
    scene.preRender.addEventListener(tick);
}

// Direction (unit vector, Moon-fixed) for a given azimuth/elevation at the site.
function dirAt(lat, lon, az, el) {
    const pos = C.Cartesian3.fromDegrees(lon, lat, 0, C.Ellipsoid.MOON);
    const enu = C.Transforms.eastNorthUpToFixedFrame(pos, C.Ellipsoid.MOON);
    const a = C.Math.toRadians(az);
    const e = C.Math.toRadians(el);
    const local = new C.Cartesian3(Math.sin(a) * Math.cos(e), Math.cos(a) * Math.cos(e), Math.sin(e));
    const world = C.Matrix4.multiplyByPointAsVector(enu, local, new C.Cartesian3());
    return C.Cartesian3.normalize(world, world);
}

export function updateSky(sample) {
    if (!viewer || !site || !sample) {
        return;
    }
    lastSample = sample;
    const sunDir = dirAt(site.lat, site.lon, sample.sun_az, sample.sun_el);
    applyLight();
    const base = C.Cartesian3.fromDegrees(site.lon, site.lat, 0, C.Ellipsoid.MOON);
    const far = 3.0e6;
    sunEntity.position = C.Cartesian3.add(base, C.Cartesian3.multiplyByScalar(sunDir, far, new C.Cartesian3()), new C.Cartesian3());
    const earthDir = dirAt(site.lat, site.lon, sample.earth_az, sample.earth_el);
    earthEntity.position = C.Cartesian3.add(base, C.Cartesian3.multiplyByScalar(earthDir, far, new C.Cartesian3()), new C.Cartesian3());
}

function groundHeight(lat, lon) {
    const carto = C.Cartographic.fromDegrees(lon, lat);
    const h = tileset && tileset.show && viewer.scene.sampleHeightSupported ? viewer.scene.sampleHeight(carto) : undefined;
    if (h !== undefined) {
        return h;
    }
    const g = viewer.scene.globe.getHeight(carto);
    return g !== undefined ? g : null;
}

let camLat = 0;
let camLon = 0;
let camH = 0;

function placeCamera() {
    const pos = C.Cartesian3.fromDegrees(camLon, camLat, camH + eyeM, C.Ellipsoid.MOON);
    viewer.camera.setView({
        destination: pos,
        orientation: {heading: C.Math.toRadians(yawDeg), pitch: C.Math.toRadians(pitchDeg), roll: 0},
    });
}

let last = performance.now();

function tick() {
    if (!site) {
        return;
    }
    const now = performance.now();
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
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
    if (f || r) {
        const speed = keys.has('shift') ? 400 : 40;
        const step = speed * dt;
        const a = C.Math.toRadians(yawDeg);
        const dn = (Math.cos(a) * f - Math.sin(a) * r) * step;
        const de = (Math.sin(a) * f + Math.cos(a) * r) * step;
        camLat += dn / 1737400 * 180 / Math.PI;
        camLon += de / (1737400 * Math.max(0.02, Math.cos(camLat * Math.PI / 180))) * 180 / Math.PI;
        walked += Math.hypot(dn, de);
        if (onWalk) {
            onWalk(walked, camLat, camLon);
        }
    }
    const h = groundHeight(camLat, camLon);
    if (h !== null && Number.isFinite(h)) {
        camH = h;
    }
    placeCamera();
}

function bindInput(container) {
    let drag = null;
    container.addEventListener('pointerdown', e => {
        drag = {x: e.clientX, y: e.clientY};
        container.setPointerCapture(e.pointerId);
    });
    let pointQueued = false;
    container.addEventListener('pointermove', e => {
        if (!drag) {
            // Read out latitude, longitude and height of the ground under the pointer.
            if (!onPoint || pointQueued) {
                return;
            }
            pointQueued = true;
            requestAnimationFrame(() => {
                pointQueued = false;
                const rect = container.getBoundingClientRect();
                const ray = viewer.camera.getPickRay(new C.Cartesian2(e.clientX - rect.left, e.clientY - rect.top));
                const hit = ray ? viewer.scene.globe.pick(ray, viewer.scene) : undefined;
                if (!hit) {
                    onPoint(null);
                    return;
                }
                const g = C.Cartographic.fromCartesian(hit, C.Ellipsoid.MOON);
                onPoint({
                    lat: C.Math.toDegrees(g.latitude),
                    lon: C.Math.toDegrees(g.longitude),
                    heightM: g.height,
                    distanceM: C.Cartesian3.distance(viewer.camera.positionWC, hit),
                    x: e.clientX - rect.left,
                    y: e.clientY - rect.top,
                });
            });
            return;
        }
        yawDeg = (yawDeg - (e.clientX - drag.x) * 0.15 + 360) % 360;
        pitchDeg = Math.max(-89, Math.min(89, pitchDeg + (e.clientY - drag.y) * 0.15));
        drag = {x: e.clientX, y: e.clientY};
    });
    for (const name of ['pointerup', 'pointercancel']) {
        container.addEventListener(name, () => {
            drag = null;
        });
    }
    container.addEventListener('wheel', e => {
        e.preventDefault();
        eyeM = Math.max(1.7, Math.min(20000, eyeM * (e.deltaY > 0 ? 1.25 : 0.8)));
        if (eyeM < 30) {
            pitchDeg = Math.max(pitchDeg, 0);
        }
    }, {passive: false});
    window.addEventListener('keydown', e => {
        if (!site || container.hidden || e.target instanceof HTMLInputElement) {
            return;
        }
        keys.add(e.key.toLowerCase());
        if (e.key.startsWith('Arrow')) {
            e.preventDefault();
        }
    });
    window.addEventListener('keyup', e => keys.delete(e.key.toLowerCase()));
    window.addEventListener('blur', () => keys.clear());
}

export async function openSurface(container, opts) {
    onStatus = opts.onStatus || onStatus;
    onWalk = opts.onWalk || null;
    onPoint = opts.onPoint || null;
    if (!viewer) {
        onStatus('Loading the Moon surface...');
        await createViewer(container, opts.token);
        onStatus('');
    }
    site = {lat: opts.lat, lon: opts.lon};
    camLat = opts.lat;
    camLon = opts.lon;
    camH = 3000;
    eyeM = opts.startHighM || opts.eyeM || 1.7;
    walked = 0;
    yawDeg = opts.yaw ?? 0;
    pitchDeg = opts.startHighM ? -12 : 4;
    updateSky(opts.sample);
    viewer.resize();
    camH = opts.fallbackHeightM ?? 0;
    placeCamera();
    // Fetch the most detailed LOLA terrain under the site and stand on it.
    try {
        const [p] = await C.sampleTerrainMostDetailed(viewer.terrainProvider, [C.Cartographic.fromDegrees(opts.lon, opts.lat)]);
        if (p && Number.isFinite(p.height) && site && site.lat === opts.lat) {
            camH = p.height;
        }
    } catch (e) {
        if (opts.fallbackHeightM !== undefined) {
            camH = opts.fallbackHeightM;
        }
    }
}

/** 'lola' = NASA LOLA terrain + Trek imagery (always works). 'ion' = Cesium Moon 3D tiles, if the account has it. */
export async function setLayer(kind) {
    if (!viewer) {
        return false;
    }
    if (kind === 'ion') {
        const t = await tilesetReady;
        if (!t) {
            onStatus('Cesium Moon is not in your Cesium ion account yet. Add it from the ion Asset Depot. Showing NASA LOLA terrain.');
            return false;
        }
        t.show = true;
        viewer.scene.globe.show = false;
        return true;
    }
    if (tileset) {
        tileset.show = false;
    }
    viewer.scene.globe.show = true;
    return true;
}

/** Real sunlight: light the ground from the Sun's true direction, with cast shadows. Off shows the photo map evenly lit. */
export function setSunlight(on) {
    if (!viewer) {
        return;
    }
    sunlightOn = on;
    applyLight();
    viewer.shadows = on;
    viewer.terrainShadows = on ? C.ShadowMode.ENABLED : C.ShadowMode.DISABLED;
    if (on) {
        viewer.shadowMap.maximumDistance = 50000;
        viewer.shadowMap.softShadows = true;
    }
    if (tileset) {
        tileset.shadows = on ? C.ShadowMode.ENABLED : C.ShadowMode.DISABLED;
    }
}

export function face(az, el) {
    yawDeg = az;
    pitchDeg = Math.max(0, Math.min(80, el));
}

export function birdsEye() {
    eyeM = eyeM > 100 ? 1.7 : 4000;
    pitchDeg = eyeM > 100 ? -35 : 4;
}

export function surfaceReady() {
    return Boolean(viewer);
}

export function resizeSurface() {
    if (viewer) {
        viewer.resize();
    }
}

/** Colour the ground by elevation (metres, LOLA reference). Off returns to the photo map. */
export function setElevationColors(on, minM, maxM, rampHex) {
    if (!viewer) {
        return;
    }
    elevationOn = on;
    applyLight();
    if (!on) {
        viewer.scene.globe.material = undefined;
        return;
    }
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 1;
    const ctx = canvas.getContext('2d');
    const g = ctx.createLinearGradient(0, 0, 256, 0);
    rampHex.forEach((hex, i) => g.addColorStop(i / (rampHex.length - 1), hex));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 256, 1);
    const m = C.Material.fromType('ElevationRamp');
    m.uniforms.image = canvas;
    m.uniforms.minimumHeight = minM;
    m.uniforms.maximumHeight = maxM;
    viewer.scene.globe.material = m;
}
