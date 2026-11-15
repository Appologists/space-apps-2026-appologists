// The view from the ground: stand at a point on the Moon and look around.
//
// The ground is a mesh built from a polar terrain patch (src/terrain/polar-grid.js), curved with the Moon.
// The Sun and Earth are drawn where the ephemeris says they are, at their true angular size, and the
// terrain hides them when it is in the way. Like the globe, this module knows nothing about scoring.
//
// Scene axes, in metres: x = east, y = up, z = south (so north is −z). The origin is the ground under the viewer.
//
// Ground brightness = slope toward the Sun × whether other terrain blocks the Sun (src/surface/shadows.js).
// What is NOT here: rocks and craters smaller than the terrain data's pixels, and light bounced off sunlit
// slopes into shadow. Shadowed ground is given a small fixed brightness so its shape stays readable.
import * as THREE from 'three';
import { DEG, MOON_RADIUS_KM } from '../astro/coords.js';
import { createGroundMaterial } from './ground-grain.js';
import { hexToLinear, lensById, NO_DATA_HEX } from './lenses.js';
import { buildShadowGrid, litFraction, sampleGrid, sweepShadows } from './shadows.js';

const R = MOON_RADIUS_KM * 1000;
const SKY_DISTANCE = 5_000_000; // how far away the Sun, Earth and their paths are drawn (beyond all terrain)
export const SUN_RADIUS_KM = 695_700;
export const EARTH_RADIUS_KM = 6371;

const GROUND_COLOR = [0.6, 0.585, 0.56];
// Exposure: how bright flat sunlit ground is drawn. 0.55 gives mid-grey, leaving room for sun-facing slopes
// to be brighter. (The real surface is darker still: the Moon reflects only about a tenth of the light.)
const EXPOSURE = 0.55;
const NO_DATA_COLOR = [0.3, 0.34, 0.42];
const SHADOW_FILL = 0.045; // brightness of ground in shadow: not physical, just enough to see its shape
// Shadow grids: a coarse one for the whole patch and a fine one for the ground near the viewer.
const COARSE = { halfSizeM: 300_000, cellM: 500 };
const FINE = { halfSizeM: 12_000, cellM: 30 };

/**
 * Makes a function that reads a per-sample quantity at any horizontal position, by interpolating between
 * the polar grid's samples. `valueAt(ring, spoke)` supplies the samples and `centreValue` the value under
 * the viewer. The function returns NaN beyond the last ring.
 */
function makeFieldSampler(patch, valueAt, centreValue) {
  const { nAz, distances } = patch;
  const nR = distances.length;
  const ringRadius = Float64Array.from(distances, (d) => R * Math.sin(d / R));
  return (x, z) => {
    const r = Math.hypot(x, z);
    if (r >= ringRadius[nR - 1]) return NaN;
    let az = Math.atan2(x, -z); // compass bearing of the point: north is −z
    if (az < 0) az += 2 * Math.PI;
    const fj = (az / (2 * Math.PI)) * nAz;
    const j0 = Math.floor(fj) % nAz;
    const j1 = (j0 + 1) % nAz;
    const tj = fj - Math.floor(fj);
    if (r <= ringRadius[0]) {
      const first = valueAt(0, j0) * (1 - tj) + valueAt(0, j1) * tj;
      return centreValue + (first - centreValue) * (r / ringRadius[0]);
    }
    let lo = 0;
    let hi = nR - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (ringRadius[mid] <= r) lo = mid;
      else hi = mid;
    }
    const tk = (r - ringRadius[lo]) / (ringRadius[hi] - ringRadius[lo]);
    const inner = valueAt(lo, j0) * (1 - tj) + valueAt(lo, j1) * tj;
    const outer = valueAt(hi, j0) * (1 - tj) + valueAt(hi, j1) * tj;
    return inner * (1 - tk) + outer * tk;
  };
}

/** Unit vector for a compass direction and elevation, in scene axes. */
function skyDirection(azimuthDeg, elevationDeg, out = new THREE.Vector3()) {
  const az = azimuthDeg * DEG;
  const el = elevationDeg * DEG;
  return out.set(Math.cos(el) * Math.sin(az), Math.sin(el), -Math.cos(el) * Math.cos(az));
}

