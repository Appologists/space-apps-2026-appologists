// Guide: one tab per part of the main site (the five mission steps and the rover tools) and of the explorer
// at /classic. Each tab says what the part does, the numbers it uses with their sources, how to try it, and
// a link that opens it. Numbers come from data/missions.json and src/finder/ (route-options.js, schedule.js).
import { canvasDiagram, grid, h, initTabs, label } from './topics.js';

const DEG = Math.PI / 180;
const SRC = {
    hls: ['NASA HLS update (2024)', 'https://ntrs.nasa.gov/api/citations/20240009596/downloads/ArtemisHLSUpdate_2024.pdf'],
    viperOps: ['NASA VIPER lunar operations', 'https://science.nasa.gov/mission/viper/lunar-operations/'],
    viperPlan: ['NASA VIPER mission planning (2022)', 'https://www.nasa.gov/wp-content/uploads/2022/05/overview_of_mission_planning_for_the_viper_rover.pdf'],
    regions: ['NASA Artemis III candidate regions (2022)', 'https://www.nasa.gov/news-release/nasa-identifies-candidate-regions-for-landing-next-americans-on-moon/'],
    gracy: ['Gracy and Lee, LPSC 2024', 'https://www.hou.usra.edu/meetings/lpsc2024/pdf/1695.pdf'],
    lola: ['LRO LOLA', 'https://lola.gsfc.nasa.gov/'],
    horizons: ['NASA/JPL Horizons', 'https://ssd.jpl.nasa.gov/horizons/'],
    diviner: ['LRO Diviner (UCLA)', 'https://www.diviner.ucla.edu/'],
    epic: ['NASA EPIC', 'https://epic.gsfc.nasa.gov/about'],
    sdo: ['NASA SDO', 'https://sdo.gsfc.nasa.gov/data/channels.php'],
    code: ['Our code on GitHub', 'https://github.com/Appologists/space-apps-2026-appologists'],
};
const MAIN = (step, extra = '') => `/#step=${step}&profile=nasa${extra}`;
const STREET = (lat, lon, name) => `/classic?${new URLSearchParams({view: 'surface', lat, lon, name})}`;

// ---------- Real data for the regions map ----------
let REGIONS = [];
Promise.all([fetch('/data/missions.json').then(r => r.json()), fetch('/data/sites.json').then(r => r.json())])
    .then(([missions, sites]) => {
        REGIONS = missions.regions.map(r => {
            const s = r.site ? sites.sites.find(x => x.id === r.site) : r;
            return s ? {name: s.name, lat: s.lat, lon: s.lon} : null;
        }).filter(Boolean);
    })
    .catch(() => {
        REGIONS = [];
    });

// ---------- Diagrams ----------
// The seven regions, as seen from above the south pole (north up = longitude 0).
const regionsMap = canvasDiagram((g, W, H, t) => {
    const cx = W / 2;
    const cy = H / 2;
    const scale = 150 / 6; // 6 degrees from the pole to the edge
    for (let r = 1; r <= 6; r++) {
        g.strokeStyle = r % 2 ? 'rgba(255,255,255,0.05)' : 'rgba(255,255,255,0.1)';
        g.beginPath();
        g.arc(cx, cy, r * scale, 0, Math.PI * 2);
        g.stroke();
    }
    label(g, '86° S', cx + 4 * scale + 4, cy - 4, '#555', 13);
    label(g, '88° S', cx + 2 * scale + 4, cy - 4, '#555', 13);
    g.fillStyle = '#ededed';
    g.beginPath();
    g.arc(cx, cy, 3, 0, Math.PI * 2);
    g.fill();
    label(g, 'pole', cx, cy + 18, '#6e6e6e', 13, 'center');
    if (!REGIONS.length) {
        label(g, 'Loading the regions…', cx, H - 20, '#6e6e6e', 15, 'center');
        return;
    }
    REGIONS.forEach((r, i) => {
        const d = (90 + r.lat) * scale;
        const x = cx + d * Math.sin(r.lon * DEG);
        const y = cy - d * Math.cos(r.lon * DEG);
        const pulse = 1 + 0.35 * Math.sin(t / 400 + i);
        g.fillStyle = 'rgba(79,227,193,0.18)';
        g.beginPath();
        g.arc(x, y, 12 * pulse, 0, Math.PI * 2);
        g.fill();
        g.fillStyle = '#4fe3c1';
        g.beginPath();
        g.arc(x, y, 5, 0, Math.PI * 2);
        g.fill();
        label(g, r.name, x + (x > cx ? 12 : -12), y + 5, '#cfcfcf', 14, x > cx ? 'left' : 'right');
    });
    label(g, 'Seen from above the south pole · 0° E at the top', 16, H - 14, '#6e6e6e', 13);
});

