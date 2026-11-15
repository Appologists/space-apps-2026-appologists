// Topics: tabbed explainers, each with a short text, key numbers, a diagram (animated or real data) and
// sources. Plus a mission timeline built from data/sites.json. Plain DOM, no innerHTML.
import { layerImage } from './layers.js';

const DEG = Math.PI / 180;

export function h(tag, attrs = {}, ...kids) {
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

const SRC = {
    moon: ['NASA Moon facts', 'https://science.nasa.gov/moon/facts/'],
    phases: ['NASA Moon phases', 'https://science.nasa.gov/moon/moon-phases/'],
    lola: ['LRO LOLA', 'https://lola.gsfc.nasa.gov/'],
    diviner: ['LRO Diviner (UCLA)', 'https://www.diviner.ucla.edu/'],
    lroc: ['LROC map (NASA SVS)', 'https://svs.gsfc.nasa.gov/4720/'],
    epic: ['NASA EPIC', 'https://epic.gsfc.nasa.gov/about'],
    sdo: ['NASA SDO', 'https://sdo.gsfc.nasa.gov/data/channels.php'],
    horizons: ['NASA/JPL Horizons', 'https://ssd.jpl.nasa.gov/horizons/'],
    lcross: ['NASA NSSDCA: LCROSS', 'https://nssdc.gsfc.nasa.gov/nmc/spacecraft/display.action?id=2009-031B'],
    challenge: ['Space Apps challenge', 'https://www.spaceappschallenge.org/2026/challenges/lunar-landing-site-navigator/'],
};

// ---------- Animated diagrams (one canvas each; drawn every frame while their tab is open) ----------
export function canvasDiagram(draw) {
    const c = h('canvas', {class: 'diagram', width: 720, height: 420});
    c.draw = draw;
    return c;
}

export function grid(g, W, H) {
    g.strokeStyle = 'rgba(255,255,255,0.05)';
    g.lineWidth = 1;
    for (let x = 0; x <= W; x += 40) {
        g.beginPath();
        g.moveTo(x, 0);
        g.lineTo(x, H);
        g.stroke();
    }
    for (let y = 0; y <= H; y += 40) {
        g.beginPath();
        g.moveTo(0, y);
        g.lineTo(W, y);
        g.stroke();
    }
}

export function label(g, text, x, y, color = '#a1a1a1', size = 18, align = 'left') {
    g.fillStyle = color;
    g.font = `${size}px Geist Mono, monospace`;
    g.textAlign = align;
    g.fillText(text, x, y);
}

// Lunar coordinates: a globe with a graticule and a point that walks to a site, reading out lat/lon.
const coordinates = canvasDiagram((g, W, H, t) => {
    const cx = 230;
    const cy = 210;
    const R = 170;
    g.fillStyle = '#121212';
    g.beginPath();
    g.arc(cx, cy, R, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = 'rgba(191,233,223,0.25)';
    for (let lat = -60; lat <= 60; lat += 30) {
        g.beginPath();
        g.ellipse(cx, cy - R * Math.sin(lat * DEG), R * Math.cos(lat * DEG), 6, 0, 0, Math.PI * 2);
        g.stroke();
    }
    for (let lon = -60; lon <= 60; lon += 30) {
        g.beginPath();
        g.ellipse(cx, cy, Math.abs(R * Math.sin(lon * DEG)), R, 0, 0, Math.PI * 2);
        g.stroke();
    }
    g.strokeStyle = '#4fe3c1';
    g.beginPath();
    g.moveTo(cx - R, cy);
    g.lineTo(cx + R, cy);
    g.stroke();
    g.beginPath();
    g.moveTo(cx, cy - R);
    g.lineTo(cx, cy + R);
    g.stroke();
    // A point moving between Apollo 11 and the south pole.
    const k = (Math.sin(t / 1600) + 1) / 2;
    const lat = 0.67 + (-89.5 - 0.67) * k;
    const lon = 23.47 * (1 - k);
    const x = cx + R * Math.cos(lat * DEG) * Math.sin(lon * DEG);
    const y = cy - R * Math.sin(lat * DEG);
    g.fillStyle = '#f5c96b';
    g.beginPath();
    g.arc(x, y, 8, 0, Math.PI * 2);
    g.fill();
    label(g, '0° lat (equator)', cx + R + 14, cy + 6, '#4fe3c1', 16);
    label(g, '0° lon (faces Earth)', cx, cy - R - 12, '#4fe3c1', 16, 'center');
    label(g, 'LATITUDE', 470, 140, '#6e6e6e', 15);
    label(g, `${Math.abs(lat).toFixed(1)}° ${lat >= 0 ? 'N' : 'S'}`, 470, 178, '#ededed', 30);
    label(g, 'LONGITUDE', 470, 240, '#6e6e6e', 15);
    label(g, `${Math.abs(lon).toFixed(1)}° ${lon >= 0 ? 'E' : 'W'}`, 470, 278, '#ededed', 30);
});

// Sunlight windows: the Sun's height over one lunar day, at the equator and near the south pole.
const sunlight = canvasDiagram((g, W, H, t) => {
    grid(g, W, H);
    const L = 60;
    const B = 360;
    const pw = W - 90;
    const yOf = el => B - el * 3.3;
    g.strokeStyle = 'rgba(255,255,255,0.35)';
    g.setLineDash([6, 6]);
    g.beginPath();
    g.moveTo(L, yOf(0));
    g.lineTo(L + pw, yOf(0));
    g.stroke();
    g.setLineDash([]);
    label(g, 'horizon', L + pw - 4, yOf(0) - 8, '#6e6e6e', 15, 'right');
    const progress = Math.min(1, ((t / 4500) % 1.25));
    const curve = (fn, color) => {
        g.strokeStyle = color;
        g.lineWidth = 4;
        g.beginPath();
        for (let i = 0; i <= 200 * progress; i++) {
            const f = i / 200;
            const x = L + f * pw;
            const y = yOf(fn(f));
            if (i === 0) {
                g.moveTo(x, y);
            } else {
                g.lineTo(x, y);
            }
        }
        g.stroke();
        g.lineWidth = 1;
    };
    // Equator: up to about 90 deg at noon, below the horizon half the time.
    curve(f => 90 * Math.sin(2 * Math.PI * (f - 0.25)) , '#f5c96b');
    // Near the south pole (89.5 S): the Sun circles about 1.5 deg either side of the horizon.
    curve(f => 0.5 + 1.5 * Math.sin(2 * Math.PI * f), '#4fe3c1');
    label(g, 'Equator', L + 12, yOf(84), '#f5c96b', 17);
    label(g, 'South pole', L + 12, yOf(-14), '#4fe3c1', 17);
    label(g, 'One lunar day ≈ 29.5 Earth days →', L, H - 18, '#6e6e6e', 15);
});

// Earth visibility and libration: Earth seen from the near side wanders a few degrees around one spot.
const libration = canvasDiagram((g, W, H, t) => {
    grid(g, W, H);
    const cx = W / 2;
    const cy = 230;
    const scale = 14;
    g.strokeStyle = 'rgba(90,168,255,0.35)';
    g.beginPath();
    g.ellipse(cx, cy, 7.9 * scale, 6.7 * scale, 0, 0, Math.PI * 2);
    g.stroke();
    const a = t / 1400;
    const x = cx + 7.9 * scale * Math.sin(a);
    const y = cy + 6.7 * scale * Math.sin(a * 1.08 + 1);
    g.fillStyle = 'rgba(90,168,255,0.2)';
    g.beginPath();
    g.arc(x, y, 44, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#5aa8ff';
    g.beginPath();
    g.arc(x, y, 28, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = '#ededed';
    g.beginPath();
    g.moveTo(cx - 10, cy);
    g.lineTo(cx + 10, cy);
    g.moveTo(cx, cy - 10);
    g.lineTo(cx, cy + 10);
    g.stroke();
    label(g, '±7.9°', cx + 7.9 * scale + 12, cy + 6, '#a1a1a1', 16);
    label(g, '±6.7°', cx, cy - 6.7 * scale - 14, '#a1a1a1', 16, 'center');
    label(g, 'Earth in the sky of a near-side site, over months', cx, H - 24, '#6e6e6e', 15, 'center');
});

// Terrain shadows: a crater cross-section with a low Sun from the right. Each column is lit only when no
// ground to its right rises above the Sun's ray. The angle is drawn 8x steeper so it can be seen.
const shadows = canvasDiagram((g, W, H, t) => {
    const ground = 300;
    const sunEl = 1.5 + 1.5 * Math.sin(t / 2000);
    const k = Math.tan(sunEl * 8 * DEG);
    const prof = x => {
        const d = Math.abs(x - 360) / 170;
        if (d > 1.25) {
            return ground;
        }
        if (d > 1) {
            return ground - 40 * (1.25 - d) / 0.25;
        }
        return ground - 40 + 150 * Math.pow(1 - d * d, 0.6);
    };
    g.fillStyle = '#1a1a1a';
    g.beginPath();
    g.moveTo(0, H);
    for (let x = 0; x <= W; x += 4) {
        g.lineTo(x, prof(x));
    }
    g.lineTo(W, H);
    g.fill();
    // Walk from the Sun side. env is the lowest the ray can reach at this column (canvas y grows downward).
    let env = Infinity;
    for (let x = W; x >= 0; x -= 4) {
        const y = prof(x);
        const lit = y <= env + 0.5;
        g.fillStyle = lit ? '#f5c96b' : '#3b5bff';
        g.fillRect(x - 2, y - 3, 4, 5);
        env = Math.min(env + 4 * k, y);
    }
    const rimX = 360 + 170;
    const rimY = prof(rimX);
    g.strokeStyle = 'rgba(245,201,107,0.55)';
    g.setLineDash([8, 8]);
    g.beginPath();
    g.moveTo(W, rimY - (W - rimX) * k);
    g.lineTo(rimX - 420, rimY + 420 * k);
    g.stroke();
    g.setLineDash([]);
    label(g, `SUN ${sunEl.toFixed(1)}\u00b0 UP`, W - 20, 40, '#f5c96b', 18, 'right');
    g.fillStyle = '#f5c96b';
    g.fillRect(20, 28, 14, 14);
    label(g, 'lit', 42, 41, '#a1a1a1', 16);
    g.fillStyle = '#3b5bff';
    g.fillRect(90, 28, 14, 14);
    label(g, 'in shadow', 112, 41, '#a1a1a1', 16);
    label(g, 'Angle drawn 8\u00d7 steeper', 20, H - 16, '#6e6e6e', 14);
});

// Elevation vs temperature: the real LOLA and Diviner maps side by side.
function realMaps() {
    const wrap = h('div', {class: 'twin'});
    for (const [kind, title, note] of [['elevation', 'ELEVATION · LOLA', 'Height above the mean radius'], ['heat', 'DAYTIME HIGH · DIVINER', 'Warmest temperature of the lunar day']]) {
        const c = h('canvas', {width: 480, height: 240});
        layerImage(kind).then(img => {
            const g = c.getContext('2d');
            if (img) {
                g.drawImage(img, 0, 0, 480, 240);
            } else {
                label(g, 'Data not on this computer', 20, 40);
            }
        });
        wrap.append(h('figure', {}, c, h('figcaption', {}, h('b', {}, title), note)));
    }
    return wrap;
}

// ---------- The topics ----------
const TOPICS = [
    {
        id: 'coords', tab: 'Coordinates', title: 'WHERE IS A PLACE ON THE MOON?',
        stats: [['0°', 'longitude faces Earth'], ['±90°', 'latitude at the poles'], ['3,475 km', 'Moon diameter']],
        text: ['The Moon uses latitude and longitude like Earth. Longitude 0° is the point that faces Earth, so east and west are as seen from the Moon\'s centre toward Earth.',
            'This app uses one rule everywhere: north and east positive, longitude from -180° to 180°. Many NASA files count longitude 0° to 360° east; we convert at the edge.'],
        diagram: () => coordinates, src: ['moon', 'lola'],
    },
    {
        id: 'sun', tab: 'Sunlight windows', title: 'HOW LONG DOES THE SUN SHINE?',
        stats: [['29.5 d', 'sunrise to sunrise'], ['~14 d', 'of daylight at the equator'], ['1.5°', 'axis tilt']],
        text: ['A lunar day lasts about 29.5 Earth days: about two weeks of light, then two of night. A rover on solar power must survive the night on batteries.',
            'Near the poles the Sun never climbs high. It circles close to the horizon, so a small hill can block it, and a high rim can see it for most of the year.'],
        diagram: () => sunlight, src: ['phases', 'lola'],
    },
    {
        id: 'earth', tab: 'Earth visibility', title: 'CAN THE LANDER CALL HOME?',
        stats: [['59%', 'of the Moon seen from Earth over time'], ['±7.9°', 'east-west wobble'], ['0', 'direct contact from the far side']],
        text: ['The Moon turns once per orbit, so from the near side Earth hangs in almost the same spot in the sky. From the far side Earth never rises: a lander there needs a relay satellite.',
            'Earth is not perfectly still. The Moon\'s tilted, slightly oval orbit makes Earth wobble a few degrees (libration). Near the edge of the near side, that can lift Earth above the horizon or drop it below.'],
        diagram: () => libration, src: ['moon', 'horizons'],
    },
    {
        id: 'shadow', tab: 'Terrain shadows', title: 'WHY CRATERS STAY DARK',
        stats: [['1.5°', 'the Sun\'s highest point near the pole'], ['80 m', 'LOLA grid we use at the pole'], ['300 km', 'horizon we check']],
        text: ['With the Sun only a degree or two up, a crater rim casts a shadow many kilometres long. Deep crater floors near the poles can stay dark for billions of years.',
            'Our street view and finder trace the real terrain from NASA\'s LOLA heights: 720 directions, out to 300 km. The Sun counts as up only when it clears that horizon.'],
        diagram: () => shadows, src: ['lola'],
    },
    {
        id: 'elev', tab: 'Elevation vs temperature', title: 'HEIGHT IS NOT HEAT',
        stats: [['~20 km', 'from lowest to highest ground'], ['~40-400 K', 'Diviner range'], ['2', 'different instruments']],
        text: ['Elevation is how high the ground is, measured by LOLA\'s laser. Temperature is how hot it is, measured by Diviner\'s infrared eyes. They are different maps.',
            'With no air, high ground is not colder. Temperature depends on how high the Sun is and how long it shines, so the hottest ground is near the equator at noon, and the coldest is in polar craters.'],
        diagram: realMaps, src: ['lola', 'diviner'],
    },
    {
        id: 'ice', tab: 'Water ice', title: 'ICE IN THE DARK',
        stats: [['2009', 'LCROSS found water at Cabeus'], ['< 40 K', 'some polar crater floors'], ['South pole', 'Artemis region']],
        text: ['Craters that never see the Sun are cold enough to trap water ice for very long times. In 2009 NASA\'s LCROSS hit Cabeus crater near the south pole and detected water in the plume.',
            'Ice could give future crews water, air and rocket fuel. That is why landing sites near the south pole matter, and why sunlight and Earth contact there are hard to get right.'],
        diagram: null, src: ['lcross', 'diviner'],
    },
    {
        id: 'data', tab: 'Datasets', title: 'THE DATA BEHIND IT',
        cards: [
            ['LOLA', 'Heights from laser pulses (LRO). 80 m grid at the south pole, 1.9 km for the whole Moon.', 'lola'],
            ['LROC', 'The colour photo map of the Moon (LRO cameras).', 'lroc'],
            ['Diviner', 'Surface temperature from infrared (LRO), 24 snapshots through a lunar day.', 'diviner'],
            ['JPL Horizons', 'Exact Sun and Earth positions from any point on the Moon.', 'horizons'],
            ['EPIC', 'Full-disc photos of Earth from DSCOVR, 1.5 million km away.', 'epic'],
            ['SDO', 'The Sun in many wavelengths, every few minutes.', 'sdo'],
        ],
        src: [],
    },
    {
        id: 'how', tab: 'How it works', title: 'WHAT WE CALCULATE',
        done: ['Sun and Earth position, every 30-60 minutes, from JPL Horizons',
            'Longest unbroken sunlight and Earth contact, and both together',
            'Real terrain horizon (LOLA) in the street view and the landing finder',
            'Measured temperature (Diviner) and an estimate where there is none',
            'Landing finder: slope, landing ellipse, darkness limit, Sun and Earth at touchdown',
            'Rover reach and route within its slope limit'],
        planned: ['Real terrain shadows in the main site ranking (it still assumes a smooth Moon)',
            'Side-by-side site comparison and date-versus-date views',
            'Solar power estimate in watts'],
        src: ['challenge'],
    },
    {
        id: 'terms', tab: 'Glossary', title: 'WORDS WE USE',
        terms: [
            ['Altitude', 'How high something is above the horizon, in degrees (0° horizon, 90° straight up).'],
            ['Azimuth', 'Compass direction, in degrees from north through east (90° east, 180° south).'],
            ['Terminator', 'The line between day and night on a world.'],
            ['Libration', 'The small wobble that lets us see 59% of the Moon over time.'],
            ['PSR', 'Permanently shadowed region: ground that never sees the Sun.'],
            ['Regolith', 'The loose dust and broken rock covering the Moon.'],
            ['Landing ellipse', 'The area a lander may touch down in, given its accuracy.'],
            ['Kelvin (K)', 'Temperature from absolute zero. 0 °C = 273 K.'],
        ],
        src: [],
    },
];

function sources(keys) {
    if (!keys.length) {
        return null;
    }
    // A key of SRC, or a [title, url] pair (the guide passes pairs).
    const pair = k => (Array.isArray(k) ? k : SRC[k]);
    return h('p', {class: 'src'}, 'Sources: ', keys.map((k, i) => [i ? ' · ' : '', h('a', {href: pair(k)[1], target: '_blank', rel: 'noopener'}, pair(k)[0])]).flat());
}

function panel(topic) {
    const body = [h('p', {class: 'kicker mono'}, topic.tab.toUpperCase()), h('h3', {class: 'px'}, topic.title)];
    if (topic.stats) {
        body.push(h('div', {class: 'stat-row'}, topic.stats.map(([n, l]) => h('div', {}, h('b', {class: 'px'}, n), h('span', {}, l)))));
    }
    if (topic.text) {
        body.push(...topic.text.map(p => h('p', {class: 'para'}, p)));
    }
    if (topic.cards) {
        body.push(h('div', {class: 'mini-cards'}, topic.cards.map(([name, text, key]) => h('a', {class: 'mini-card', href: SRC[key][1], target: '_blank', rel: 'noopener'}, h('b', {class: 'px'}, name), h('span', {}, text)))));
    }
    if (topic.done) {
        body.push(h('div', {class: 'status-cols'},
            h('div', {}, h('p', {class: 'kicker mono'}, 'IMPLEMENTED'), h('ul', {class: 'checks'}, topic.done.map(x => h('li', {class: 'ok'}, x)))),
            h('div', {}, h('p', {class: 'kicker mono'}, 'PLANNED'), h('ul', {class: 'checks'}, topic.planned.map(x => h('li', {class: 'todo'}, x))))));
    }
    if (topic.facts) {
        body.push(h('ul', {class: 'checks'}, topic.facts.map(([t, url]) => h('li', {class: 'ok'}, t, url ? [' ', h('a', {class: 'src-inline', href: url, target: '_blank', rel: 'noopener'}, 'source')] : ' (our choice)'))));
    }
    if (topic.steps) {
        body.push(h('p', {class: 'kicker mono'}, 'TRY IT'), h('ol', {class: 'how-steps'}, topic.steps.map(x => h('li', {}, x))));
    }
    if (topic.open) {
        body.push(h('p', {class: 'open-row'}, topic.open.map(([text, href], i) => h('a', {class: i ? 'btn' : 'btn primary', href}, text))));
    }
    if (topic.terms) {
        body.push(h('dl', {class: 'terms'}, topic.terms.map(([t, d]) => [h('dt', {class: 'px'}, t), h('dd', {}, d)]).flat()));
    }
    body.push(sources(topic.src || []));
    const fig = topic.diagram ? topic.diagram() : null;
    return h('div', {class: `topic${fig ? '' : ' wide'}`}, h('div', {class: 'topic-text'}, body.filter(Boolean)), fig ? h('div', {class: 'topic-fig'}, fig) : null);
}

export function initTabs(tabsEl, bodyEl, list, onOpen) {
    let open = null;
    let canvasNow = null;
    function show(id) {
        const topic = list.find(x => x.id === id);
        const swap = () => {
            bodyEl.replaceChildren(panel(topic));
            canvasNow = bodyEl.querySelector('canvas.diagram');
            for (const b of tabsEl.children) {
                b.classList.toggle('on', b.dataset.topic === id);
                b.setAttribute('aria-selected', String(b.dataset.topic === id));
            }
        };
        // A smooth cross-fade between tabs where the browser supports view transitions.
        if (open && document.startViewTransition && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
            bodyEl.style.viewTransitionName = 'topic';
            document.startViewTransition(swap).finished.finally(() => {
                bodyEl.style.viewTransitionName = '';
            });
        } else {
            swap();
        }
        open = id;
        if (onOpen) {
            onOpen(id);
        }
    }
    tabsEl.replaceChildren(...list.map(t => h('button', {role: 'tab', 'data-topic': t.id, onclick: () => show(t.id)},
        t.group ? h('small', {class: 'mono'}, t.group) : null, t.tab)));
    show(list[0].id);
    let visible = false;
    new IntersectionObserver(e => {
        visible = e[0].isIntersecting;
    }).observe(bodyEl);
    function frame(t) {
        requestAnimationFrame(frame);
        if (!visible || !canvasNow || !canvasNow.isConnected) {
            return;
        }
        const g = canvasNow.getContext('2d');
        g.clearRect(0, 0, canvasNow.width, canvasNow.height);
        canvasNow.draw(g, canvasNow.width, canvasNow.height, t);
    }
    requestAnimationFrame(frame);
    return list.length;
}

export function initTopics(tabsEl, bodyEl, onOpen) {
    return initTabs(tabsEl, bodyEl, TOPICS, onOpen);
}

// ---------- Mission timeline from data/sites.json ----------
export function renderTimeline(el, sites) {
    const missions = sites.filter(s => s.year).sort((a, b) => a.year - b.year || a.name.localeCompare(b.name));
    el.replaceChildren(...missions.map((s, i) => h('li', {class: `tl-item ${s.category}`, style: `--i:${i % 6}`, 'data-site': s.id, tabindex: 0, role: 'button', 'aria-label': `${s.name}, ${s.year}. Show on the 3D Moon`},
        h('span', {class: 'tl-year px'}, String(s.year)),
        h('span', {class: 'tl-dot'}),
        h('div', {}, h('b', {}, s.name), h('span', {}, [s.agency, s.category === 'apollo' ? 'crewed landing' : 'robotic', `${Math.abs(s.lat).toFixed(1)}° ${s.lat >= 0 ? 'N' : 'S'}`].filter(Boolean).join(' · '))))));
    return missions.length;
}
