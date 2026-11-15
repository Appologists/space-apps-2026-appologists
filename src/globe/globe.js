// The 3D Moon: drag to turn, scroll to zoom, click to pick a site or any point.
// It knows nothing about scoring. main.js tells it where the Sun is and which sites to draw,
// and it reports clicks and hovers back through callbacks.
import * as THREE from 'three';
import { DEG, latLonToVec, vecToLatLon } from '../astro/coords.js';
import { moonFragmentShader, moonVertexShader } from './moon-shader.js';

const V3 = THREE.Vector3;

// Moon-fixed [X, Y, Z] (see astro/coords.js) to the mesh's local frame: x = X, y = Z (north up), z = −Y.
// This matches THREE.SphereGeometry's texture mapping for a map centred on 0° longitude.
const toLocal = (v, r = 1) => new V3(v[0], v[2], -v[1]).multiplyScalar(r);
const localOf = (lat, lon, r = 1) => toLocal(latLonToVec(lat, lon), r);
const latLonOfLocal = (v) => vecToLatLon([v.x, -v.z, v.y]);

const COLORS = {
  north: '#ff5a4f',
  south: '#35c8ff',
  near: '#8fa6ff',
  far: '#e0a35c',
  sun: '#ffd36b',
  earth: '#5aa8ff',
};

/**
 * @param {Object} options
 * @param {HTMLCanvasElement} options.canvas
 * @param {HTMLElement} options.stage     element the canvas fills; used for sizing
 * @param {HTMLElement} options.labelsEl  overlay for text labels
 * @param {HTMLElement} options.tipEl     tooltip element
 * @param {string} options.textureUrl
 * @param {(pick: {siteId?: string, lat: number, lon: number}) => void} [options.onPick]
 * @param {(pick: {siteId?: string, lat: number, lon: number}) => void} [options.onDoublePick]
 * @param {(message: string|null) => void} [options.onStatus]
 */