const COMPASS = [
  ['N', 0], ['NE', 45], ['E', 90], ['SE', 135], ['S', 180], ['SW', 225], ['W', 270], ['NW', 315],
];

/**
 * @param {Object} options
 * @param {HTMLCanvasElement} options.canvas
 * @param {HTMLElement} options.container  element the canvas fills
 * @param {HTMLElement} options.labelsEl   overlay for compass and Sun/Earth labels
 * @param {(look: {yaw: number, pitch: number, fov: number}) => void} [options.onLook]
 * @param {(legend: object|null) => void} [options.onLegend]  the active lens's legend changed (null = natural view)
 * @param {(point: {distanceM: number, bearingDeg: number, elevationM: number, slopeDeg: number}|null, clientX: number, clientY: number) => void} [options.onHover]
 */
export function createSurfaceView({ canvas, container, labelsEl, onLook, onLegend, onHover }) {
  // A logarithmic depth buffer keeps both the ground at your feet and mountains 300 km away sharp.
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, logarithmicDepthBuffer: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setClearColor(0x000000, 1);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(60, 1, 0.3, SKY_DISTANCE * 4);
  const look = { yaw: 0, pitch: 3, fov: 60 }; // yaw = compass heading in degrees, pitch = degrees above level
  let eyeHeightM = 1.7;

  // ---- Ground ---------------------------------------------------------------------------------------
  const groundMaterial = createGroundMaterial(); // vertex colours carry sunlight and shadow; the shader adds grain
  let ground = null; // { mesh, positions, normals, colors, noData }
  const sun = { direction: new THREE.Vector3(0, 1, 0), elevation: 90 };

  /** @param {import('../terrain/polar-grid.js').TerrainPatch} patch */
  function setTerrain(patch) {
    if (ground) {
      scene.remove(ground.mesh);
      ground.mesh.geometry.dispose();
    }
    const { nAz, distances, heights, groundHeightM } = patch;
    const nR = distances.length;
    const count = 1 + nR * nAz;
    const positions = new Float32Array(count * 3); // vertex 0 is the ground under the viewer, at the origin
    const noData = new Uint8Array(count);
    const sinA = new Float64Array(nAz);
    const cosA = new Float64Array(nAz);
    for (let j = 0; j < nAz; j++) {
      sinA[j] = Math.sin((j / nAz) * 2 * Math.PI);
      cosA[j] = Math.cos((j / nAz) * 2 * Math.PI);
    }
    for (let k = 0; k < nR; k++) {
      const g = distances[k] / R;
      const sinG = Math.sin(g);
      const cosG = Math.cos(g);
      for (let j = 0; j < nAz; j++) {
        const v = 1 + k * nAz + j;
        let h = heights[k * nAz + j];
        if (Number.isNaN(h)) {
          h = 0; // outside the data: draw the bare reference sphere, in a different colour
          noData[v] = 1;
        }
        const x = (R + h) * sinG; // horizontal distance, with the Moon's curvature
        positions[v * 3] = x * sinA[j];
        positions[v * 3 + 1] = (R + h) * cosG - (R + groundHeightM);
        positions[v * 3 + 2] = -x * cosA[j];
      }
    }
    // Triangles, wound counter-clockwise seen from above so normals point up.
    const index = new Uint32Array(nAz * 3 + (nR - 1) * nAz * 6);
    let t = 0;
    for (let j = 0; j < nAz; j++) {
      index[t++] = 0;
      index[t++] = 1 + ((j + 1) % nAz);
      index[t++] = 1 + j;
    }
    for (let k = 0; k < nR - 1; k++) {
      for (let j = 0; j < nAz; j++) {
        const a = 1 + k * nAz + j;
        const b = 1 + k * nAz + ((j + 1) % nAz);
        const c = a + nAz;
        const d = b + nAz;
        index[t++] = a; index[t++] = b; index[t++] = c;
        index[t++] = b; index[t++] = d; index[t++] = c;
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setIndex(new THREE.BufferAttribute(index, 1));
    geometry.computeVertexNormals();
    const colors = new Float32Array(count * 3);
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    // True elevation per vertex, for the lenses' contour lines (the mesh's own y includes curvature, so it won't do).
    const elevation = new Float32Array(count);
    elevation[0] = groundHeightM;
    for (let i = 0; i < heights.length; i++) elevation[i + 1] = Number.isNaN(heights[i]) ? 0 : heights[i];
    geometry.setAttribute('groundElevation', new THREE.BufferAttribute(elevation, 1));
    const mesh = new THREE.Mesh(geometry, groundMaterial.material);
    mesh.frustumCulled = false;
    scene.add(mesh);
    const heightAt = makeFieldSampler(patch, (k, j) => positions[(1 + k * nAz + j) * 3 + 1], 0);
    ground = {
      patch,
      // Read-outs at any ground position, for the hover tooltip.
      sample: {
        height: heightAt, // in the scene's own frame (includes the Moon's curvature)
        elevation: makeFieldSampler(patch, (k, j) => heights[k * nAz + j], groundHeightM),
        slope: makeFieldSampler(patch, (k, j) => (patch.slopes ? patch.slopes[k * nAz + j] : NaN), patch.groundSlopeDeg ?? NaN),
      },
      mesh,
      positions,
      normals: geometry.getAttribute('normal').array,
      colors,
      noData,
      centreY: -(R + groundHeightM),
      coarse: buildShadowGrid(COARSE.halfSizeM, COARSE.cellM, heightAt),
      fine: buildShadowGrid(FINE.halfSizeM, FINE.cellM, heightAt),
    };
    stand.x = 0;
    stand.z = 0;
    setLens(lens.id); // repaint for this terrain (also shades the ground)
    placeCamera();
  }

  // ---- Lenses: colour the ground by a measured quantity instead of by sunlight ---------------------------
  let lens = { id: 'natural', colors: null };

  /** @param {string} id one of the ids in src/surface/lenses.js */
  function setLens(id) {
    const definition = lensById(id);
    lens = { id: definition.id, colors: null };
    let legend = null;
    if (ground && definition.build) {
      const built = definition.build(ground.patch);
      const none = hexToLinear(NO_DATA_HEX);
      const colors = new Float32Array(ground.positions.length);
      for (let v = 0, n = colors.length / 3; v < n; v++) {
        const value = definition.value(ground.patch, v);
        const c = Number.isNaN(value) ? none : built.color(value);
        colors[v * 3] = c[0];
        colors[v * 3 + 1] = c[1];
        colors[v * 3 + 2] = c[2];
      }
      lens.colors = colors;
      legend = built.legend;
    }
    groundMaterial.setLensMode(!!definition.build);
    shadeGround();
    onLegend?.(legend);
    requestRender();
  }

  /** Recolour the ground: the active lens's colours, or sunlight (slope toward the Sun, and cast shadows). */
  function shadeGround() {
    if (!ground) return;
    const { positions, normals, colors, noData, centreY, coarse, fine } = ground;
    if (lens.colors) {
      colors.set(lens.colors); // drawn flat: in a lens, brightness is data, so no light or shadow on top
      ground.mesh.geometry.getAttribute('color').needsUpdate = true;
      return;
    }
    const s = sun.direction;
    sweepShadows(coarse, s);
    sweepShadows(fine, s, (x, z) => sampleGrid(coarse, coarse.M, x, z));
    const fineLimit = fine.halfSizeM - 2 * fine.cellM;
    // Low Sun means very little light per square metre of flat ground. Raise the exposure to compensate,
    // as a camera would, so flat sunlit ground stays mid-grey whatever the Sun's height.
    const gain = EXPOSURE / Math.max(Math.sin(sun.elevation * DEG), 0.035);
    for (let v = 0, n = positions.length / 3; v < n; v++) {
      const i = v * 3;
      const x = positions[i];
      const y = positions[i + 1];
      const z = positions[i + 2];
      let direct = 0;
      const ndl = normals[i] * s.x + normals[i + 1] * s.y + normals[i + 2] * s.z;
      if (ndl > 0) {
        // Is the Sun above the smooth-Moon horizon here at all? (Catches night beyond the shadow grid's edge.)
        const uy = y - centreY;
        const radius = Math.sqrt(x * x + uy * uy + z * z);
        const dip = radius > R ? Math.sqrt((2 * (radius - R)) / R) : 0;
        if ((x * s.x + uy * s.y + z * s.z) / radius > -dip) {
          const near = Math.abs(x) < fineLimit && Math.abs(z) < fineLimit;
          const grid = near ? fine : coarse;
          const line = sampleGrid(grid, grid.S, x, z);
          const lit = Number.isNaN(line) ? 1 : litFraction(y, line, grid.dropM);
          if (lit > 0) direct = lit * (1 - Math.exp(-ndl * gain));
        }
      }
      const fill = SHADOW_FILL * (0.55 + 0.45 * Math.max(normals[i + 1], 0));
      const b = fill + (1 - fill) * direct;
      const base = noData[v] ? NO_DATA_COLOR : GROUND_COLOR;
      colors[i] = base[0] * b;
      colors[i + 1] = base[1] * b;
      colors[i + 2] = base[2] * b;
    }
    ground.mesh.geometry.getAttribute('color').needsUpdate = true;
  }

  // ---- Sky: Sun, Earth and their paths ---------------------------------------------------------------
  const sunDisc = new THREE.Mesh(new THREE.CircleGeometry(1, 64), new THREE.MeshBasicMaterial({ color: 0xfff6dc }));
  const haloCanvas = document.createElement('canvas');
  haloCanvas.width = haloCanvas.height = 128;
  {
    const g = haloCanvas.getContext('2d');
    const gradient = g.createRadialGradient(64, 64, 6, 64, 64, 64);
    gradient.addColorStop(0, 'rgba(255, 240, 200, 0.55)');
    gradient.addColorStop(1, 'rgba(255, 240, 200, 0)');
    g.fillStyle = gradient;
    g.fillRect(0, 0, 128, 128);
  }
  // A faint glow so the Sun is easy to find. There is no air on the Moon, so this is a camera-style flare.
  const sunHalo = new THREE.Mesh(
    new THREE.PlaneGeometry(2, 2),
    new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(haloCanvas), transparent: true, depthWrite: false }),
  );
  // Earth is a sphere lit from the Sun's direction, so its phase comes out right.
  const earthBall = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 24), new THREE.MeshLambertMaterial({ color: 0x5b93e6 }));
  const sunLight = new THREE.DirectionalLight(0xffffff, 3.2);
  // The sky moves with the camera, so the Sun and Earth keep their directions when the viewpoint drives away
  // from the middle of the terrain (see setPosition).
  const skyGroup = new THREE.Group();
  skyGroup.add(sunDisc, sunHalo, earthBall);
  scene.add(skyGroup, sunLight, new THREE.AmbientLight(0xffffff, 0.06));

  const pathMaterial = (color) => new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.6 });
  const sunPath = new THREE.Line(new THREE.BufferGeometry(), pathMaterial(0xffd36b));
  const earthPath = new THREE.Line(new THREE.BufferGeometry(), pathMaterial(0x5aa8ff));
  sunPath.frustumCulled = earthPath.frustumCulled = false;
  skyGroup.add(sunPath, earthPath);

  const sky = { sunDir: new THREE.Vector3(0, 1, 0), earthDir: new THREE.Vector3(0, 1, 0), sunText: 'Sun', earthText: 'Earth' };

  /**
   * Put the Sun and Earth in the sky.
   * @param {{sun: {azimuth: number, elevation: number, rangeKm: number}, earth: {azimuth: number, elevation: number, rangeKm: number}, sunText?: string, earthText?: string}} now
   */
  function setSky({ sun: s, earth: e, sunText = 'Sun', earthText = 'Earth' }) {
    skyDirection(s.azimuth, s.elevation, sky.sunDir);
    skyDirection(e.azimuth, e.elevation, sky.earthDir);
    sky.sunText = sunText;
    sky.earthText = earthText;
    const sunRadius = SKY_DISTANCE * Math.tan(Math.atan(SUN_RADIUS_KM / s.rangeKm));
    sunDisc.position.copy(sky.sunDir).multiplyScalar(SKY_DISTANCE);
    sunDisc.scale.setScalar(sunRadius);
    sunHalo.position.copy(sky.sunDir).multiplyScalar(SKY_DISTANCE * 1.001);
    sunHalo.scale.setScalar(sunRadius * 7);
    earthBall.position.copy(sky.earthDir).multiplyScalar(SKY_DISTANCE);
    earthBall.scale.setScalar(SKY_DISTANCE * Math.sin(Math.atan(EARTH_RADIUS_KM / e.rangeKm)));
    sunLight.position.copy(sky.sunDir);
    sun.direction.copy(sky.sunDir);
    sun.elevation = s.elevation;
    groundMaterial.setSun(sky.sunDir, s.elevation);
    shadeGround();
    requestRender();
  }

  /** Draw where the Sun and Earth go during the mission. Arrays of azimuth and elevation in degrees. */
  function setPaths({ sunAz, sunEl, earthAz, earthEl }) {
    const build = (line, az, el) => {
      const points = new Float32Array(az.length * 3);
      const v = new THREE.Vector3();
      for (let i = 0; i < az.length; i++) {
        skyDirection(az[i], el[i], v).multiplyScalar(SKY_DISTANCE * 0.99);
        points.set([v.x, v.y, v.z], i * 3);
      }
      line.geometry.dispose();
      line.geometry = new THREE.BufferGeometry();
      line.geometry.setAttribute('position', new THREE.BufferAttribute(points, 3));
    };
    build(sunPath, sunAz, sunEl);
    build(earthPath, earthAz, earthEl);
    requestRender();
  }

  // ---- Camera and controls ---------------------------------------------------------------------------
  const lookDir = new THREE.Vector3();
  const stand = { x: 0, z: 0 }; // where the viewer stands, metres east and south of the middle of the terrain
  /** Height of the ground under the viewer. Off the middle, the highest of a few nearby samples, so the eye never sinks into a rise between them. */
  function groundUnderViewer() {
    if (!ground || (stand.x === 0 && stand.z === 0)) return 0;
    let top = -Infinity;
    for (const [dx, dz] of [[0, 0], [25, 0], [-25, 0], [0, 25], [0, -25]]) {
      const y = ground.sample.height(stand.x + dx, stand.z + dz);
      if (!Number.isNaN(y)) top = Math.max(top, y);
    }
    return Number.isFinite(top) ? top : 0;
  }
  function placeCamera() {
    look.pitch = THREE.MathUtils.clamp(look.pitch, -89, 89);
    look.yaw = ((look.yaw % 360) + 360) % 360;
    look.fov = THREE.MathUtils.clamp(look.fov, 8, 100);
    camera.position.set(stand.x, groundUnderViewer() + eyeHeightM, stand.z);
    skyGroup.position.copy(camera.position);
    camera.fov = look.fov;
    camera.lookAt(skyDirection(look.yaw, look.pitch, lookDir).add(camera.position));
    camera.updateProjectionMatrix();
    onLook?.({ ...look });
    requestRender();
  }
  function setLook(next) {
    Object.assign(look, next);
    placeCamera();
  }
  /**
   * Move the viewer over the same terrain, for driving along a route: metres east and north of its middle.
   * The Sun and Earth stay where they are in the sky; over a few kilometres they move by under 0.2°.
   */
  function setPosition(eastM, northM) {
    stand.x = eastM;
    stand.z = -northM;
    placeCamera();
  }
  function setEyeHeight(heightM) {
    eyeHeightM = Math.max(heightM, 0.3);
    placeCamera();
  }
  function resize() {
    const rect = container.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    renderer.setSize(rect.width, rect.height, false);
    camera.aspect = rect.width / rect.height;
    camera.updateProjectionMatrix();
    requestRender();
  }
  new ResizeObserver(resize).observe(container);

  let drag = null;
  canvas.addEventListener('pointerdown', (e) => {
    canvas.setPointerCapture(e.pointerId);
    drag = { x: e.clientX, y: e.clientY };
    canvas.classList.add('dragging');
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!drag) return;
    // Drag the scene with the pointer, like a street-level photo viewer.
    const degPerPixel = look.fov / Math.max(canvas.clientHeight, 1);
    setLook({ yaw: look.yaw - (e.clientX - drag.x) * degPerPixel, pitch: look.pitch + (e.clientY - drag.y) * degPerPixel });
    drag = { x: e.clientX, y: e.clientY };
  });
  const endDrag = () => {
    drag = null;
    canvas.classList.remove('dragging');
  };

  // ---- What is under the pointer? -----------------------------------------------------------------------
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  /** Walk along the line of sight until it goes under the ground, then read the terrain there. */
  function probe(clientX, clientY) {
    if (!ground) return null;
    const rect = canvas.getBoundingClientRect();
    pointer.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    camera.updateMatrixWorld();
    raycaster.setFromCamera(pointer, camera);
    const o = raycaster.ray.origin;
    const d = raycaster.ray.direction;
    const below = (t) => o.y + d.y * t < ground.sample.height(o.x + d.x * t, o.z + d.z * t);
    let before = 0;
    for (let t = 0.5; t < 320_000; t += Math.max(0.5, t * 0.01)) {
      if (Number.isNaN(ground.sample.height(o.x + d.x * t, o.z + d.z * t))) return null; // ran off the terrain
      if (below(t)) {
        let after = t;
        for (let i = 0; i < 14; i++) {
          const mid = (before + after) / 2;
          if (below(mid)) after = mid;
          else before = mid;
        }
        const x = o.x + d.x * after;
        const z = o.z + d.z * after;
        return {
          distanceM: Math.hypot(x - stand.x, z - stand.z),
          bearingDeg: ((Math.atan2(x - stand.x, -(z - stand.z)) / DEG) + 360) % 360,
          elevationM: ground.sample.elevation(x, z),
          slopeDeg: ground.sample.slope(x, z),
        };
      }
      before = t;
    }
    return null; // looking at the sky
  }
  let hoverQueued = null;
  canvas.addEventListener('pointermove', (e) => {
    if (!onHover || e.pointerType !== 'mouse') return;
    if (drag) return onHover(null, 0, 0);
    const first = !hoverQueued;
    hoverQueued = { x: e.clientX, y: e.clientY };
    if (first) {
      requestAnimationFrame(() => {
        const { x, y } = hoverQueued;
        hoverQueued = null;
        onHover(probe(x, y), x, y);
      });
    }
  });
  canvas.addEventListener('pointerleave', () => onHover?.(null, 0, 0));
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);
  canvas.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      setLook({ fov: look.fov * Math.exp(e.deltaY * 0.0012) });
    },
    { passive: false },
  );
  canvas.addEventListener('keydown', (e) => {
    const step = look.fov / 12;
    const move = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] }[e.key];
    if (move) {
      e.preventDefault();
      setLook({ yaw: look.yaw + move[0], pitch: look.pitch + move[1] });
    } else if (e.key === '+' || e.key === '=') setLook({ fov: look.fov / 1.2 });
    else if (e.key === '-' || e.key === '_') setLook({ fov: look.fov * 1.2 });
  });

  // ---- Labels ----------------------------------------------------------------------------------------
  const makeLabel = (className) => {
    const el = document.createElement('div');
    el.className = `lbl ${className}`;
    labelsEl.appendChild(el);
    return el;
  };
  const compassLabels = COMPASS.map(([text, azimuth]) => {
    const el = makeLabel(`compass${text.length === 1 ? ' cardinal' : ''}`);
    el.textContent = text;
    return { el, direction: skyDirection(azimuth, 0), dy: 14 };
  });
  const sunLabel = { el: makeLabel('mk sun'), direction: sky.sunDir, dy: -22 };
  const earthLabel = { el: makeLabel('mk earth'), direction: sky.earthDir, dy: -26 };
  const projected = new THREE.Vector3();
  function updateLabels() {
    sunLabel.el.textContent = sky.sunText;
    earthLabel.el.textContent = sky.earthText;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    for (const label of [...compassLabels, sunLabel, earthLabel]) {
      projected.copy(label.direction).multiplyScalar(1000).add(camera.position).project(camera);
      const visible = projected.z < 1 && Math.abs(projected.x) < 1.02 && Math.abs(projected.y) < 1.02;
      label.el.style.visibility = visible ? 'visible' : 'hidden';
      if (visible) {
        const x = (projected.x * 0.5 + 0.5) * w;
        const y = (-projected.y * 0.5 + 0.5) * h + label.dy;
        label.el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -50%)`;
      }
    }
  }

  // ---- Rendering (only when something changed) ---------------------------------------------------------
  let queued = false;
  function requestRender() {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      sunDisc.lookAt(camera.position);
      sunHalo.lookAt(camera.position);
      renderer.render(scene, camera);
      updateLabels();
    });
  }

  placeCamera();
  return { setTerrain, setSky, setPaths, setLook, setPosition, setEyeHeight, setLens, getLens: () => lens.id, probe, getLook: () => ({ ...look }), resize, requestRender };
}
