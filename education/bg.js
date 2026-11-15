// The page backdrop: the same Moon as the explorer's home page (LRO colour map, LOLA relief, a
// latitude/longitude grid and teal glows at the landing sites), turning slowly behind everything.
// In the hero it sits on the right; as you scroll it moves to the centre and dims, so text stays readable.
import * as THREE from 'three';
import { layerTexture } from './layers.js';

const canvas = document.getElementById('bg');
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const renderer = new THREE.WebGLRenderer({canvas, antialias: true, alpha: true, powerPreference: 'low-power'});
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 200);
camera.position.set(0, 0, 4.3);
const DEG = Math.PI / 180;

function upAt(lat, lon, r = 1) {
    const p = lat * DEG;
    const l = lon * DEG;
    return new THREE.Vector3(r * Math.cos(p) * Math.cos(l), r * Math.sin(p), -r * Math.cos(p) * Math.sin(l));
}

// Tilt the south pole a little toward the viewer, then turn the near side to face us.
const tilt = new THREE.Group();
tilt.rotation.x = -0.32;
scene.add(tilt);
const spin = new THREE.Group();
spin.rotation.y = -Math.PI / 2 + 0.25;
tilt.add(spin);

const material = new THREE.MeshStandardMaterial({color: 0x8a8a8a, roughness: 1, metalness: 0});
const moon = new THREE.Mesh(new THREE.SphereGeometry(1, 192, 96), material);
spin.add(moon);
/** Recolour the background Moon: 'photo', 'elevation' or 'heat' (see layers.js). */
export async function setBgLayer(kind) {
    const t = await layerTexture(kind);
    if (t) {
        material.map = t;
        material.color.set(0xffffff);
        material.needsUpdate = true;
    }
}
setBgLayer('photo');
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
    tex.needsUpdate = true;
    material.bumpMap = tex;
    material.bumpScale = 2.5;
    material.needsUpdate = true;
}).catch(() => {});

// Latitude/longitude grid every 30 degrees; the equator a little brighter.
const gridPts = [];
const eqPts = [];
for (let lon = -180; lon < 180; lon += 30) {
    for (let lat = -90; lat < 90; lat += 3) {
        gridPts.push(upAt(lat, lon, 1.003), upAt(lat + 3, lon, 1.003));
    }
}
for (const lat of [-60, -30, 30, 60]) {
    for (let lon = -180; lon < 180; lon += 3) {
        gridPts.push(upAt(lat, lon, 1.003), upAt(lat, lon + 3, 1.003));
    }
}
for (let lon = -180; lon < 180; lon += 3) {
    eqPts.push(upAt(0, lon, 1.003), upAt(0, lon + 3, 1.003));
}
spin.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(gridPts),
    new THREE.LineBasicMaterial({color: 0xbfe9df, transparent: true, opacity: 0.16, depthWrite: false})));
spin.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(eqPts),
    new THREE.LineBasicMaterial({color: 0x4fe3c1, transparent: true, opacity: 0.45, depthWrite: false})));

// Teal glows at the landing sites (data/sites.json).
function glowTexture() {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const g = c.getContext('2d');
    const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    grad.addColorStop(0, 'rgba(160,255,232,0.95)');
    grad.addColorStop(0.25, 'rgba(79,227,193,0.45)');
    grad.addColorStop(1, 'rgba(79,227,193,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 128, 128);
    return new THREE.CanvasTexture(c);
}
const glowMap = glowTexture();
fetch('/data/sites.json').then(r => r.json()).then(j => {
    for (const s of j.sites) {
        // South-pole sites sit close together, so their glows are smaller and fainter (they add up).
        const pole = s.category === 'south-pole';
        const sprite = new THREE.Sprite(new THREE.SpriteMaterial({map: glowMap, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: pole ? 0.32 : 0.8}));
        sprite.position.copy(upAt(s.lat, s.lon, 1.01));
        sprite.scale.setScalar(pole ? 0.09 : 0.11);
        spin.add(sprite);
    }
}).catch(() => {});

// Stars.
const starPos = new Float32Array(1800 * 3);
for (let i = 0; i < 1800; i++) {
    const v = new THREE.Vector3().randomDirection().multiplyScalar(60 + Math.random() * 30);
    starPos.set([v.x, v.y, v.z], i * 3);
}
const starGeo = new THREE.BufferGeometry();
starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
scene.add(new THREE.Points(starGeo, new THREE.PointsMaterial({color: 0xc9d2dc, size: 1.3, sizeAttenuation: false, transparent: true, opacity: 0.7, depthWrite: false})));

// Sunlight from the right, so the terminator falls across the left limb as on the explorer's home page.
scene.add(new THREE.AmbientLight(0xffffff, 0.06));
const sun = new THREE.DirectionalLight(0xffffff, 3.1);
sun.position.set(4, 1.2, 2.2);
scene.add(sun);

let W = 1;
let H = 1;
let progress = 0; // 0 in the hero, 1 once you have scrolled past it

function resize() {
    W = window.innerWidth;
    H = window.innerHeight;
    renderer.setSize(W, H, false);
    camera.aspect = W / H;
    camera.updateProjectionMatrix();
    place();
}

function place() {
    const wide = W > 900;
    // Hero: the Moon on the right (like the explorer's home page). Below the hero: centred and dimmed.
    const shift = wide ? -W * 0.22 * (1 - progress) : 0;
    camera.setViewOffset(W, H, shift, -H * 0.02, W, H);
    camera.position.z = 4.3 + progress * 0.9;
    canvas.style.opacity = String(1 - 0.72 * progress);
    document.documentElement.classList.toggle('past-hero', progress > 0.5);
}

window.addEventListener('resize', resize);
window.addEventListener('scroll', () => {
    const p = Math.min(1, Math.max(0, window.scrollY / (window.innerHeight * 0.85)));
    if (Math.abs(p - progress) > 0.001) {
        progress = p;
        place();
    }
}, {passive: true});
resize();

let last = performance.now();

function frame(now) {
    requestAnimationFrame(frame);
    if (document.hidden) {
        last = now;
        return;
    }
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    if (!reduceMotion) {
        spin.rotation.y += dt * 0.025;
    }
    renderer.render(scene, camera);
}
requestAnimationFrame(frame);