// The landing ellipse sliding over a grid: a cell passes only if every point of the ellipse passes.
const ellipseScan = canvasDiagram((g, W, H, t) => {
    const n = 18;
    const cs = 20;
    const x0 = 40;
    const y0 = 30;
    const bad = (i, j) => (Math.sin(i * 0.9) + Math.cos(j * 0.7) + Math.sin((i + j) * 0.37)) > 1.3;
    const k = (t / 140) % (n * n);
    const ci = Math.floor(k) % n;
    const cj = Math.floor(k / n);
    for (let j = 0; j < n; j++) {
        for (let i = 0; i < n; i++) {
            const done = j < cj || (j === cj && i < ci);
            let pass = true;
            for (let dj = -1; dj <= 1 && pass; dj++) {
                for (let di = -1; di <= 1; di++) {
                    if (bad(i + di, j + dj)) {
                        pass = false;
                        break;
                    }
                }
            }
            g.fillStyle = bad(i, j) ? '#3a1d1d' : done ? (pass ? 'rgba(69,212,131,0.75)' : 'rgba(255,255,255,0.08)') : '#141414';
            g.fillRect(x0 + i * cs, y0 + j * cs, cs - 2, cs - 2);
        }
    }
    g.strokeStyle = '#f5c96b';
    g.lineWidth = 2;
    g.beginPath();
    g.ellipse(x0 + ci * cs + cs / 2, y0 + cj * cs + cs / 2, cs * 1.5, cs * 1.5, 0, 0, Math.PI * 2);
    g.stroke();
    g.lineWidth = 1;
    const lx = x0 + n * cs + 30;
    for (const [c, text, y] of [['rgba(69,212,131,0.75)', 'every point passes', 80], ['#3a1d1d', 'too steep or too dark', 116], ['rgba(255,255,255,0.08)', 'ellipse touches bad ground', 152]]) {
        g.fillStyle = c;
        g.fillRect(lx, y - 12, 14, 14);
        label(g, text, lx + 22, y, '#a1a1a1', 15);
    }
    label(g, 'landing ellipse', lx, 210, '#f5c96b', 15);
});

// Three route choices to the same target.
const routeChoices = canvasDiagram((g, W, H, t) => {
    grid(g, W, H);
    const S = [70, 330];
    const T = [650, 90];
    // A dark crater in the middle that the shortest route crosses.
    g.fillStyle = 'rgba(59,91,255,0.18)';
    g.beginPath();
    g.ellipse(360, 210, 120, 80, 0, 0, Math.PI * 2);
    g.fill();
    label(g, 'shadow', 360, 215, '#5a7bff', 14, 'center');
    const routes = [
        {name: 'Fastest', color: '#f5c96b', pts: [S, [200, 330], [330, 330], [520, 300], [600, 200], T]},
        {name: 'Safest', color: '#4fe3c1', pts: [S, [120, 380], [400, 390], [640, 330], [690, 200], T]},
        {name: 'Shortest', color: '#a1a1a1', pts: [S, [360, 210], T], dash: [8, 8], lost: true},
    ];
    const k = (t / 5000) % 1;
    routes.forEach((r, ri) => {
        g.strokeStyle = r.color;
        g.lineWidth = 3;
        g.setLineDash(r.dash || []);
        g.beginPath();
        r.pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
        g.stroke();
        g.setLineDash([]);
        g.lineWidth = 1;
        // Rover position along the route.
        const segs = r.pts.slice(1).map((p, i) => [r.pts[i], p, Math.hypot(p[0] - r.pts[i][0], p[1] - r.pts[i][1])]);
        const total = segs.reduce((a, s) => a + s[2], 0);
        let d = (r.lost ? Math.min(k, 0.5) : k) * total;
        for (const [a, b, len] of segs) {
            if (d <= len) {
                const f = d / len;
                g.fillStyle = r.color;
                g.beginPath();
                g.arc(a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, 7, 0, Math.PI * 2);
                g.fill();
                break;
            }
            d -= len;
        }
        g.fillStyle = r.color;
        g.fillRect(40, 34 + ri * 24, 18, 4);
        label(g, r.name + (r.lost ? ': lost in the dark' : ''), 66, 41 + ri * 24, r.color, 15);
    });
    g.fillStyle = '#ededed';
    g.beginPath();
    g.arc(S[0], S[1], 8, 0, Math.PI * 2);
    g.fill();
    label(g, 'start', S[0], S[1] + 26, '#a1a1a1', 14, 'center');
    g.strokeStyle = '#ededed';
    g.beginPath();
    g.arc(T[0], T[1], 10, 0, Math.PI * 2);
    g.stroke();
    label(g, 'target', T[0] - 18, T[1] + 4, '#a1a1a1', 14, 'right');
});

