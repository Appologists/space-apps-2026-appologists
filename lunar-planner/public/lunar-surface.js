// Moon surface view with CesiumJS: Cesium Moon 3D tiles (ion asset 2684829) and the
// NASA Moon Trek LRO WAC global mosaic (WMTS). Sun lighting comes from our Horizons sample.

const CESIUM_VERSION = '1.135';
const CESIUM_BASE = `https://cesium.com/downloads/cesiumjs/releases/${CESIUM_VERSION}/Build/Cesium/`;
const MOON_ASSET_ID = 2684829;
const TREK_URL = 'https://trek.nasa.gov/tiles/Moon/EQ/LRO_WAC_Mosaic_Global_303ppd_v02/1.0.0/{Style}/{TileMatrixSet}/{TileMatrix}/{TileRow}/{TileCol}.jpg';

let C = null;
let viewer = null;
let tileset = null;
let tilesetReady = null;
let ionToken = '';

// The Cesium Moon 3D tiles are only requested when asked for, so nothing fails in the background.
function loadTileset() {
    if (!tilesetReady) {
        if (!ionToken) {
            tilesetReady = Promise.resolve(null);
        } else {
            tilesetReady = C.Cesium3DTileset.fromIonAssetId(MOON_ASSET_ID, {enableCollision: true}).then(t => {
                tileset = t;
                t.show = false;
                viewer.scene.primitives.add(t);
                return t;
            }).catch(() => null);
        }
    }
    return tilesetReady;
}
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
let exaggeration = 1;
let walkTarget = null;
let sunlightOn = false;
let elevationOn = false;
// Tools: 'walk' (a click walks there) or 'measure' (two clicks give distance, height change and slope).
let tool = 'walk';
let onMeasure = null;
const measure = {points: [], entities: []};
let trackEntities = [];

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

async function createViewer(container, token, hasTerrain) {
    C = await loadCesium();
    C.Ellipsoid.default = C.Ellipsoid.MOON;
    ionToken = token || '';
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
        // Without the LOLA download the ground is a smooth Moon, so no request fails.
        terrainProvider: hasTerrain ? lolaTerrain : new C.EllipsoidTerrainProvider({ellipsoid: C.Ellipsoid.MOON}),
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
    // Smooth edges and sharp text-free detail: anti-aliasing and full device resolution (capped at 2x).
    viewer.useBrowserRecommendedResolution = false;
    viewer.resolutionScale = Math.min(1, 2 / (window.devicePixelRatio || 1));
    scene.postProcessStages.fxaa.enabled = true;
    if (scene.msaaSupported) {
        scene.msaaSamples = 4;
    }
    scene.globe.maximumScreenSpaceError = 1.5;
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
    // getHeight already includes vertical exaggeration; keep the real height here.
    return g !== undefined ? g / exaggeration : null;
}

let camLat = 0;
let camLon = 0;
let camH = 0;

