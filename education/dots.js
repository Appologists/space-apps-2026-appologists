// Facts in 3D: one cloud of dots that re-forms into a model of each fact. Few words, one number each.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const N = 6000;
const FACT_SRC = {
    moon: 'https://science.nasa.gov/moon/facts/',
    sun: 'https://science.nasa.gov/sun/facts/',
};
const C = {
    earth: [0.35, 0.66, 1.0],
    moon: [0.85, 0.85, 0.85],
    sun: [1.0, 0.72, 0.3],
    ghost: [0.22, 0.38, 0.6],
    hot: [1.0, 0.55, 0.2],
    cold: [0.3, 0.55, 1.0],
    off: [0, 0, 0],
};

/** Points spread evenly over a sphere (Fibonacci lattice). */
function sphere(count, r, cx = 0, cy = 0, cz = 0) {
    const out = [];
    const golden = Math.PI * (3 - Math.sqrt(5));
    for (let i = 0; i < count; i++) {
        const y = 1 - (2 * (i + 0.5)) / count;
        const rad = Math.sqrt(1 - y * y);
        const a = i * golden;
        out.push([cx + r * rad * Math.cos(a), cy + r * y, cz + r * rad * Math.sin(a)]);
    }
    return out;
}

function fill(list, color) {
    return list.map(p => ({p, c: color}));
}

// Each scene: the dots it uses (position + colour), a camera distance, and its few words.
const SCENES = [
    {
        id: 'distance', big: '30', line: 'Earths fit between Earth and the Moon', src: FACT_SRC.moon, cam: 7.5,
        build() {
            const er = 0.12;
            const step = 2 * er;
            const x0 = -15 * step;
            const dots = fill(sphere(1300, er, x0 - step, 0, 0), C.earth);
            for (let k = 0; k < 30; k++) {
                dots.push(...fill(sphere(130, er * 0.92, x0 + k * step + er, 0, 0), C.ghost));
            }
            dots.push(...fill(sphere(450, er * 0.273, x0 + 30 * step + er + 0.05, 0, 0), C.moon));
            return dots;
        },
    },
    {
        id: 'sun', big: '109', line: 'Earths fit across the Sun', src: FACT_SRC.sun, cam: 7,
        build() {
            const R = 2.4;
            const dots = fill(sphere(4700, R), C.sun);
            for (let k = 0; k < 109; k++) {
                const x = -R + (2 * R * (k + 0.5)) / 109;
                dots.push(...fill(sphere(6, R / 109, x, 0, R + 0.02), C.earth));
            }
            return dots;
        },
    },
    {
        id: 'temp', big: '300 °C', line: 'swing between lunar day and night', src: FACT_SRC.moon, cam: 5.2,
        build() {
            // Colour by a simple model: hot where the Sun is high, cold on the night side.
            return sphere(5600, 1.4).map(p => {
                const sunUp = p[0] / 1.4;
                const t = sunUp > 0 ? Math.pow(sunUp, 0.25) : 0;
                const c = C.cold.map((v, i) => v + (C.hot[i] - v) * t);
                return {p, c};
            });
        },
    },
    {
        id: 'gravity', big: '1/6', line: 'of Earth\'s gravity: jumps go 6\u00d7 higher', src: FACT_SRC.moon, cam: 7,
        build() {
            const dots = [];
            const arc = (height, range, count, color) => {
                for (let i = 0; i < count; i++) {
                    const f = i / (count - 1);
                    const x = -range / 2 + f * range;
                    const y = -1.4 + 4 * height * f * (1 - f);
                    dots.push({p: [x, y, 0], c: color});
                }
            };
            arc(0.45, 0.9, 260, C.earth);
            arc(2.7, 5.4, 900, C.moon);
            for (let i = 0; i < 700; i++) {
                dots.push({p: [-3.2 + (6.4 * i) / 699, -1.42, 0], c: [0.25, 0.25, 0.25]});
            }
            return dots;
        },
    },
    {
        id: 'light', big: '1.3 s', line: 'for light to travel from the Moon to Earth', src: FACT_SRC.moon, cam: 7.5,
        build() {
            const dots = fill(sphere(1400, 0.5, -2.9, 0, 0), C.earth);
            dots.push(...fill(sphere(500, 0.136, 2.9, 0, 0), C.moon));
            for (let i = 0; i < 400; i++) {
                dots.push({p: [2.75 - (5.2 * i) / 399, 0, 0], c: [0.9, 0.85, 0.5], pulse: i / 399});
            }
            return dots;
        },
    },
];