// Slope bands for colouring a route (src/finder/route-options.js SLOPE_BANDS) and a rover on each.
const slopeBands = canvasDiagram((g, W, H, t) => {
    const bands = [[10, 'under 10°', '#7bd88f'], [15, '10–15°', '#ffd36b'], [20, '15–20°', '#ff8a5b'], [28, 'over 20°', '#e04848']];
    const w = (W - 80) / 4;
    bands.forEach(([deg, text, color], i) => {
        const x = 40 + i * w;
        const base = 320;
        const a = (deg - 3) * DEG;
        g.fillStyle = '#1a1a1a';
        g.beginPath();
        g.moveTo(x + 10, base);
        g.lineTo(x + w - 10, base);
        g.lineTo(x + w - 10, base - (w - 20) * Math.tan(a));
        g.fill();
        g.strokeStyle = color;
        g.lineWidth = 4;
        g.beginPath();
        g.moveTo(x + 10, base);
        g.lineTo(x + w - 10, base - (w - 20) * Math.tan(a));
        g.stroke();
        g.lineWidth = 1;
        const f = (Math.sin(t / 900 + i) + 1) / 2 * (i === 3 ? 0.35 : 1);
        const rx = x + 10 + f * (w - 40);
        const ry = base - (rx - x - 10) * Math.tan(a);
        g.save();
        g.translate(rx, ry);
        g.rotate(-a);
        g.fillStyle = '#ededed';
        g.fillRect(0, -16, 26, 12);
        g.fillStyle = '#6e6e6e';
        g.beginPath();
        g.arc(5, -3, 4, 0, Math.PI * 2);
        g.arc(21, -3, 4, 0, Math.PI * 2);
        g.fill();
        g.restore();
        label(g, text, x + w / 2, base + 34, color, 16, 'center');
    });
    label(g, 'Route colours by slope · bands are our estimate', 40, 60, '#6e6e6e', 15);
    label(g, 'VIPER limit in the pre-set mission: 15°', 40, 88, '#a1a1a1', 15);
});

// The rover's states over a drive (src/finder/schedule.js STATE), with a moving playhead.
const roverStates = canvasDiagram((g, W, H, t) => {
    const seq = [['Parked', 0.08, '#6e6e6e'], ['Driving', 0.22, '#45d483'], ['Waiting for Earth', 0.12, '#5aa8ff'], ['Driving', 0.18, '#45d483'],
        ['Waiting for the Sun', 0.16, '#f5c96b'], ['Driving', 0.16, '#45d483'], ['Arrived', 0.08, '#ededed']];
    const x0 = 40;
    const w = W - 80;
    let x = x0;
    const k = (t / 8000) % 1;
    let now = null;
    for (const [name, f, color] of seq) {
        g.fillStyle = color;
        g.globalAlpha = 0.85;
        g.fillRect(x, 150, f * w - 2, 46);
        g.globalAlpha = 1;
        if (k * w + x0 >= x && k * w + x0 < x + f * w) {
            now = [name, color];
        }
        x += f * w;
    }
    const px = x0 + k * w;
    g.strokeStyle = '#fff';
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(px, 130);
    g.lineTo(px, 214);
    g.stroke();
    g.lineWidth = 1;
    label(g, 'NOW', px, 122, '#fff', 13, 'center');
    if (now) {
        label(g, now[0], W / 2, 270, now[1], 26, 'center');
    }
    label(g, 'Start', x0, 236, '#6e6e6e', 13);
    label(g, 'End of mission', x0 + w, 236, '#6e6e6e', 13, 'right');
    label(g, 'A schematic drive: the planner’s states, in order', x0, 60, '#6e6e6e', 15);
});