function placeCamera() {
    const pos = C.Cartesian3.fromDegrees(camLon, camLat, camH * exaggeration + eyeM, C.Ellipsoid.MOON);
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
    if (walkTarget && !f && !r) {
        const dn = (walkTarget.lat - camLat) * Math.PI / 180 * 1737400;
        const de = (walkTarget.lon - camLon) * Math.PI / 180 * 1737400 * Math.max(0.02, Math.cos(camLat * Math.PI / 180));
        const dist = Math.hypot(dn, de);
        if (dist < 2) {
            walkTarget = null;
        } else {
            const move = Math.min(dist, Math.max(30, dist * 2.5) * dt);
            camLat += (dn / dist) * move / 1737400 * 180 / Math.PI;
            camLon += (de / dist) * move / (1737400 * Math.max(0.02, Math.cos(camLat * Math.PI / 180))) * 180 / Math.PI;
            walked += move;
            if (onWalk) {
                onWalk(walked, camLat, camLon);
            }
        }
    }
    if (f || r) {
        walkTarget = null;
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
    let press = null;
    container.addEventListener('pointerdown', e => {
        drag = {x: e.clientX, y: e.clientY};
        press = {x: e.clientX, y: e.clientY, t: performance.now()};
        container.setPointerCapture(e.pointerId);
    });
    // A click (no drag) on the ground walks you there.
    container.addEventListener('pointerup', e => {
        if (!press || !viewer) {
            return;
        }
        const moved = Math.hypot(e.clientX - press.x, e.clientY - press.y);
        const quick = performance.now() - press.t < 350;
        press = null;
        if (moved > 4 || !quick) {
            return;
        }
        const rect = container.getBoundingClientRect();
        const ray = viewer.camera.getPickRay(new C.Cartesian2(e.clientX - rect.left, e.clientY - rect.top));
        const hit = ray ? viewer.scene.globe.pick(ray, viewer.scene) : undefined;
        if (hit) {
            if (tool === 'measure') {
                addMeasurePoint(hit);
                return;
            }
            const g = C.Cartographic.fromCartesian(hit, C.Ellipsoid.MOON);
            walkTarget = {lat: C.Math.toDegrees(g.latitude), lon: C.Math.toDegrees(g.longitude)};
        }
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
    onMeasure = opts.onMeasure || onMeasure;
    clearMeasure();
    if (!viewer) {
        onStatus('Loading the Moon surface...');
        await createViewer(container, opts.token, opts.hasTerrain !== false);
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
        const t = await loadTileset();
        if (!t) {
            onStatus('Cesium Moon 3D needs a Cesium ion token with the "Cesium Moon" asset. Showing NASA LOLA terrain instead.');
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

/** 1 = real heights. Larger values stretch hills and craters so their shape is easier to see. */
export function setExaggeration(x) {
    exaggeration = x;
    if (viewer) {
        viewer.scene.verticalExaggeration = x;
    }
}

/** Where the surface camera is and which way it looks (for the compass and mini-map). */
export function getView() {
    return {yaw: yawDeg, pitch: pitchDeg, lat: camLat, lon: camLon};
}


// ================= Tools =================

export function setTool(name) {
    tool = name;
    if (viewer) {
        viewer.container.style.cursor = name === 'measure' ? 'crosshair' : '';
    }
    if (name !== 'measure') {
        clearMeasure();
    }
}

export function clearMeasure() {
    if (viewer) {
        for (const e of measure.entities) {
            viewer.entities.remove(e);
        }
    }
    measure.points = [];
    measure.entities = [];
    if (onMeasure) {
        onMeasure(null);
    }
}

function addMeasurePoint(hit) {
    if (measure.points.length === 2) {
        clearMeasure();
    }
    const accent = C.Color.fromCssColorString('#ff6b3d');
    measure.points.push(hit);
    measure.entities.push(viewer.entities.add({
        position: hit,
        point: {pixelSize: 10, color: C.Color.WHITE, outlineColor: accent, outlineWidth: 3, disableDepthTestDistance: Number.POSITIVE_INFINITY},
    }));
    if (measure.points.length === 1) {
        if (onMeasure) {
            onMeasure({pending: true});
        }
        return;
    }
    const [a, b] = measure.points;
    const ca = C.Cartographic.fromCartesian(a, C.Ellipsoid.MOON);
    const cb = C.Cartographic.fromCartesian(b, C.Ellipsoid.MOON);
    const geo = new C.EllipsoidGeodesic(ca, cb, C.Ellipsoid.MOON);
    const groundM = geo.surfaceDistance;
    // Picked heights include the vertical exaggeration; report real metres.
    const dh = (cb.height - ca.height) / exaggeration;
    const grade = C.Math.toDegrees(Math.atan2(Math.abs(dh), Math.max(groundM, 1e-6)));
    const bearing = (C.Math.toDegrees(geo.startHeading) + 360) % 360;
    const mid = C.Cartesian3.midpoint(a, b, new C.Cartesian3());
    const dist = groundM < 1000 ? `${groundM.toFixed(0)} m` : `${(groundM / 1000).toFixed(2)} km`;
    measure.entities.push(viewer.entities.add({
        polyline: {positions: [a, b], width: 3, material: accent, depthFailMaterial: accent.withAlpha(0.35), arcType: C.ArcType.NONE},
    }));
    measure.entities.push(viewer.entities.add({
        position: mid,
        label: {
            text: `${dist}  \u0394h ${dh >= 0 ? '+' : ''}${dh.toFixed(0)} m  ${grade.toFixed(1)}\u00b0`,
            font: '600 14px "IBM Plex Mono", monospace',
            fillColor: C.Color.WHITE,
            showBackground: true,
            backgroundColor: C.Color.fromCssColorString('#0e0e0d').withAlpha(0.85),
            backgroundPadding: new C.Cartesian2(10, 6),
            pixelOffset: new C.Cartesian2(0, -18),
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
    }));
    if (onMeasure) {
        onMeasure({groundM, dh, grade, bearing});
    }
}

/** The Sun's and Earth's paths across the sky over the mission, drawn as dotted arcs (one dot per step). */
export function setSkyTracks(samples) {
    if (!viewer || !site) {
        return;
    }
    for (const e of trackEntities) {
        viewer.entities.remove(e);
    }
    trackEntities = [];
    if (!samples || !samples.length) {
        return;
    }
    const base = C.Cartesian3.fromDegrees(site.lon, site.lat, 0, C.Ellipsoid.MOON);
    const far = 2.9e6;
    const at = (az, el) => C.Cartesian3.add(base, C.Cartesian3.multiplyByScalar(dirAt(site.lat, site.lon, az, el), far, new C.Cartesian3()), new C.Cartesian3());
    const add = (key, color) => {
        const positions = samples.map(x => at(x[key + '_az'], x[key + '_el']));
        trackEntities.push(viewer.entities.add({
            polyline: {positions, width: 2, arcType: C.ArcType.NONE, material: new C.PolylineDashMaterialProperty({color: color.withAlpha(0.75), dashLength: 10})},
        }));
    };
    add('sun', C.Color.fromCssColorString('#e8b465'));
    add('earth', C.Color.fromCssColorString('#7fb2ff'));
}

export function setTracksVisible(on) {
    for (const e of trackEntities) {
        e.show = on;
    }
}

/** A PNG of the current view. */
export function snapshot() {
    if (!viewer) {
        return null;
    }
    viewer.render();
    return viewer.canvas.toDataURL('image/png');
}