export function createDots(container, caption) {
    const renderer = new THREE.WebGLRenderer({antialias: true, alpha: true});
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    container.prepend(renderer.domElement);
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 100);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enablePan = false;
    controls.enableZoom = false;
    controls.enableDamping = true;
    controls.autoRotate = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    controls.autoRotateSpeed = 0.6;

    const pos = new Float32Array(N * 3);
    const col = new Float32Array(N * 3);
    const from = new Float32Array(N * 3);
    const to = new Float32Array(N * 3);
    const colFrom = new Float32Array(N * 3);
    const colTo = new Float32Array(N * 3);
    for (let i = 0; i < N * 3; i++) {
        pos[i] = (Math.random() - 0.5) * 12;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const points = new THREE.Points(geo, new THREE.PointsMaterial({size: 0.035, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending}));
    scene.add(points);

    let current = 0;
    let t = 1;
    let camFrom = 7;
    let camTo = 7;
    let pulse = [];

    function show(k) {
        current = (k + SCENES.length) % SCENES.length;
        const s = SCENES[current];
        const dots = s.build();
        from.set(pos);
        colFrom.set(col);
        pulse = [];
        for (let i = 0; i < N; i++) {
            const d = dots[i];
            if (d) {
                to.set(d.p, i * 3);
                colTo.set(d.c, i * 3);
                if (d.pulse !== undefined) {
                    pulse.push([i, d.pulse]);
                }
            } else {
                // Spare dots fade out where they are.
                to.set([pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]], i * 3);
                colTo.set(C.off, i * 3);
            }
        }
        camFrom = camera.position.length();
        camTo = s.cam;
        t = 0;
        caption(s, current, SCENES.length);
    }

    function resize() {
        const r = container.getBoundingClientRect();
        renderer.setSize(r.width, r.height, false);
        camera.aspect = r.width / Math.max(r.height, 1);
        camera.updateProjectionMatrix();
    }
    new ResizeObserver(resize).observe(container);
    camera.position.set(0, 1.2, 7);
    resize();

    let visible = true;
    new IntersectionObserver(e => {
        visible = e[0].isIntersecting;
    }).observe(container);

    let last = performance.now();
    let since = 0;
    function frame(now) {
        requestAnimationFrame(frame);
        const dt = Math.min(0.1, (now - last) / 1000);
        last = now;
        if (!visible || document.hidden) {
            return;
        }
        if (t < 1) {
            t = Math.min(1, t + dt / 1.4);
            const e = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
            for (let i = 0; i < N * 3; i++) {
                pos[i] = from[i] + (to[i] - from[i]) * e;
                col[i] = colFrom[i] + (colTo[i] - colFrom[i]) * e;
            }
            const len = camFrom + (camTo - camFrom) * e;
            camera.position.setLength(len);
            geo.attributes.position.needsUpdate = true;
            geo.attributes.color.needsUpdate = true;
        } else if (pulse.length) {
            // Light scene: a bright packet runs from the Moon to Earth, once every 1.3 s.
            const phase = (now / 1300) % 1;
            for (const [i, f] of pulse) {
                const b = Math.max(0.12, 1 - Math.abs(f - phase) * 14);
                col[i * 3] = 0.95 * b;
                col[i * 3 + 1] = 0.9 * b;
                col[i * 3 + 2] = 0.55 * b;
            }
            geo.attributes.color.needsUpdate = true;
        }
        since += dt;
        if (since > 7 && controls.autoRotate) {
            since = 0;
            show(current + 1);
        }
        controls.update();
        renderer.render(scene, camera);
    }
    requestAnimationFrame(frame);
    show(0);
    return {
        show: k => {
            since = 0;
            show(k);
        },
        next: () => {
            since = 0;
            show(current + 1);
        },
        prev: () => {
            since = 0;
            show(current - 1);
        },
        count: SCENES.length,
    };
}