// A height profile along a route, with the directions under it.
const profile = canvasDiagram((g, W, H, t) => {
    grid(g, W, H);
    const y = x => 230 - 60 * Math.sin(x / 90) - 30 * Math.sin(x / 37) - x * 0.08;
    g.fillStyle = 'rgba(255,255,255,0.06)';
    g.beginPath();
    g.moveTo(40, 300);
    for (let x = 40; x <= W - 40; x += 4) {
        g.lineTo(x, y(x));
    }
    g.lineTo(W - 40, 300);
    g.fill();
    g.strokeStyle = '#4fe3c1';
    g.lineWidth = 3;
    g.beginPath();
    for (let x = 40; x <= W - 40; x += 4) {
        if (x === 40) {
            g.moveTo(x, y(x));
        } else {
            g.lineTo(x, y(x));
        }
    }
    g.stroke();
    g.lineWidth = 1;
    const k = 40 + ((t / 30) % (W - 80));
    g.fillStyle = '#f5c96b';
    g.beginPath();
    g.arc(k, y(k) - 6, 7, 0, Math.PI * 2);
    g.fill();
    const steps = ['1. Head NE 0.4 km', '2. Wait for Earth', '3. Head E 1.1 km', '4. Arrive'];
    steps.forEach((s, i) => label(g, s, 40 + i * 170, 350, k > 40 + i * (W - 80) / 4 ? '#ededed' : '#555', 15));
    label(g, 'height along the route (schematic)', 40, 50, '#6e6e6e', 14);
});

