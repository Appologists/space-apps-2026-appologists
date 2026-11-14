// South pole page: NASA LOLA 5 m site data on a polar map, scored with real terrain horizons.

const $ = id => document.getElementById(id);
const R = 1737400;
const DEG = '\u00b0';

let meta = null;
let results = null;
let byId = {};
let selectedSp = null;
let colorBy = 'score';
let ctx = null;
let view = {cx: 0, cy: -2000, scale: 1};
const images = {};
let app = null;

const esc = s => String(s).replace(/[&<>"']/g, ch => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[ch]));
const fmtLat = v => `${Math.abs(v).toFixed(4)}${DEG} ${v < 0 ? 'S' : 'N'}`;
const fmtLon = v => `${Math.abs(v).toFixed(3)}${DEG} ${v < 0 ? 'W' : 'E'}`;
const rhoOf = lat => 2 * R * Math.tan(Math.PI / 4 + lat * Math.PI / 360);

function scoreColor(v) {
    return v >= 70 ? '#3ddc97' : v >= 45 ? '#ffb547' : '#ff6b5b';
}

function tempColor(k) {
    const stops = [[100, [25, 35, 90]], [160, [50, 120, 190]], [220, [230, 220, 190]], [280, [235, 150, 80]], [340, [200, 60, 50]]];
    for (let i = 1; i < stops.length; i++) {
        if (k <= stops[i][0]) {
            const f = Math.max(0, (k - stops[i - 1][0]) / (stops[i][0] - stops[i - 1][0]));
            const c = stops[i - 1][1].map((a, j) => Math.round(a + (stops[i][1][j] - a) * f));
            return `rgb(${c.join(',')})`;
        }
    }
    return 'rgb(200,60,50)';
}

function slopeColor(d) {
    if (d === undefined || d === null) {
        return '#5b6676';
    }
    return d < 3 ? '#3ddc97' : d < 5 ? '#9be36b' : d < 8 ? '#ffb547' : '#ff6b5b';
}

function siteColor(s) {
    const r = byId[s.id];
    if (colorBy === 'temp') {
        return r ? tempColor(r.summary.div_mean_k ?? r.summary.temp_mean_k) : '#5b6676';
    }
    if (colorBy === 'slope') {
        return slopeColor(s.slope_mean);
    }
    return r ? scoreColor(r.score) : '#9aa4b6';
}

// ---------- map ----------
function toPx(x, y) {
    const c = $('sp-map');
    return [c.clientWidth / 2 + (x - view.cx) * view.scale, c.clientHeight / 2 - (y - view.cy) * view.scale];
}

function toXY(px, py) {
    const c = $('sp-map');
    return [view.cx + (px - c.clientWidth / 2) / view.scale, view.cy - (py - c.clientHeight / 2) / view.scale];
}

function fitTo(xmin, xmax, ymin, ymax) {
    const c = $('sp-map');
    view.cx = (xmin + xmax) / 2;
    view.cy = (ymin + ymax) / 2;
    view.scale = Math.min(c.clientWidth / (xmax - xmin), c.clientHeight / (ymax - ymin)) * 0.9;
    draw();
}

function load(src) {
    if (!images[src]) {
        const im = new Image();
        im.onload = draw;
        im.src = src;
        images[src] = im;
    }
    return images[src];
}

function draw() {
    const c = $('sp-map');
    if (!c || !meta || c.offsetParent === null) {
        return;
    }
    const W = c.clientWidth;
    const H = c.clientHeight;
    const dpr = devicePixelRatio;
    c.width = W * dpr;
    c.height = H * dpr;
    ctx = c.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#05070b';
    ctx.fillRect(0, 0, W, H);
    const half = meta.context_half_m;
    const ctxImg = load('/south-pole/context.webp');
    if (ctxImg.complete && ctxImg.naturalWidth) {
        const [x0, y0] = toPx(-half, half);
        ctx.globalAlpha = 0.85;
        ctx.drawImage(ctxImg, x0, y0, 2 * half * view.scale, 2 * half * view.scale);
        ctx.globalAlpha = 1;
    }
    for (const t of meta.tiles) {
        const im = load(t.png);
        if (im.complete && im.naturalWidth) {
            const [x0, y0] = toPx(t.x0, t.y0);
            ctx.drawImage(im, x0, y0, t.size * view.scale, t.size * view.scale);
        }
        const [lx, ly] = toPx(t.x0, t.y0);
        ctx.fillStyle = 'rgba(231,234,239,0.7)';
        ctx.font = '11px "Geist Mono", monospace';
        ctx.fillText(t.name, lx + 4, ly + 13);
    }
    // Latitude rings and longitude spokes.
    ctx.strokeStyle = 'rgba(159,233,214,0.35)';
    ctx.fillStyle = 'rgba(159,233,214,0.85)';
    ctx.lineWidth = 1;
    const [px0, py0] = toPx(0, 0);
    for (const lat of [-89.5, -89, -88, -87, -86, -85, -84]) {
        const r = rhoOf(lat) * view.scale;
        ctx.beginPath();
        ctx.arc(px0, py0, r, 0, Math.PI * 2);
        ctx.stroke();
        ctx.fillText(`${Math.abs(lat)}${DEG}S`, px0 + 4, py0 - r - 3);
    }
    for (let lon = -150; lon <= 180; lon += 30) {
        const rr = rhoOf(-84);
        const [ex, ey] = toPx(rr * Math.sin(lon * Math.PI / 180), rr * Math.cos(lon * Math.PI / 180));
        ctx.beginPath();
        ctx.moveTo(px0, py0);
        ctx.lineTo(ex, ey);
        ctx.stroke();
        ctx.fillText(lon === 0 ? `0${DEG}` : lon === 180 ? `180${DEG}` : `${Math.abs(lon)}${DEG}${lon < 0 ? 'W' : 'E'}`, ex + 4, ey);
    }
    ctx.fillStyle = '#ffffff';
    ctx.fillText('South pole', px0 + 6, py0 + 14);
    ctx.fillRect(px0 - 1, py0 - 6, 2, 12);
    ctx.fillRect(px0 - 6, py0 - 1, 12, 2);
    // Sites (labels skip when they would overlap another).
    const placed = [];
    const ordered = [...meta.sites].sort((a, b) => (byId[b.id]?.score ?? 0) - (byId[a.id]?.score ?? 0));
    if (selectedSp) {
        ordered.unshift(selectedSp);
    }
    for (const s of ordered) {
        const col = siteColor(s);
        const sel = selectedSp && selectedSp.id === s.id;
        if (s.poly && s.poly.length > 2) {
            ctx.beginPath();
            s.poly.forEach(([x, y], i) => {
                const [a, b] = toPx(x, y);
                if (i) {
                    ctx.lineTo(a, b);
                } else {
                    ctx.moveTo(a, b);
                }
            });
            ctx.closePath();
            ctx.fillStyle = col + '';
            ctx.globalAlpha = 0.45;
            ctx.fill();
            ctx.globalAlpha = 1;
            ctx.strokeStyle = sel ? '#ffffff' : col;
            ctx.lineWidth = sel ? 2.5 : 1.5;
            ctx.stroke();
        }
        const [x, y] = toPx(s.x, s.y);
        const r = s.kind === 'roi' ? 6 : 5;
        ctx.save();
        ctx.translate(x, y);
        if (s.kind === 'flat') {
            ctx.rotate(Math.PI / 4);
        }
        ctx.fillStyle = col;
        ctx.strokeStyle = sel ? '#ffffff' : 'rgba(0,0,0,0.6)';
        ctx.lineWidth = sel ? 2.5 : 1.2;
        if (s.kind === 'flat') {
            ctx.fillRect(-r, -r, 2 * r, 2 * r);
            ctx.strokeRect(-r, -r, 2 * r, 2 * r);
        } else {
            ctx.beginPath();
            ctx.arc(0, 0, r, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();
        }
        ctx.restore();
        if (sel || view.scale > 0.004) {
            const near = placed.some(([a, b]) => Math.abs(a - x) < 120 && Math.abs(b - y) < 16);
            if (sel || !near) {
                ctx.fillStyle = sel ? '#ffffff' : '#d4d4d4';
                ctx.font = '12px "Geist", sans-serif';
                ctx.fillText(s.label, x + 9, y - 7);
                placed.push([x, y]);
            }
        }
    }
    // Scale bar.
    const km = [1, 2, 5, 10, 20, 50, 100].find(k => k * 1000 * view.scale > 70) || 100;
    ctx.fillStyle = '#e7eaef';
    ctx.fillRect(16, H - 22, km * 1000 * view.scale, 3);
    ctx.font = '11px "Geist Mono", monospace';
    ctx.fillText(`${km} km`, 16, H - 28);
    drawLegend();
}

function drawLegend() {
    const el = $('sp-legend');
    const items = colorBy === 'temp'
        ? [['#192358', '100 K'], ['rgb(50,120,190)', '160 K'], ['rgb(230,220,190)', '220 K'], ['rgb(235,150,80)', '280 K']]
        : colorBy === 'slope'
            ? [['#3ddc97', '< 3\u00b0'], ['#9be36b', '3\u20135\u00b0'], ['#ffb547', '5\u20138\u00b0'], ['#ff6b5b', '> 8\u00b0']]
            : [['#3ddc97', 'score 70+'], ['#ffb547', '45\u201369'], ['#ff6b5b', 'under 45']];
    el.innerHTML = items.map(([c, t]) => `<span><i style="background:${c}"></i>${t}</span>`).join('')
        + '<span><i class="round-i"></i>NASA region</span><span><i class="dia-i"></i>Flattest ground (auto)</span>'
        + '<span><i style="background:#4fe3c1"></i>Tile: slope under 5\u00b0</span>';
}

function siteAt(px, py) {
    let best = null;
    let bd = 14;
    for (const s of meta.sites) {
        const [x, y] = toPx(s.x, s.y);
        const d = Math.hypot(x - px, y - py);
        if (d < bd) {
            bd = d;
            best = s;
        }
    }
    return best;
}

function bindMap() {
    const c = $('sp-map');
    let drag = null;
    c.addEventListener('pointerdown', e => {
        drag = {x: e.clientX, y: e.clientY, cx: view.cx, cy: view.cy, moved: 0};
        c.setPointerCapture(e.pointerId);
    });
    c.addEventListener('pointermove', e => {
        const r = c.getBoundingClientRect();
        if (drag) {
            const dx = e.clientX - drag.x;
            const dy = e.clientY - drag.y;
            drag.moved = Math.max(drag.moved, Math.hypot(dx, dy));
            view.cx = drag.cx - dx / view.scale;
            view.cy = drag.cy + dy / view.scale;
            draw();
            return;
        }
        const s = siteAt(e.clientX - r.left, e.clientY - r.top);
        const tip = $('sp-tip');
        if (!s) {
            const [x, y] = toXY(e.clientX - r.left, e.clientY - r.top);
            const rho = Math.hypot(x, y);
            const lat = (2 * Math.atan(rho / (2 * R)) - Math.PI / 2) * 180 / Math.PI;
            const lon = Math.atan2(x, y) * 180 / Math.PI;
            tip.textContent = `${fmtLat(lat)}, ${fmtLon(lon)}`;
        } else {
            const res = byId[s.id];
            tip.textContent = `${s.label}${res ? ` \u00b7 score ${res.score}` : ''} \u00b7 click for details`;
        }
        tip.style.left = `${e.clientX - r.left + 14}px`;
        tip.style.top = `${e.clientY - r.top + 14}px`;
        tip.hidden = false;
    });
    c.addEventListener('pointerleave', () => {
        $('sp-tip').hidden = true;
    });
    c.addEventListener('pointerup', e => {
        if (drag && drag.moved < 4) {
            const r = c.getBoundingClientRect();
            const s = siteAt(e.clientX - r.left, e.clientY - r.top);
            if (s) {
                select(s.id);
            }
        }
        drag = null;
    });
    c.addEventListener('wheel', e => {
        e.preventDefault();
        const r = c.getBoundingClientRect();
        const [x, y] = toXY(e.clientX - r.left, e.clientY - r.top);
        view.scale *= e.deltaY > 0 ? 0.85 : 1.18;
        view.scale = Math.max(0.0008, Math.min(0.4, view.scale));
        const [x2, y2] = toXY(e.clientX - r.left, e.clientY - r.top);
        view.cx += x - x2;
        view.cy += y - y2;
        draw();
    }, {passive: false});
    new ResizeObserver(draw).observe(c);
}

// ---------- detail ----------
function drawHorizon(cv, s, r) {
    const W = cv.clientWidth;
    const H = cv.clientHeight;
    const dpr = devicePixelRatio;
    cv.width = W * dpr;
    cv.height = H * dpr;
    const g = cv.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, H);
    const hz = s.horizon;
    const els = r ? r.sun_el.concat(r.earth_el) : [];
    const top = Math.max(6, Math.max(...hz, ...els) + 1.5);
    const bot = Math.min(-2, Math.min(...hz) - 0.5);
    const X = az => 26 + az / 360 * (W - 32);
    const Y = el => 8 + (1 - (el - bot) / (top - bot)) * (H - 24);
    g.fillStyle = 'rgba(120,110,95,0.55)';
    g.beginPath();
    g.moveTo(X(0), Y(bot));
    hz.forEach((v, i) => g.lineTo(X(i * 360 / hz.length), Y(v)));
    g.lineTo(X(360), Y(bot));
    g.closePath();
    g.fill();
    g.strokeStyle = 'rgba(255,255,255,0.2)';
    g.beginPath();
    g.moveTo(X(0), Y(0));
    g.lineTo(X(360), Y(0));
    g.stroke();
    g.fillStyle = '#5b6676';
    g.font = '10px "Geist Mono", monospace';
    [['N', 0], ['E', 90], ['S', 180], ['W', 270], ['N', 360]].forEach(([t, a]) => g.fillText(t, X(a) - 3, H - 3));
    g.fillText(`${Math.round(top)}${DEG}`, 0, Y(top) + 8);
    g.fillText(`0${DEG}`, 0, Y(0) + 3);
    if (r) {
        const sunBits = r.sun_bits;
        r.sun_az.forEach((az, i) => {
            g.fillStyle = sunBits[i] === '1' ? '#ffb547' : '#7a4b1c';
            g.fillRect(X(az) - 1, Y(r.sun_el[i]) - 1, 2.5, 2.5);
        });
        r.earth_az.forEach((az, i) => {
            g.fillStyle = r.earth_bits[i] === '1' ? '#4ea8ff' : '#26405f';
            g.fillRect(X(az) - 1, Y(r.earth_el[i]) - 1, 2, 2);
        });
    }
}

function drawSpBars(cv, r, idx) {
    const W = cv.clientWidth;
    const H = cv.clientHeight;
    cv.width = W * devicePixelRatio;
    cv.height = H * devicePixelRatio;
    const g = cv.getContext('2d');
    g.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
    g.fillStyle = 'rgba(255,255,255,0.04)';
    g.fillRect(0, 0, W, H);
    const n = r.sun_bits.length;
    const bw = W / n;
    for (let i = 0; i < n; i++) {
        const s = r.sun_bits[i] === '1';
        const e = r.earth_bits[i] === '1';
        if (s) {
            g.fillStyle = '#ffb547';
            g.fillRect(i * bw, 1, Math.ceil(bw), H / 3 - 2);
        }
        if (e) {
            g.fillStyle = '#4ea8ff';
            g.fillRect(i * bw, H / 3 + 1, Math.ceil(bw), H / 3 - 2);
        }
        if (s && e) {
            g.fillStyle = '#3ddc97';
            g.fillRect(i * bw, 2 * H / 3 + 1, Math.ceil(bw), H / 3 - 2);
        }
    }
    if (idx !== null) {
        g.fillStyle = '#fff';
        g.fillRect(Math.min(n - 1, idx) * bw, 0, 1, H);
    }
}

function select(id) {
    selectedSp = meta.sites.find(s => s.id === id) || null;
    renderDetail();
    renderList();
    draw();
    if (selectedSp) {
        app.onSelect?.(selectedSp);
    }
}

function renderDetail() {
    const box = $('sp-detail');
    const s = selectedSp;
    if (!s) {
        box.innerHTML = '<p class="quiet">Click a site on the map. Circles are NASA regions of interest; diamonds are the flattest ground our script found in each 5 m tile.</p>';
        return;
    }
    const r = byId[s.id];
    const idx = app.timeIndex();
    const m = r?.summary;
    const hours = r ? r.sun_bits.length * results.window.step_minutes / 60 : 0;
    const pct = v => `${Math.round(100 * v / hours)}%`;
    const tNow = r ? r.temps[Math.min(idx, r.temps.length - 1)] : null;
    const dNow = r?.temps_diviner ? r.temps_diviner[Math.min(idx, r.temps_diviner.length - 1)] : null;
    const rows = [
        ['Unbroken sunlight', m ? `${m.sun.longest_h} h` : '\u2014'],
        ['Time in sunlight', m ? pct(m.sun.total_h) : '\u2014'],
        ['Earth in view', m ? pct(m.earth.total_h) : '\u2014'],
        ['Unbroken Sun + Earth', m ? `${m.both.longest_h} h` : '\u2014'],
        ['Best window (UTC)', m?.both.best_start ? `${m.both.best_start.slice(5, 16).replace('T', ' ')} \u2192 ${m.both.best_end.slice(5, 16).replace('T', ' ')}` : '\u2014'],
        ['Measured now (Diviner, 15 km cell)', dNow !== null ? `${dNow} K \u00b7 ${dNow - 273} \u00b0C` : '\u2014'],
        ['Measured range this window', m?.div_min_k !== undefined ? `${Math.round(m.div_min_k)} to ${Math.round(m.div_max_k)} K` : '\u2014'],
        ['On this tilted ground now (estimate)', tNow !== null ? `${tNow} K \u00b7 ${tNow - 273} \u00b0C` : '\u2014'],
        ['On this ground, range (estimate)', m ? `${Math.round(m.temp_min_k)} to ${Math.round(m.temp_max_k)} K` : '\u2014'],
        ['Mean slope', s.slope_mean !== undefined ? `${s.slope_mean.toFixed(1)}\u00b0` : 'no 5 m slope tile'],
        ['Slope, 90% of area under', s.slope_p90 !== undefined ? `${s.slope_p90.toFixed(1)}\u00b0` : '\u2014'],
        ['Ground under 5\u00b0', s.frac_safe !== undefined ? `${Math.round(100 * s.frac_safe)}%` : '\u2014'],
        ['Elevation', `${(s.elev_m / 1000).toFixed(2)} km`],
        ['Area', `${(s.area_m2 / 10000).toFixed(1)} ha`],
    ];
    box.innerHTML = `
        <p class="eyebrow">${s.kind === 'roi' ? 'NASA region of interest' : 'Flattest ground in tile (our search)'}</p>
        <div class="cmp-top"><h2>${esc(s.label)}</h2>${r ? `<div class="cmp-score" style="color:${scoreColor(r.score)}">${r.score}</div>` : ''}</div>
        <p class="quiet mono">${fmtLat(s.lat)}, ${fmtLon(s.lon)}</p>
        ${m ? `<p><span class="need ${m.meets_requirement ? 'yes' : 'no'}">${m.meets_requirement ? 'Meets your need' : 'Misses your need'}</span></p>` : ''}
        <h3>Horizon and sky this window</h3>
        <canvas id="sp-horizon" class="skychart"></canvas>
        <p class="quiet">Brown: the real terrain horizon (${esc(s.horizon_source)}). Gold dots: the Sun when lit, dark when hidden. Blue: Earth.</p>
        ${r ? '<canvas id="sp-bars" class="sp-bars"></canvas>' : ''}
        <table class="sp-table">${rows.map(([k, v]) => `<tr><td>${k}</td><td>${v}</td></tr>`).join('')}</table>
        ${r && !r.safety_known ? '<p class="quiet">No 5 m slope tile here, so the score leaves landing safety out.</p>' : ''}
        <div class="site-actions three">
            <button id="sp-look" class="accent">Look around</button>
            <button id="sp-add">Add to ranking</button>
            <button id="sp-moon">On the Moon</button>
        </div>`;
    requestAnimationFrame(() => {
        drawHorizon($('sp-horizon'), s, r);
        if (r) {
            drawSpBars($('sp-bars'), r, idx);
        }
    });
    $('sp-look').onclick = () => app.lookAround(s.lat, s.lon, s.label);
    $('sp-add').onclick = () => app.addSite(s.label, s.lat, s.lon);
    $('sp-moon').onclick = () => app.showOnMoon(s.lat, s.lon);
}

function renderList() {
    const ol = $('sp-list');
    ol.innerHTML = '';
    const order = results ? results.results.map(r => meta.sites.find(s => s.id === r.id)) : meta.sites;
    order.slice(0, 40).forEach((s, i) => {
        const r = byId[s.id];
        const li = document.createElement('li');
        li.className = selectedSp?.id === s.id ? 'selected' : '';
        li.innerHTML = `<span>${i + 1}. ${esc(s.label)}</span><em style="color:${r ? scoreColor(r.score) : '#9aa4b6'}">${r ? r.score : ''}</em>`;
        li.onclick = () => select(s.id);
        ol.append(li);
    });
}

export async function analyze() {
    const w = app.window();
    $('sp-note').textContent = 'Getting NASA Horizons data and checking every site against its terrain horizon...';
    try {
        const r = await fetch(`/api/southpole?start=${w.start}&days=${w.days}&need_h=${w.need}`);
        const j = await r.json();
        if (!r.ok) {
            throw Error(j.error);
        }
        results = j;
        byId = Object.fromEntries(j.results.map(x => [x.id, x]));
        $('sp-note').textContent = `${j.results.length} sites scored for ${w.days} days from ${w.start} (UTC). Sun and Earth: ${j.reference}. Temperatures: measured by NASA Diviner (15 km cells), plus our estimate for the tilted 5 m ground.`;
        app.onResults(j.results.map(x => {
            const s = meta.sites.find(k => k.id === x.id);
            return {lat: s.lat, lon: s.lon, score: x.score, label: s.label};
        }));
        if (!selectedSp) {
            selectedSp = meta.sites.find(s => s.id === j.results[0].id);
        }
    } catch (e) {
        $('sp-note').textContent = `Could not score the sites: ${e.message}`;
    }
    renderList();
    renderDetail();
    draw();
}

/** Sites for the search palette. */
export function spSites() {
    return meta ? meta.sites.map(x => ({...x, score: byId[x.id]?.score})) : [];
}

export function selectSp(id) {
    if (meta) {
        select(id);
    }
}

export function topSpId() {
    return results ? results.results[0].id : null;
}

export function refreshTime() {
    if (selectedSp && results && $('spview') && !$('spview').hidden) {
        renderDetail();
    }
}

export async function initSouthPole(hooks) {
    app = hooks;
    try {
        const r = await fetch('/south-pole/sites.json');
        if (!r.ok) {
            throw Error();
        }
        meta = await r.json();
    } catch (e) {
        $('sp-note').textContent = 'No south-pole data yet. Put the NASA LOLA 5 m files in data/south-pole and run build_south_pole.py.';
        return false;
    }
    bindMap();
    for (const b of document.querySelectorAll('[data-spcolor]')) {
        b.onclick = () => {
            colorBy = b.dataset.spcolor;
            for (const x of document.querySelectorAll('[data-spcolor]')) {
                x.classList.toggle('active', x === b);
            }
            draw();
        };
    }
    $('sp-run').onclick = analyze;
    $('sp-fit-rois').onclick = () => {
        const rois = meta.sites.filter(s => s.kind === 'roi');
        const xs = rois.map(s => s.x);
        const ys = rois.map(s => s.y);
        fitTo(Math.min(...xs) - 3000, Math.max(...xs) + 3000, Math.min(...ys) - 3000, Math.max(...ys) + 3000);
    };
    $('sp-fit-all').onclick = () => fitTo(-190000, 190000, -190000, 190000);
    renderDetail();
    renderList();
    return true;
}

export function showPage() {
    requestAnimationFrame(() => {
        if (view.scale === 1) {
            $('sp-fit-all').click();
        } else {
            draw();
        }
        renderDetail();
    });
    if (!results && meta) {
        analyze();
    }
}