export function createGlobe({ canvas, stage, labelsEl, tipEl, textureUrl, onPick, onDoublePick, onStatus }) {
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setClearColor(0x000000, 0);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(32, 1, 0.005, 100);
  const moon = new THREE.Group();
  scene.add(moon);

  const uniforms = {
    map: { value: null },
    hasMap: { value: 0 },
    sunDir: { value: new V3(1, 0, 0) },
    useSun: { value: 1 },
    night: { value: 0.05 },
    tintAmt: { value: 0.22 },
    nearTint: { value: new THREE.Color(COLORS.near) },
    farTint: { value: new THREE.Color(COLORS.far) },
    showGrid: { value: 1 },
    capFill: { value: 0.22 },
    northCol: { value: new THREE.Color(COLORS.north) },
    southCol: { value: new THREE.Color(COLORS.south) },
  };
  moon.add(
    new THREE.Mesh(
      new THREE.SphereGeometry(1, 256, 128),
      new THREE.ShaderMaterial({ uniforms, vertexShader: moonVertexShader, fragmentShader: moonFragmentShader }),
    ),
  );

  // Pole rods along the spin axis. Hidden in close-ups, where they would cover the sites at the pole.
  const rods = new THREE.Group();
  moon.add(rods);
  for (const [sign, color] of [[1, COLORS.north], [-1, COLORS.south]]) {
    const mat = new THREE.MeshBasicMaterial({ color });
    const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.007, 0.007, 0.2, 12), mat);
    rod.position.y = sign * 1.1;
    const tip = new THREE.Mesh(new THREE.SphereGeometry(0.022, 16, 12), mat);
    tip.position.y = sign * 1.2;
    rods.add(rod, tip);
  }
  const ROD_MAX_ZOOM = 2.5;

  // ---- Flat markers that lie on the surface -------------------------------------------------
  const discGeometry = new THREE.CircleGeometry(1, 32);
  const ringGeometry = new THREE.RingGeometry(1.45, 1.85, 48);
  function makeMarker(fill, ring, size) {
    const group = new THREE.Group();
    const disc = new THREE.Mesh(discGeometry, new THREE.MeshBasicMaterial({ color: fill }));
    const halo = new THREE.Mesh(ringGeometry, new THREE.MeshBasicMaterial({ color: ring }));
    group.add(disc, halo);
    group.userData.size = size;
    moon.add(group);
    return group;
  }
  function placeOnSurface(obj, local, lift = 1.004) {
    const n = local.clone().normalize();
    obj.position.copy(n).multiplyScalar(lift);
    obj.quaternion.setFromUnitVectors(new V3(0, 0, 1), n);
  }
  const sunMarker = makeMarker(COLORS.sun, '#2a2210', 0.016);
  const earthMarker = makeMarker(COLORS.earth, '#ffffff', 0.014);

  // Pin for the selected site.
  const pin = new THREE.Group();
  {
    const white = new THREE.MeshBasicMaterial({ color: 0xffffff });
    pin.add(new THREE.Mesh(new THREE.RingGeometry(0.02, 0.026, 40), white));
    const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.003, 0.003, 0.08, 8), white);
    stick.rotation.x = Math.PI / 2;
    stick.position.z = 0.04;
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.011, 12, 8), white);
    head.position.z = 0.08;
    pin.add(stick, head);
    pin.visible = false;
    moon.add(pin);
  }

  new THREE.TextureLoader().load(
    textureUrl,
    (texture) => {
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
      uniforms.map.value = texture;
      uniforms.hasMap.value = 1;
      onStatus?.(null);
      requestRender();
    },
    undefined,
    () => onStatus?.('The Moon map did not load, so only the grid is shown.'),
  );

  // ---- Camera ---------------------------------------------------------------------------------
  const MAX_ZOOM = 40;
  let zoom = 1;
  function updateCamera() {
    const v = (camera.fov / 2) * DEG;
    const h = Math.atan(Math.tan(v) * camera.aspect);
    const fitDistance = 1.3 / Math.sin(Math.min(v, h));
    camera.position.set(0, 0, 1 + (fitDistance - 1) / zoom);
    camera.lookAt(0, 0, 0);
    camera.updateProjectionMatrix();
  }
  function setZoom(z) {
    zoom = THREE.MathUtils.clamp(z, 0.8, MAX_ZOOM);
    if (animation) {
      animation.zoomFrom = animation.zoomTo = zoom; // a manual zoom wins over a turn in progress
      animation.zoomMid = null;
    }
    updateCamera();
    requestRender();
  }
  // Sized to the canvas, not the stage: on the Regions step the canvas shares the stage with the finder's map.
  function resize() {
    const rect = canvas.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) return;
    renderer.setSize(rect.width, rect.height, false);
    camera.aspect = rect.width / Math.max(rect.height, 1);
    updateCamera();
    requestRender();
  }
  new ResizeObserver(resize).observe(canvas);

  // ---- Orientation ------------------------------------------------------------------------------
  /** Rotation that puts (lat, lon) at the centre of the view with `upLocal` pointing up the screen. */
  function quatFacing(lat, lon, upLocal = new V3(0, 1, 0)) {
    const centre = localOf(lat, lon);
    let up = upLocal.clone().addScaledVector(centre, -upLocal.dot(centre));
    if (up.lengthSq() < 1e-8) up = localOf(0, lon + 180);
    up.normalize();
    const right = up.clone().cross(centre);
    return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(right, up, centre)).invert();
  }
  let animation = null;
  /**
   * Turn (and zoom) the Moon to a new orientation. Resolves when the motion ends (or is cut short by the user).
   * `arc`: on a long turn, pull back a little in the middle and come in again, as a camera would fly.
   */
  function animateTo(quaternion, targetZoom = zoom, { duration = 750, arc = false } = {}) {
    animation?.done?.();
    if (reduceMotion) {
      moon.quaternion.copy(quaternion);
      setZoom(targetZoom);
      return Promise.resolve();
    }
    const from = moon.quaternion.clone();
    const angle = 2 * Math.acos(Math.min(1, Math.abs(from.dot(quaternion)))); // radians turned
    // Pull back to at most this zoom mid-way: more for a longer turn, never further out than the whole Moon.
    const zoomMid = arc && angle > 0.2 ? Math.min(zoom, targetZoom, THREE.MathUtils.lerp(Math.min(zoom, targetZoom), 1, Math.min(angle / Math.PI, 1))) : null;
    return new Promise((resolve) => {
      animation = { from, to: quaternion, zoomFrom: zoom, zoomTo: targetZoom, zoomMid, t0: performance.now(), duration, done: resolve };
      requestRender();
    });
  }
  const VIEWS = {
    near: () => animateTo(quatFacing(0, 0), 1),
    far: () => animateTo(quatFacing(0, 180), 1),
    north: () => animateTo(quatFacing(90, 0, localOf(0, 180)), 1), // 0° longitude at the bottom, like a polar map
    south: () => animateTo(quatFacing(-90, 0, localOf(0, 0)), 1), // 0° longitude at the top
    southClose: () => animateTo(quatFacing(-90, 0, localOf(0, 0)), 6),
  };

  // ---- Labels (HTML over the canvas) ----------------------------------------------------------
  const labels = [];
  function addLabel(text, local, className, dy = 0) {
    const el = document.createElement('div');
    el.className = `lbl ${className}`;
    el.textContent = text;
    labelsEl.appendChild(el);
    const label = { el, local, dy };
    labels.push(label);
    return label;
  }
  function removeLabel(label) {
    label.el.remove();
    labels.splice(labels.indexOf(label), 1);
  }
  const poleLabels = [addLabel('N', new V3(0, 1.2, 0), 'pole north', -16), addLabel('S', new V3(0, -1.2, 0), 'pole south', 16)];
  for (const [lon, text] of [[0, '0°'], [90, '90° E'], [180, '180°'], [-90, '90° W']]) {
    addLabel(text, localOf(-2.5, lon, 1.01), 'mer', 7);
  }
  const sunLabel = addLabel('Sun overhead', new V3(1.02, 0, 0), 'mk sun', -16);
  const earthLabel = addLabel('Earth overhead', new V3(1.02, 0, 0), 'mk earth', -16);

  /** Is the unit sphere between the camera and this world-space point? */
  function occluded(world) {
    const origin = camera.position;
    const dir = world.clone().sub(origin);
    const length = dir.length();
    dir.divideScalar(length);
    const b = origin.dot(dir);
    const disc = b * b - (origin.dot(origin) - 1);
    if (disc < 0) return false;
    const t = -b - Math.sqrt(disc);
    return t > 0 && t < length - 1e-4;
  }
  const projected = new V3();
  /** Screen position (CSS pixels inside the stage) of a local point, or null if it is hidden. */
  function screenOf(local) {
    const world = local.clone().applyQuaternion(moon.quaternion);
    if (occluded(world) || world.distanceTo(camera.position) < 0.02) return null;
    projected.copy(world).project(camera);
    if (projected.z > 1) return null;
    return { x: (projected.x * 0.5 + 0.5) * canvas.clientWidth, y: (-projected.y * 0.5 + 0.5) * canvas.clientHeight };
  }
  function updateLabels() {
    for (const label of labels) {
      const p = label.off || (poleLabels.includes(label) && zoom > ROD_MAX_ZOOM) ? null : screenOf(label.local);
      if (!p) {
        label.el.style.visibility = 'hidden';
        continue;
      }
      label.el.style.visibility = 'visible';
      label.el.style.transform = `translate(${p.x.toFixed(1)}px, ${(p.y + label.dy).toFixed(1)}px) translate(-50%, -50%)`;
    }
  }

  // ---- Sites ------------------------------------------------------------------------------------
  /** @type {{site: any, marker: THREE.Group, local: THREE.Vector3, label: any}[]} */
  let siteEntries = [];
  let selectedId = null;
  // The mission steps' regions (src/ui/flow.js). While there are any, they are drawn instead of the sites.
  /** @type {{site: any, marker: THREE.Group, local: THREE.Vector3, label: any}[]} */
  let regionEntries = [];
  let onRegionPick = null;

  /**
   * Replace the site markers.
   * @param {{id: string, name: string, lat: number, lon: number, color: string, label?: string}[]} sites
   *        `label`, when given, is drawn next to the marker (used for the top-ranked sites).
   */
  function setSites(sites) {
    for (const entry of siteEntries) {
      moon.remove(entry.marker);
      entry.marker.children.forEach((child) => child.material.dispose());
      if (entry.label) removeLabel(entry.label);
    }
    siteEntries = sites.map((site) => {
      const local = localOf(site.lat, site.lon);
      const marker = makeMarker(site.color, '#0b0f15', 0.0085);
      placeOnSurface(marker, local, 1.003);
      const label = site.label ? addLabel(site.label, local.clone().multiplyScalar(1.01), 'site', -15) : null;
      return { site, marker, local, label };
    });
    showSites(regionEntries.length === 0);
    setSelected(selectedId);
  }
  function showSites(on) {
    for (const entry of siteEntries) {
      entry.marker.visible = on;
      if (entry.label) entry.label.off = !on;
    }
  }
  /** The pin marks the chosen region while regions are shown, otherwise the selected site. */
  function placePin() {
    const entry = regionEntries.length ? regionEntries.find((e) => e.site.selected) : siteEntries.find((e) => e.site.id === selectedId);
    pin.visible = !!entry;
    if (entry) placeOnSurface(pin, entry.local, 1.002);
    requestRender();
  }
  function setSelected(id) {
    selectedId = id;
    placePin();
  }

  /**
   * Markers for the mission's regions, drawn instead of the site markers; an empty list brings the sites back.
   * While regions are shown, a tap on one calls `onPick(id)` and taps elsewhere on the Moon do nothing.
   * @param {{id: string, name: string, lat: number, lon: number, color: string, selected?: boolean, label?: boolean}[]} regions
   *        `label: false` draws the marker without its name.
   * @param {{onPick?: (id: string) => void}} [options]
   */
  function setRegions(regions, { onPick: pick = null } = {}) {
    for (const entry of regionEntries) {
      moon.remove(entry.marker);
      entry.marker.children.forEach((child) => child.material.dispose());
      if (entry.label) removeLabel(entry.label);
    }
    regionEntries = regions.map((region) => {
      const local = localOf(region.lat, region.lon);
      const marker = makeMarker(region.color, '#0b0f15', 0.009);
      placeOnSurface(marker, local, 1.003);
      const label = region.label === false ? null : addLabel(region.name, local.clone().multiplyScalar(1.01), `site region-lbl${region.selected ? ' on' : ''}`, -18);
      return { site: region, marker, local, label };
    });
    onRegionPick = pick;
    showSites(regionEntries.length === 0);
    placePin();
  }
  /** Turn the globe so a point faces the viewer, north up where that makes sense. */
  function focus(lat, lon, targetZoom) {
    const nearPole = Math.abs(lat) > 80;
    // Sites crowd together at the poles and sit under the pole rod, so go to a close-up there.
    targetZoom ??= nearPole ? Math.max(zoom, 6) : zoom;
    const up = nearPole ? localOf(0, lat < 0 ? 0 : 180) : new V3(0, 1, 0);
    return animateTo(quatFacing(lat, lon, up), targetZoom);
  }
  /**
   * Fly to a point: turn it to face the viewer and zoom right in, pulling back mid-way on a long turn.
   * @returns {Promise<void>} resolves when the camera arrives
   */
  function flyTo(lat, lon, targetZoom = MAX_ZOOM, duration = 1900) {
    const nearPole = Math.abs(lat) > 80;
    const up = nearPole ? localOf(0, lat < 0 ? 0 : 180) : new V3(0, 1, 0);
    return animateTo(quatFacing(lat, lon, up), targetZoom, { duration, arc: true });
  }
  /** The site marker (or, while regions are shown, the region marker) nearest the pointer, if close enough. */
  function siteNear(clientX, clientY, tolerancePx = regionEntries.length ? 18 : 11) {
    const rect = canvas.getBoundingClientRect();
    let best = null;
    for (const entry of regionEntries.length ? regionEntries : siteEntries) {
      const p = screenOf(entry.local);
      if (!p) continue;
      const d = Math.hypot(p.x - (clientX - rect.left), p.y - (clientY - rect.top));
      if (d <= tolerancePx && (!best || d < best.d)) best = { entry, d };
    }
    return best?.entry ?? null;
  }

  // ---- Sun and Earth ----------------------------------------------------------------------------
  /** @param {number[]} sunKm  @param {number[]} earthKm  Moon-fixed vectors from the Moon's centre */
  function setSunEarth(sunKm, earthKm) {
    const sunLocal = toLocal(sunKm).normalize();
    const earthLocal = toLocal(earthKm).normalize();
    uniforms.sunDir.value.copy(sunLocal);
    placeOnSurface(sunMarker, sunLocal);
    placeOnSurface(earthMarker, earthLocal);
    sunLabel.local.copy(sunLocal).multiplyScalar(1.02);
    earthLabel.local.copy(earthLocal).multiplyScalar(1.02);
    requestRender();
  }

  // ---- Picking and dragging ---------------------------------------------------------------------
  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  /** Point on the unit sphere under the cursor (world space); off the disc, the nearest point on the limb. */
  function spherePointAt(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    ndc.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
    const o = raycaster.ray.origin;
    const d = raycaster.ray.direction;
    const b = o.dot(d);
    const disc = b * b - (o.dot(o) - 1);
    if (disc >= 0) return { point: o.clone().addScaledVector(d, -b - Math.sqrt(disc)), hit: true };
    return { point: o.clone().addScaledVector(d, -b).normalize(), hit: false };
  }
  const worldToLocal = (p) => p.clone().applyQuaternion(moon.quaternion.clone().invert());

  const pointers = new Map();
  let drag = null;
  let pinch = null;
  canvas.addEventListener('pointerdown', (e) => {
    canvas.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    animation?.done?.();
    animation = null;
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinch = { d0: Math.hypot(a.x - b.x, a.y - b.y), z0: zoom };
      drag = null;
      return;
    }
    const sp = spherePointAt(e.clientX, e.clientY);
    drag = { p0: sp.point.normalize(), q0: moon.quaternion.clone(), x0: e.clientX, y0: e.clientY, moved: 0, hit: sp.hit };
    canvas.classList.add('dragging');
    tipEl.hidden = true;
  });
  canvas.addEventListener('pointermove', (e) => {
    if (pointers.has(e.pointerId)) pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch && pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      setZoom((pinch.z0 * Math.hypot(a.x - b.x, a.y - b.y)) / Math.max(pinch.d0, 1));
      return;
    }
    if (drag) {
      drag.moved = Math.max(drag.moved, Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0));
      if (drag.moved < 3) return;
      // Keep the grabbed point under the cursor.
      const p1 = spherePointAt(e.clientX, e.clientY).point.normalize();
      moon.quaternion.copy(new THREE.Quaternion().setFromUnitVectors(drag.p0, p1).multiply(drag.q0));
      requestRender();
      return;
    }
    hover(e);
  });
  function endPointer(e) {
    pointers.delete(e.pointerId);
    if (pinch) {
      if (pointers.size < 2) pinch = null;
      return;
    }
    if (drag && drag.moved < 5 && e.type === 'pointerup' && regionEntries.length) {
      const entry = siteNear(e.clientX, e.clientY);
      if (entry) onRegionPick?.(entry.site.id);
    } else if (drag && drag.moved < 5 && e.type === 'pointerup') {
      const entry = siteNear(e.clientX, e.clientY);
      if (entry) onPick?.({ siteId: entry.site.id, lat: entry.site.lat, lon: entry.site.lon });
      else if (drag.hit) onPick?.(latLonOfLocal(worldToLocal(spherePointAt(e.clientX, e.clientY).point)));
    }
    drag = null;
    canvas.classList.remove('dragging');
  }
  canvas.addEventListener('pointerup', endPointer);
  canvas.addEventListener('dblclick', (e) => {
    if (regionEntries.length) return; // regions are chosen with a single tap
    const entry = siteNear(e.clientX, e.clientY);
    if (entry) return onDoublePick?.({ siteId: entry.site.id, lat: entry.site.lat, lon: entry.site.lon });
    const sp = spherePointAt(e.clientX, e.clientY);
    if (sp.hit) onDoublePick?.(latLonOfLocal(worldToLocal(sp.point)));
  });
  canvas.addEventListener('pointercancel', endPointer);
  canvas.addEventListener('pointerleave', () => {
    if (!drag) tipEl.hidden = true;
  });

  function hover(e) {
    if (e.pointerType !== 'mouse') return;
    const entry = siteNear(e.clientX, e.clientY);
    const sp = spherePointAt(e.clientX, e.clientY);
    if (!entry && !sp.hit) {
      tipEl.hidden = true;
      canvas.style.cursor = '';
      return;
    }
    const ll = entry ? entry.site : latLonOfLocal(worldToLocal(sp.point));
    const coords = `${Math.abs(ll.lat).toFixed(2)}° ${ll.lat >= 0 ? 'N' : 'S'}, ${Math.abs(ll.lon).toFixed(2)}° ${ll.lon >= 0 ? 'E' : 'W'}`;
    tipEl.textContent = entry ? `${entry.site.name} · ${coords}` : coords;
    tipEl.hidden = false;
    canvas.style.cursor = entry ? 'pointer' : '';
    const rect = stage.getBoundingClientRect();
    const x = Math.min(e.clientX - rect.left + 14, rect.width - tipEl.offsetWidth - 6);
    tipEl.style.transform = `translate(${x}px, ${e.clientY - rect.top + 16}px)`;
  }

  canvas.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      setZoom(zoom * Math.exp(-e.deltaY * 0.0015));
    },
    { passive: false },
  );
  canvas.addEventListener('keydown', (e) => {
    const step = (6 * DEG) / Math.sqrt(zoom);
    const turn = { ArrowLeft: [0, 1, 0, -step], ArrowRight: [0, 1, 0, step], ArrowUp: [1, 0, 0, -step], ArrowDown: [1, 0, 0, step] }[e.key];
    if (turn) {
      e.preventDefault();
      moon.quaternion.premultiply(new THREE.Quaternion().setFromAxisAngle(new V3(turn[0], turn[1], turn[2]), turn[3]));
      requestRender();
    } else if (e.key === '+' || e.key === '=') setZoom(zoom * 1.25);
    else if (e.key === '-' || e.key === '_') setZoom(zoom / 1.25);
  });

  // ---- Render loop (draws only when something changed) -------------------------------------------
  let needsRender = true;
  function requestRender() {
    needsRender = true;
  }
  function frame(now) {
    requestAnimationFrame(frame);
    if (animation) {
      const k = Math.min((now - animation.t0) / animation.duration, 1);
      const eased = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
      moon.quaternion.slerpQuaternions(animation.from, animation.to, eased);
      const { zoomFrom, zoomTo, zoomMid } = animation;
      if (zoomMid) {
        // Log-space path through the pulled-back zoom: out over the first part of the turn, then in.
        const lz = Math.log(zoomFrom) * (1 - eased) * (1 - eased) + 2 * Math.log(zoomMid) * eased * (1 - eased) + Math.log(zoomTo) * eased * eased;
        zoom = Math.exp(lz);
      } else zoom = zoomFrom * Math.pow(zoomTo / zoomFrom, eased);
      updateCamera();
      if (k >= 1) {
        const finished = animation.done;
        animation = null;
        finished?.();
      }
      needsRender = true;
    }
    if (!needsRender) return;
    needsRender = false;
    // Keep markers a sensible size on screen as you zoom in.
    const markerScale = 1 / Math.sqrt(zoom);
    for (const entry of [...siteEntries, ...regionEntries]) entry.marker.scale.setScalar(entry.marker.userData.size * markerScale);
    sunMarker.scale.setScalar(sunMarker.userData.size * markerScale);
    earthMarker.scale.setScalar(earthMarker.userData.size * markerScale);
    pin.scale.setScalar(markerScale);
    rods.visible = zoom <= ROD_MAX_ZOOM;
    uniforms.capFill.value = 0.22 * THREE.MathUtils.clamp((4 - zoom) / 2, 0, 1);
    renderer.render(scene, camera);
    updateLabels();
  }

  moon.quaternion.copy(quatFacing(-55, 20));
  resize();
  requestAnimationFrame(frame);

  return {
    setSunEarth,
    setSites,
    setSelected,
    setRegions,
    focus,
    flyTo,
    getZoom: () => zoom,
    view: (name) => VIEWS[name]?.(),
    zoomBy: (factor) => setZoom(zoom * factor),
    setOption(name, on) {
      if (name === 'sunlight') uniforms.useSun.value = on ? 1 : 0;
      else if (name === 'tint') uniforms.tintAmt.value = on ? 0.22 : 0;
      else if (name === 'grid') uniforms.showGrid.value = on ? 1 : 0;
      else if (name === 'labels') labelsEl.hidden = !on;
      requestRender();
    },
    /** For tests and debugging from the browser console. */
    debug: { screenOf: (lat, lon) => screenOf(localOf(lat, lon)), getZoom: () => zoom },
  };
}