// ---------- The tabs ----------
export const GUIDE = [
    {
        id: 'g-steps', group: 'MAIN SITE', tab: 'The five steps', title: 'ONE MISSION, FIVE STEPS',
        stats: [['5', 'steps in the left panel'], ['7', 'regions checked'], ['1', 'address that keeps your place']],
        text: ['The main site walks one mission from start to end: choose a mission, see which regions can take it, plan the rover\'s drive, stand on the surface, then ride along the route.',
            'The address keeps the step, the mission and the region, so a reload or a bookmark comes back to the same place.'],
        steps: ['Open the main site.', 'Pick "Pre-set" (an Artemis lander with the VIPER rover).', 'Press the button at the bottom to go to the next step.'],
        open: [['Open step 1', MAIN(1)]], src: [SRC.code],
    },
    {
        id: 'g-mission', group: 'MAIN SITE', tab: 'Mission', title: 'WHAT THE LANDER AND ROVER CAN DO',
        facts: [['Lands within 100 m of its target', SRC.hls[1]], ['Lands on slopes under 10°', SRC.hls[1]], ['Rover drives slopes up to 15°', SRC.viperOps[1]],
            ['Rover survives 50 hours of darkness', SRC.viperOps[1]], ['Rover averages 36 m an hour: it waits about nine tenths of the time', SRC.viperPlan[1]],
            ['Rover needs Earth in view to drive: it is steered from the ground', SRC.viperOps[1]], ['Lands 21 November 2026, 00:00 UTC, for 14 days', null]],
        text: ['These are the pre-set mission\'s numbers from data/missions.json. "Custom mission" lets you change each one with a few big buttons.'],
        open: [['Open the mission step', MAIN(1)]], src: [SRC.hls, SRC.viperOps, SRC.viperPlan],
    },
    {
        id: 'g-regions', group: 'MAIN SITE', tab: 'Regions', title: 'SEVEN PLACES NEAR THE SOUTH POLE',
        text: ['Step 2 checks the mission against seven places: two proposed sites inside NASA\'s Artemis III candidate regions, and the middles of five craters as reference points.',
            'For each one it searches the ground around it and shows whether a safe landing and a workable drive exist there.'],
        steps: ['Finish step 1.', 'Read the list: each region says if the mission fits.', 'Select a region to see it on the map.'],
        diagram: () => regionsMap, open: [['Open the regions step', MAIN(2)]], src: [SRC.regions, SRC.gracy],
    },
    {
        id: 'g-finder', group: 'MAIN SITE', tab: 'Landing finder', title: 'WHERE A LANDING PASSES EVERY CHECK',
        stats: [['10–40 km', 'searched round the point'], ['~10 s', 'per search'], ['4', 'map layers']],
        text: ['The finder slides the landing ellipse over the ground. A spot passes only if every point the lander might touch is flat enough, gets sunlight, keeps Earth in view and is never dark for longer than the rover survives.',
            'Its layers show sunlight share, the longest darkness, the Earth link and the slope. The terrain is NASA\'s LOLA heights, with real shadows.'],
        diagram: () => ellipseScan, open: [['Open the map', MAIN(2)]], src: [SRC.lola, SRC.horizons],
    },
    {
        id: 'g-reach', group: 'MAIN SITE', tab: 'Rover reach', title: 'WHERE THE ROVER CAN GO',
        stats: [['15°', 'steepest slope, pre-set rover'], ['4', 'slope colours'], ['None', 'range limit']],
        text: ['From a starting point the map shades all the ground the rover can reach without a slope steeper than its limit. Craters with steep walls stay closed even when they are close.',
            'Routes are coloured by slope. The four bands are our estimate, set from the finder\'s own limits.'],
        diagram: () => slopeBands, open: [['Plan a drive', MAIN(3)]], src: [SRC.viperOps, SRC.code],
    },
    {
        id: 'g-routes', group: 'MAIN SITE', tab: 'Route choices', title: 'FASTEST, SAFEST, SHORTEST',
        stats: [['3', 'routes to the same targets'], ['30%', 'darkness margin on the safest'], ['1', 'that can get lost']],
        text: ['Like a road map, the drive step offers three routes. The fastest arrives first. The safest asks for gentler slopes and must survive 30% more darkness than the limit. The shortest ignores sunlight.',
            'The shortest route can get the rover lost in the dark, which is why the planner exists. The panel says so when it happens.'],
        diagram: () => routeChoices, open: [['Open the drive step', MAIN(3)]], src: [SRC.code],
    },
    {
        id: 'g-directions', group: 'MAIN SITE', tab: 'Directions', title: 'TURN-BY-TURN ON THE MOON',
        text: ['A drive plan also comes as step-by-step directions, with a compass heading for each leg (N, NE, E and so on), the waits for the Sun or Earth, and the height profile along the route.',
            'Up on the map is north. Every time in the plan is UTC.'],
        steps: ['In step 3, set a start and one or more targets.', 'Pick a route choice.', 'Read the directions under the map.'],
        diagram: () => profile, open: [['Open the drive step', MAIN(3)]], src: [SRC.lola],
    },
    {
        id: 'g-whynot', group: 'MAIN SITE', tab: 'Why not?', title: 'WHEN A DRIVE CANNOT WORK',
        stats: [['5', 'reasons it can name'], ['1', 'banner'], ['→', 'marks on the map']],
        text: ['When no plan works, the app does not just say "no". A banner names the problem and marks where it happens: too steep, walled in by slopes, too far, too long in the dark, or lost on the shortest route.',
            'Each problem can carry a tip, such as which map layer to open to see it.'],
        open: [['Open the drive step', MAIN(3)]], src: [SRC.code],
    },
    {
        id: 'g-play', group: 'MAIN SITE', tab: 'Play the drive', title: 'WATCH THE ROVER WAIT AND DRIVE',
        stats: [['7', 'rover states'], ['1', 'player'], ['UTC', 'for every time']],
        text: ['"Play the drive" replays the plan hour by hour. The rover is parked, driving, waiting for the Sun, waiting for Earth, holding, arrived, or lost. A darkness bar shows how close it is to its limit, and "Next change" jumps to the next event.'],
        diagram: () => roverStates, open: [['Open the drive step', MAIN(3)]], src: [SRC.viperPlan],
    },
    {
        id: 'g-surface', group: 'MAIN SITE', tab: 'Surface lenses', title: 'STAND ON THE GROUND',
        stats: [['3', 'lenses: sunlight, elevation, slope'], ['10°', 'from the pole: where it works'], ['80 m', 'LOLA grid']],
        text: ['Step 4 puts you on the ground at the landing spot, with real terrain, real shadows and the Sun and Earth where they would be.',
            'Lenses recolour the ground by elevation or slope, with height contours and distance rings. Point at any spot to read its height, slope and distance.'],
        open: [['Open the surface step', MAIN(4)], ['Ride along (step 5)', MAIN(5)]], src: [SRC.lola],
    },
    {
        id: 'g-ranking', group: 'EXPLORER', tab: 'Site ranking', title: 'RANK 23 SITES FOR ANY DATE',
        stats: [['23', 'sites with sources'], ['30–60 min', 'Horizons sample step'], ['2', 'must-haves: Sun, Earth']],
        text: ['The explorer ranks every site by its longest unbroken sunlight and Earth contact, from live JPL Horizons positions. Mark what is a must-have and set the weights.',
            'The site card says what the result leaves out: the ranking still assumes a smooth Moon.'],
        open: [['Open the explorer', '/classic']], src: [SRC.horizons],
    },
    {
        id: 'g-street', group: 'EXPLORER', tab: 'Street view', title: 'WALK, MEASURE, LOOK AT THE HORIZON',
        stats: [['M', 'measure two points'], ['H', 'real horizon and sky tracks'], ['P', 'save a snapshot']],
        text: ['The street view stands you on NASA LOLA terrain with the NASA Moon Trek photo. Walk with W A S D, turn to face the Sun or Earth, rise to a bird\'s-eye view, or light the ground with real shadows.',
            'Measure gives distance, height change and slope between two points. Horizon draws the real terrain horizon with this week\'s Sun and Earth tracks.'],
        steps: ['Open a site below.', 'Press M and click two points on the ground.', 'Press H to see the horizon.'],
        open: [['Connecting Ridge', STREET('-89.53432', '-150.05233', 'Connecting Ridge')], ['Apollo 11', STREET('0.67416', '23.47314', 'Apollo 11')]],
        src: [SRC.lola],
    },
    {
        id: 'g-heat', group: 'EXPLORER', tab: 'Heatmaps', title: 'THE WHOLE MOON IN COLOUR',
        stats: [['3', 'maps: elevation, slope, temperature'], ['40–400 K', 'Diviner range'], ['1', 'click to stand there']],
        text: ['Heatmaps colour the whole Moon by height, by slope, or by temperature (measured by Diviner where it has data, our estimate elsewhere). Click any point on a map to stand there in 3D.',
            'The colour panel at the corner of this page uses the same elevation colours and the same temperature scale.'],
        open: [['Open the explorer', '/classic']], src: [SRC.lola, SRC.diviner],
    },
    {
        id: 'g-views', group: 'EXPLORER', tab: 'Earth and Sun', title: 'TODAY\'S EARTH AND SUN',
        text: ['The explorer and this page show today\'s Earth from NASA\'s EPIC camera, 1.5 million km away, and the Sun from NASA\'s SDO in several wavelengths. Each colour of light shows gas at a different temperature.'],
        steps: ['In the 3D lab above, select "Earth" or "Sun".', 'Select a channel to switch the Sun\'s colour.'],
        open: [['Go to the 3D lab', '#lab'], ['Open the explorer', '/classic']], src: [SRC.epic, SRC.sdo],
    },
];

export function initGuide(tabsEl, bodyEl, onOpen) {
    return initTabs(tabsEl, bodyEl, GUIDE, onOpen);
}
