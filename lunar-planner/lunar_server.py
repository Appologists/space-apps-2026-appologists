"""Lunar Site Planner - local Flask server (port 8002). No npm needed.

Sun and Earth directions come live from NASA/JPL Horizons, observer on the Moon
(CENTER coord@301), targets Sun (10) and Earth (399). Terrain comes from NASA LOLA.
"""
from datetime import datetime, timedelta, timezone
from functools import lru_cache
from pathlib import Path
import math

import requests
from flask import Flask, jsonify, request

ROOT = Path(__file__).resolve().parent
app = Flask(__name__, static_folder=str(ROOT / 'public'), static_url_path='')

URL = 'https://ssd.jpl.nasa.gov/api/horizons.api'
MOON_RADIUS_M = 1737400.0
AU_KM = 149597870.7
SOLAR_CONSTANT_W_M2 = 1361.0     # at 1 AU
ALBEDO = 0.12                    # typical lunar regolith bond albedo
EMISSIVITY = 0.95
SIGMA = 5.670374419e-8
NIGHT_FLOOR_K = 100.0            # approximate equatorial night temperature


class HorizonsError(Exception):
    pass


def parse_table(text):
    """Read the CSV table between $$SOE and $$EOE. Columns are found by name."""
    if '$$SOE' not in text or '$$EOE' not in text:
        raise HorizonsError('NASA response has no ephemeris table.')
    head, rest = text.split('$$SOE', 1)
    body = rest.split('$$EOE', 1)[0]
    header = None
    for line in reversed(head.splitlines()):
        if 'Date__(UT)' in line:
            header = [cell.strip() for cell in line.split(',')]
            break
    if header is None:
        raise HorizonsError('NASA table header not found.')

    def column(test):
        for index, name in enumerate(header):
            if test(name):
                return index
        raise HorizonsError('NASA table column missing.')

    i_az = column(lambda n: n.startswith('Azimuth') or n.startswith('Azi_'))
    i_el = column(lambda n: n.startswith('Elevation') or n.startswith('Elev_'))
    i_range = column(lambda n: n == 'delta')
    rows = []
    for line in body.strip().splitlines():
        cells = [cell.strip() for cell in line.split(',')]
        when = datetime.strptime(cells[0], '%Y-%b-%d %H:%M').replace(tzinfo=timezone.utc)
        row = dict(
            time_utc=when.strftime('%Y-%m-%dT%H:%MZ'),
            azimuth_deg=float(cells[i_az]),
            elevation_deg=float(cells[i_el]),
            range_au=float(cells[i_range]),
        )
        if not all(math.isfinite(row[k]) for k in ('azimuth_deg', 'elevation_deg', 'range_au')):
            raise HorizonsError('NASA returned invalid numbers.')
        rows.append(row)
    if not rows:
        raise HorizonsError('NASA returned no rows.')
    return rows


def horizons_params(target, lat, lon, start, end, step_minutes):
    settings = dict(
        COMMAND=str(target), OBJ_DATA='NO', MAKE_EPHEM='YES', EPHEM_TYPE='OBSERVER',
        CENTER='coord@301', COORD_TYPE='GEODETIC',
        SITE_COORD='%.5f,%.5f,0' % (lon, lat),
        START_TIME=start.strftime('%Y-%m-%d %H:%M'), STOP_TIME=end.strftime('%Y-%m-%d %H:%M'),
        STEP_SIZE='%d min' % step_minutes, QUANTITIES='4,20', CSV_FORMAT='YES',
        CAL_FORMAT='CAL', TIME_DIGITS='MINUTES', TIME_TYPE='UT', ANG_FORMAT='DEG',
        APPARENT='AIRLESS', ELEV_CUT='-90', EXTRA_PREC='YES',
    )
    params = {key: "'" + value + "'" for key, value in settings.items()}
    params['format'] = 'json'
    return params


def fetch(target, lat, lon, start, end, step_minutes):
    params = horizons_params(target, lat, lon, start, end, step_minutes)
    response = requests.get(URL, params=params, timeout=(10, 90))
    response.raise_for_status()
    payload = response.json()
    if payload.get('error'):
        raise HorizonsError(str(payload['error']))
    return parse_table(payload.get('result', ''))


@lru_cache(maxsize=64)
def ephemeris(lat, lon, start_day, days):
    start = datetime.strptime(start_day, '%Y-%m-%d')
    step = 30 if days <= 3 else 60
    # Each sample stands for one step, so the last sample starts one step before the end.
    end = start + timedelta(days=days) - timedelta(minutes=step)
    sun = fetch(10, lat, lon, start, end, step)
    earth = fetch(399, lat, lon, start, end, step)
    if [r['time_utc'] for r in sun] != [r['time_utc'] for r in earth]:
        raise HorizonsError('Sun and Earth timestamps do not match.')
    return sun, earth, step


def horizon_dip_deg(height_m):
    """Angle the true horizon drops below level for an eye at height_m on a smooth Moon."""
    if height_m <= 0:
        return 0.0
    return math.degrees(math.acos(MOON_RADIUS_M / (MOON_RADIUS_M + height_m)))


def surface_temp_k(sun_el_deg, sun_au):
    """Radiative-equilibrium model for flat regolith. An estimate, not a measurement."""
    if sun_el_deg <= 0:
        return NIGHT_FLOOR_K
    flux = SOLAR_CONSTANT_W_M2 / (sun_au * sun_au) * math.sin(math.radians(sun_el_deg))
    temp = (flux * (1 - ALBEDO) / (EMISSIVITY * SIGMA)) ** 0.25
    return max(NIGHT_FLOOR_K, temp)


def find_runs(flags):
    """Return (first_index, last_index) for each block of True values."""
    runs = []
    start = None
    for index, flag in enumerate(flags):
        if flag and start is None:
            start = index
        if not flag and start is not None:
            runs.append((start, index - 1))
            start = None
    if start is not None:
        runs.append((start, len(flags) - 1))
    return runs


def run_summary(flags, times, step_h):
    runs = find_runs(flags)
    total = sum(flags) * step_h
    if not runs:
        return dict(total_h=0.0, longest_h=0.0, segments=0, best_start=None,
                    best_end=None, best_touches_window_edge=False)
    first, last = max(runs, key=lambda r: (r[1] - r[0], -r[0]))
    end_time = datetime.strptime(times[last], '%Y-%m-%dT%H:%MZ') + timedelta(hours=step_h)
    return dict(
        total_h=round(total, 2),
        longest_h=round((last - first + 1) * step_h, 2),
        segments=len(runs),
        best_start=times[first],
        best_end=end_time.strftime('%Y-%m-%dT%H:%MZ'),
        best_touches_window_edge=(first == 0 or last == len(flags) - 1),
    )


def analyze(sun, earth, step_minutes, sun_min_el, earth_min_el, panel_m, antenna_m, required_h, lat=None, lon=None):
    step_h = step_minutes / 60.0
    sun_dip = horizon_dip_deg(panel_m)
    earth_dip = horizon_dip_deg(antenna_m)
    samples = []
    for s, e in zip(sun, earth):
        sun_ok = s['elevation_deg'] > sun_min_el - sun_dip
        earth_ok = e['elevation_deg'] > earth_min_el - earth_dip
        flux = SOLAR_CONSTANT_W_M2 / (s['range_au'] ** 2) if sun_ok else 0.0
        model_k = surface_temp_k(s['elevation_deg'], s['range_au'])
        measured = None
        if lat is not None and diviner() is not None:
            ss = subsolar_lon(lat, lon, s['azimuth_deg'], s['elevation_deg'])
            measured = float(diviner_temp(lat, lon, ss))
        samples.append(dict(
            t=s['time_utc'],
            sun_az=round(s['azimuth_deg'], 4), sun_el=round(s['elevation_deg'], 4),
            sun_au=s['range_au'],
            earth_az=round(e['azimuth_deg'], 4), earth_el=round(e['elevation_deg'], 4),
            earth_km=round(e['range_au'] * AU_KM, 1),
            sun_ok=sun_ok, earth_ok=earth_ok, both_ok=sun_ok and earth_ok,
            temp_k=round(measured if measured is not None else model_k, 1),
            temp_model_k=round(model_k, 1),
            flux_w_m2=round(flux, 1),
        ))
    times = [x['t'] for x in samples]
    both = run_summary([x['both_ok'] for x in samples], times, step_h)
    flat_energy = sum(
        x['flux_w_m2'] * max(0.0, math.sin(math.radians(x['sun_el']))) for x in samples
    ) * step_h / 1000
    summary = dict(
        sun=run_summary([x['sun_ok'] for x in samples], times, step_h),
        earth=run_summary([x['earth_ok'] for x in samples], times, step_h),
        both=both,
        energy_tracking_kwh_m2=round(sum(x['flux_w_m2'] for x in samples) * step_h / 1000, 2),
        energy_flat_kwh_m2=round(flat_energy, 2),
        temp_min_k=min(x['temp_k'] for x in samples),
        temp_max_k=max(x['temp_k'] for x in samples),
        mean_sun_au=round(sum(x['sun_au'] for x in samples) / len(samples), 6),
        mean_earth_km=round(sum(x['earth_km'] for x in samples) / len(samples), 0),
        meets_requirement=both['longest_h'] >= required_h,
        temp_source=('NASA LRO Diviner measured (0.5 deg map, by Sun position)' if diviner() is not None
                     else 'our estimate (radiative equilibrium)'),
    )
    constraints = dict(
        sun_min_elevation_deg=sun_min_el, earth_min_elevation_deg=earth_min_el,
        solar_panel_height_m=panel_m, antenna_height_m=antenna_m,
        sun_horizon_dip_deg=round(sun_dip, 4), earth_horizon_dip_deg=round(earth_dip, 4),
        required_continuous_h=required_h,
    )
    return samples, summary, constraints


def number(name, default, low, high):
    raw = request.args.get(name, default)
    value = float(raw)
    if not math.isfinite(value) or value < low or value > high:
        raise ValueError('%s must be from %s to %s.' % (name, low, high))
    return value


DEM_PATH = ROOT / 'data' / 'ldem_16.npy'
MOON_RADIUS_KM = MOON_RADIUS_M / 1000
_dem = None


def dem():
    global _dem
    if _dem is None:
        if not DEM_PATH.exists():
            raise FileNotFoundError('Terrain data missing. Run build_terrain.py once.')
        import numpy
        _dem = numpy.load(DEM_PATH, mmap_mode='r')
    return _dem


def terrain_patch(lat, lon, half_km, n):
    """Heights on a local east/north grid around a site, with Moon curvature included."""
    import numpy as np
    grid = dem()
    rows, cols = grid.shape
    ppd = cols / 360.0
    axis = np.linspace(-half_km, half_km, n)
    east, north = np.meshgrid(axis, axis[::-1])
    dist = np.hypot(east, north)
    c = dist / MOON_RADIUS_KM
    bearing = np.arctan2(east, north)
    p0, l0 = math.radians(lat), math.radians(lon)
    p = np.arcsin(np.sin(p0) * np.cos(c) + np.cos(p0) * np.sin(c) * np.cos(bearing))
    l = l0 + np.arctan2(np.sin(bearing) * np.sin(c) * np.cos(p0), np.cos(c) - np.sin(p0) * np.sin(p))
    x = ((np.degrees(l) + 180.0) % 360.0) * ppd - 0.5
    y = np.clip((90.0 - np.degrees(p)) * ppd - 0.5, 0, rows - 1.001)
    x0 = np.floor(x).astype(int)
    y0 = np.floor(y).astype(int)
    fx = x - x0
    fy = y - y0
    xa = x0 % cols
    xb = (x0 + 1) % cols
    h = (grid[y0, xa] * (1 - fx) * (1 - fy) + grid[y0, xb] * fx * (1 - fy)
         + grid[y0 + 1, xa] * (1 - fx) * fy + grid[y0 + 1, xb] * fx * fy)
    # Height above the site's local level plane (drops away with distance).
    z = (MOON_RADIUS_KM + h) * np.cos(c) - MOON_RADIUS_KM
    return h, z


@app.get('/api/heightmap')
def heightmap():
    """One Cesium terrain tile (geographic scheme, 2 x 1 tiles at level 0) from LOLA, in metres."""
    import numpy as np
    from flask import Response
    try:
        level = int(request.args['level'])
        x = int(request.args['x'])
        y = int(request.args['y'])
        size = int(request.args.get('size', 65))
        if not (0 <= level <= 12 and 2 <= size <= 129):
            raise ValueError
    except (KeyError, ValueError):
        return jsonify(error='Need level, x, y.'), 400
    try:
        grid = dem()
    except FileNotFoundError as exc:
        return jsonify(error=str(exc)), 404
    rows, cols = grid.shape
    ppd = cols / 360.0
    span_lon = 360.0 / (2 ** (level + 1))
    span_lat = 180.0 / (2 ** level)
    west = -180.0 + x * span_lon
    north = 90.0 - y * span_lat
    lons = west + np.linspace(0, span_lon, size)
    lats = north - np.linspace(0, span_lat, size)
    lon_g, lat_g = np.meshgrid(lons, lats)
    px = ((lon_g + 180.0) % 360.0) * ppd - 0.5
    py = np.clip((90.0 - lat_g) * ppd - 0.5, 0, rows - 1.001)
    x0 = np.floor(px).astype(int)
    y0 = np.floor(py).astype(int)
    fx = px - x0
    fy = py - y0
    xa = x0 % cols
    xb = (x0 + 1) % cols
    h = (grid[y0, xa] * (1 - fx) * (1 - fy) + grid[y0, xb] * fx * (1 - fy)
         + grid[y0 + 1, xa] * (1 - fx) * fy + grid[y0 + 1, xb] * fx * fy)
    body = (h * 1000.0).astype('<f4').tobytes()
    return Response(body, mimetype='application/octet-stream',
                    headers={'Cache-Control': 'public, max-age=86400'})


@app.get('/api/point')
def point():
    """Elevation and slope at one spot from LOLA ldem_16 (slope over about 2 km, from neighbouring pixels)."""
    try:
        lat = number('lat', None, -90, 90)
        lon = number('lon', None, -180, 360)
    except (TypeError, ValueError):
        return jsonify(error='Check lat and lon.'), 400
    try:
        grid = dem()
    except FileNotFoundError as exc:
        return jsonify(error=str(exc)), 404
    rows, cols = grid.shape
    ppd = cols / 360.0
    x = int(((lon + 180.0) % 360.0) * ppd) % cols
    y = min(rows - 2, max(1, int((90.0 - lat) * ppd)))
    h = float(grid[y, x])
    east_km = 2 * MOON_RADIUS_KM * math.cos(math.radians(lat)) * math.radians(1 / ppd)
    north_km = 2 * MOON_RADIUS_KM * math.radians(1 / ppd)
    dzdx = (float(grid[y, (x + 1) % cols]) - float(grid[y, (x - 1) % cols])) / max(east_km, 1e-3)
    dzdy = (float(grid[y - 1, x]) - float(grid[y + 1, x])) / north_km
    slope = math.degrees(math.atan(math.hypot(dzdx, dzdy)))
    return jsonify(elevation_km=round(h, 3), slope_deg=round(slope, 2), baseline_km=round(north_km, 2),
                   source='NASA LRO LOLA ldem_16')


@app.get('/api/terrain')
def terrain():
    try:
        lat = number('lat', None, -90, 90)
        lon = number('lon', None, -180, 360)
        half_km = number('half_km', 30, 2, 150)
        n = int(number('n', 121, 11, 241))
    except (TypeError, ValueError):
        return jsonify(error='Check lat, lon, half_km and n.'), 400
    try:
        h, z = terrain_patch(lat, lon, half_km, n)
    except FileNotFoundError as exc:
        return jsonify(error=str(exc)), 404
    mid = n // 2
    return jsonify(
        source='NASA LRO LOLA ldem_16 (16 px/deg, about 1.9 km), bilinear',
        lat=lat, lon=lon, n=n, half_km=half_km, spacing_km=2 * half_km / (n - 1),
        site_elevation_km=round(float(h[mid, mid]), 4),
        z_km=[round(float(v), 4) for v in z.ravel()],
        elevation_km=[round(float(v), 4) for v in h.ravel()],
    )


KEYS_PATH = ROOT / 'lunar_keys.json'
_epic_cache = {}


@app.get('/api/config')
def config():
    """Browser keys live in lunar_keys.json (kept out of git), not in the page source."""
    import json
    keys = {}
    if KEYS_PATH.exists():
        keys = json.loads(KEYS_PATH.read_text(encoding='utf-8-sig'))
    return jsonify(cesium_ion_token=keys.get('cesium_ion_token', ''),
                   google_maps_key=keys.get('google_maps_key', ''))


@app.get('/api/epic')
def epic():
    """Latest NASA EPIC full-disc Earth image (DSCOVR spacecraft)."""
    import time
    if _epic_cache.get('expires', 0) > time.time():
        return jsonify(_epic_cache['data'])
    try:
        response = requests.get('https://epic.gsfc.nasa.gov/api/natural', timeout=(10, 30))
        response.raise_for_status()
        latest = response.json()[-1]
        when = datetime.strptime(latest['date'], '%Y-%m-%d %H:%M:%S')
        data = dict(
            url='https://epic.gsfc.nasa.gov/archive/natural/%s/jpg/%s.jpg' % (when.strftime('%Y/%m/%d'), latest['image']),
            date_utc=when.strftime('%Y-%m-%d %H:%M'),
            caption=latest.get('caption', ''),
            centroid=latest.get('centroid_coordinates', {}),
        )
    except (requests.RequestException, ValueError, KeyError, IndexError) as exc:
        return jsonify(error='NASA EPIC request failed: ' + str(exc)), 502
    _epic_cache.update(data=data, expires=time.time() + 3600)
    return jsonify(data)


# ---------------- NASA LRO Diviner measured temperatures ----------------
DIV_PATH = ROOT / 'derived' / 'diviner_tbol.npz'
_div = {}


def diviner():
    """24 global maps (subsolar longitude 0, 15, ... 345 E) of bolometric temperature, kelvin, 0.5 deg."""
    import numpy as np
    if 'maps' not in _div:
        if not DIV_PATH.exists():
            _div['maps'] = None
        else:
            d = np.load(DIV_PATH)
            _div['maps'] = d['maps'].astype(np.float32) * float(d['step']) + float(d['offset'])
    return _div['maps']


def diviner_temp(lat, lon, sslon):
    """Measured temperature at a place for a given subsolar longitude (bilinear in space, linear in sun position)."""
    import numpy as np
    maps = diviner()
    if maps is None:
        return None
    lat = np.asarray(lat, float)
    lon = np.asarray(lon, float)
    fy = np.clip((89.75 - lat) / 0.5, 0, 359.0)
    fx = ((lon + 179.75) / 0.5) % 720
    y0 = np.floor(np.minimum(fy, 358.999)).astype(int)
    x0 = np.floor(fx).astype(int) % 720
    x1 = (x0 + 1) % 720
    ay = fy - y0
    ax = fx - np.floor(fx)
    s = (np.asarray(sslon, float) % 360) / 15.0
    i0 = np.floor(s).astype(int) % 24
    i1 = (i0 + 1) % 24
    w = s - np.floor(s)

    def at(i):
        m = maps[i, y0, x0] * (1 - ax) * (1 - ay) + maps[i, y0, x1] * ax * (1 - ay)
        return m + maps[i, y0 + 1, x0] * (1 - ax) * ay + maps[i, y0 + 1, x1] * ax * ay

    return at(i0) * (1 - w) + at(i1) * w


def subsolar_lon(lat, lon, az_deg, el_deg):
    """Subsolar longitude (deg E) from the Sun's direction at a site."""
    e, n, u = enu(lat, lon)
    a, l = math.radians(az_deg), math.radians(el_deg)
    v = [e[k] * math.sin(a) * math.cos(l) + n[k] * math.cos(a) * math.cos(l) + u[k] * math.sin(l) for k in range(3)]
    return math.degrees(math.atan2(v[1], v[0])) % 360


TEMP_STOPS = [(40, (25, 35, 90)), (130, (50, 120, 190)), (220, (230, 220, 190)), (310, (235, 150, 80)), (400, (200, 60, 50))]


def temp_rgb(k):
    import numpy as np
    k = np.clip(k, TEMP_STOPS[0][0], TEMP_STOPS[-1][0])
    out = np.zeros(k.shape + (3,), np.float32)
    for (t0, c0), (t1, c1) in zip(TEMP_STOPS[:-1], TEMP_STOPS[1:]):
        m = (k >= t0) & (k <= t1)
        f = ((k - t0) / (t1 - t0))[..., None]
        out[m] = (np.array(c0) * (1 - f) + np.array(c1) * f)[m]
    return out.astype(np.uint8)


_div_png = {}


@app.get('/api/diviner/map')
def diviner_map():
    """Temperature map as a PNG: kind=now (needs sslon), max, min (of the 24 snapshots)."""
    import io
    import numpy as np
    from flask import Response
    from PIL import Image
    maps = diviner()
    if maps is None:
        return jsonify(error='Diviner data missing. Run build_diviner.py.'), 404
    kind = request.args.get('kind', 'now')
    if kind == 'now':
        sslon = round(float(request.args.get('sslon', 0))) % 360
        key = ('now', sslon)
        if key not in _div_png:
            s = sslon / 15.0
            i0 = int(math.floor(s)) % 24
            w = s - math.floor(s)
            grid = maps[i0] * (1 - w) + maps[(i0 + 1) % 24] * w
            _div_png[key] = grid
        grid = _div_png[key]
    elif kind in ('max', 'min'):
        grid = maps.max(axis=0) if kind == 'max' else maps.min(axis=0)
    else:
        return jsonify(error='kind must be now, max or min'), 400
    buf = io.BytesIO()
    Image.fromarray(temp_rgb(grid)).save(buf, 'PNG')
    if len(_div_png) > 400:
        _div_png.clear()
    return Response(buf.getvalue(), mimetype='image/png', headers={'Cache-Control': 'public, max-age=86400'})


@app.get('/api/diviner/point')
def diviner_point():
    """Measured temperature through a lunar day at one place: 24 values, one per 15 deg of Sun position."""
    try:
        lat = number('lat', None, -90, 90)
        lon = number('lon', None, -180, 360)
    except (TypeError, ValueError):
        return jsonify(error='Check lat and lon.'), 400
    if diviner() is None:
        return jsonify(error='Diviner data missing.'), 404
    lon = ((lon + 180) % 360) - 180
    curve = [round(float(diviner_temp(lat, lon, s)), 1) for s in range(0, 360, 15)]
    # Local solar time for each snapshot: noon when the Sun is over this longitude.
    local = [round(((12 + (lon - s) / 15.0) % 24), 2) for s in range(0, 360, 15)]
    return jsonify(subsolar_lon=list(range(0, 360, 15)), local_time_h=local, temp_k=curve,
                   min_k=min(curve), max_k=max(curve),
                   source='NASA LRO Diviner bolometric temperature snapshots, 0.5 deg grid (Williams et al. 2017)')


SP_PATH = ROOT / 'public' / 'south-pole' / 'sites.json'
_sp = {}


def sp_data():
    """South-pole sites made by build_south_pole.py (cached until the file changes)."""
    import json
    if not SP_PATH.exists():
        return None
    mtime = SP_PATH.stat().st_mtime
    if _sp.get('mtime') != mtime:
        _sp.update(mtime=mtime, data=json.loads(SP_PATH.read_text()))
    return _sp['data']


def enu(lat, lon):
    """East, north, up unit vectors (Moon-fixed, x to 0N 0E, z north)."""
    p, l = math.radians(lat), math.radians(lon)
    east = (-math.sin(l), math.cos(l), 0.0)
    north = (-math.sin(p) * math.cos(l), -math.sin(p) * math.sin(l), math.cos(p))
    up = (math.cos(p) * math.cos(l), math.cos(p) * math.sin(l), math.sin(p))
    return east, north, up


@app.get('/api/southpole')
def southpole():
    """Score every south-pole site with its real terrain horizon.

    One Horizons query near the pole gives the Sun and Earth directions; they are rotated to each site
    (sites are within about 200 km, so the error is under 0.03 degrees). A body counts as visible when
    its centre is above the terrain horizon at its azimuth.
    """
    import numpy as np
    data = sp_data()
    if data is None:
        return jsonify(error='South-pole data missing. Run build_south_pole.py.'), 404
    try:
        start_day = request.args.get('start', datetime.now(timezone.utc).strftime('%Y-%m-%d'))
        start = datetime.strptime(start_day, '%Y-%m-%d')
        days = int(number('days', 7, 1, 15))
        need_h = number('need_h', 24, 0, 400)
    except (TypeError, ValueError):
        return jsonify(error='Check start (YYYY-MM-DD) and days.'), 400
    ref_lat, ref_lon = -89.9, 0.0
    try:
        sun, earth, step = ephemeris(ref_lat, ref_lon, start.strftime('%Y-%m-%d'), days)
    except (requests.RequestException, ValueError, HorizonsError) as exc:
        return jsonify(error='NASA Horizons request failed: ' + str(exc)), 502
    e0, n0, u0 = (np.array(v) for v in enu(ref_lat, ref_lon))

    def vectors(rows):
        az = np.radians([r['azimuth_deg'] for r in rows])
        el = np.radians([r['elevation_deg'] for r in rows])
        loc = np.stack([np.sin(az) * np.cos(el), np.cos(az) * np.cos(el), np.sin(el)], axis=1)
        return loc[:, :1] * e0 + loc[:, 1:2] * n0 + loc[:, 2:] * u0

    sun_v = vectors(sun)
    earth_v = vectors(earth)
    sun_au = np.array([r['range_au'] for r in sun])
    times = [r['time_utc'] for r in sun]
    step_h = step / 60.0
    hours = len(times) * step_h
    results = []
    for s in data['sites']:
        e, n, u = (np.array(v) for v in enu(s['lat'], s['lon']))
        hz = np.array(s['horizon'])

        def local(v):
            az = (np.degrees(np.arctan2(v @ e, v @ n)) + 360) % 360
            el = np.degrees(np.arcsin(np.clip(v @ u, -1, 1)))
            return az, el

        def horizon_at(az):
            f = az / (360.0 / len(hz))
            i0 = np.floor(f).astype(int) % len(hz)
            i1 = (i0 + 1) % len(hz)
            w = f - np.floor(f)
            return hz[i0] * (1 - w) + hz[i1] * w

        saz, sel = local(sun_v)
        eaz, eel = local(earth_v)
        sun_ok = sel > horizon_at(saz)
        earth_ok = eel > horizon_at(eaz)
        both = sun_ok & earth_ok
        # Ground normal from the 5 m heights: tilt toward the downhill direction.
        t, d = math.radians(s.get('tilt_deg', 0.0)), math.radians(s.get('downhill_deg', 0.0))
        normal = math.sin(t) * math.sin(d) * e + math.sin(t) * math.cos(d) * n + math.cos(t) * u
        cos_i = np.clip(sun_v @ normal, 0, 1)
        temps = np.array([surface_temp_k(90 - math.degrees(math.acos(ci)) if ok and ci > 0 else -1, au)
                          for ci, ok, au in zip(cos_i, sun_ok, sun_au)])
        tl = times
        sslon = (np.degrees(np.arctan2(sun_v[:, 1], sun_v[:, 0])) + 360) % 360
        meas = diviner_temp(np.full(len(sslon), s['lat']), np.full(len(sslon), s['lon']), sslon)
        summ = dict(
            sun=run_summary(list(sun_ok), tl, step_h),
            earth=run_summary(list(earth_ok), tl, step_h),
            both=run_summary(list(both), tl, step_h),
            temp_min_k=round(float(temps.min()), 1),
            temp_max_k=round(float(temps.max()), 1),
            temp_mean_k=round(float(temps.mean()), 1),
            temp_landing_k=round(float(temps[0]), 1),
            sun_el_max=round(float(sel.max()), 2),
        )
        if meas is not None:
            summ.update(div_min_k=round(float(meas.min()), 1), div_max_k=round(float(meas.max()), 1),
                        div_mean_k=round(float(meas.mean()), 1), div_landing_k=round(float(meas[0]), 1))
        summ['meets_requirement'] = summ['both']['longest_h'] >= need_h
        parts = {
            'sunlight': 0.7 * summ['sun']['longest_h'] / hours + 0.3 * summ['sun']['total_h'] / hours,
            'earth': 0.5 * summ['earth']['longest_h'] / hours + 0.5 * summ['earth']['total_h'] / hours,
            'both': summ['both']['longest_h'] / hours,
            'safety': s.get('frac_safe'),
        }
        weights = {'sunlight': 0.3, 'earth': 0.2, 'both': 0.3, 'safety': 0.2}
        used = {k: w for k, w in weights.items() if parts[k] is not None}
        score = round(100 * sum(parts[k] * w for k, w in used.items()) / sum(used.values()))
        results.append(dict(
            id=s['id'], score=score, safety_known=parts['safety'] is not None, summary=summ,
            sun_bits=''.join('1' if v else '0' for v in sun_ok),
            earth_bits=''.join('1' if v else '0' for v in earth_ok),
            temps=[int(round(v)) for v in temps],
            temps_diviner=[int(round(v)) for v in meas] if meas is not None else None,
            sun_az=[round(float(v), 2) for v in saz], sun_el=[round(float(v), 2) for v in sel],
            earth_az=[round(float(v), 2) for v in eaz], earth_el=[round(float(v), 2) for v in eel],
        ))
    results.sort(key=lambda r: (r['summary']['meets_requirement'], r['score']), reverse=True)
    return jsonify(
        window=dict(start=start.strftime('%Y-%m-%d'), days=days, step_minutes=step, times=times),
        reference='NASA/JPL Horizons at 89.9 S 0 E, rotated to each site',
        model=('Sun and Earth centres against each site\'s terrain horizon (5 m LOLA tiles plus regional LOLA). '
               'Measured temperature: NASA LRO Diviner, 0.5 deg (about 15 km) cells. '
               'Ground estimate: radiative equilibrium on the tilted 5 m ground, 100 K floor in shadow.'),
        results=results,
    )


@app.get('/api/status')
def status():
    """What is installed, so the page only asks for things that exist (no 404s)."""
    import json
    keys = {}
    if KEYS_PATH.exists():
        try:
            keys = json.loads(KEYS_PATH.read_text(encoding='utf-8-sig'))
        except ValueError:
            keys = {}
    usable = lambda v: bool(v) and not str(v).startswith('paste ')
    return jsonify(
        terrain=DEM_PATH.exists(),
        elevation_grid=(ROOT / 'public' / 'textures' / 'moon-elevation-grid.bin').exists(),
        cesium=usable(keys.get('cesium_ion_token')),
        google=usable(keys.get('google_maps_key')),
        diviner=DIV_PATH.exists(),
        composite=(ROOT / 'public' / 'diviner' / 'composite.webp').exists(),
    )


@app.get('/textures/moon-hd.jpg')
def moon_hd():
    """The team repo's 4k LROC colour map when this folder sits in the repo; otherwise the 2k one."""
    from flask import send_file
    hd = ROOT.parent / 'public' / 'textures' / 'moon_lroc_color_4k.jpg'
    return send_file(hd if hd.exists() else ROOT / 'public' / 'textures' / 'moon.jpg', mimetype='image/jpeg')


@app.get('/data/sites.json')
def sites():
    """Use the team repo's curated site list when this folder sits inside the repo."""
    from flask import send_file
    repo_sites = ROOT.parent / 'data' / 'sites.json'
    local_sites = ROOT / 'public' / 'data' / 'sites.json'
    return send_file(repo_sites if repo_sites.exists() else local_sites, mimetype='application/json')


@app.get('/')
def index():
    # The team's app (index.html and src/ at the repo root), served by team_api.py. Without it: the classic pages.
    if team_api.team_app_present():
        return team_api.team_index()
    return app.send_static_file('lunar.html')


@app.get('/classic')
def classic():
    return app.send_static_file('lunar.html')


@app.get('/api/health')
def health():
    return jsonify(status='ok', app='Apologistics Lunar Site Planner')


@app.get('/api/site')
def site():
    try:
        lat = round(number('lat', None, -90, 90), 4)
        lon = number('lon', None, -180, 360)
        if lon > 180:
            lon -= 360
        lon = round(lon, 4)
        start_day = request.args.get('start', datetime.now(timezone.utc).strftime('%Y-%m-%d'))
        start = datetime.strptime(start_day, '%Y-%m-%d')
        if not 1950 <= start.year <= 2099:
            raise ValueError('Start date must be from 1950 through 2099.')
        days = int(number('days', 7, 1, 15))
        sun_min_el = number('sun_min', 0, -5, 45)
        earth_min_el = number('earth_min', 0, -5, 45)
        panel_m = number('panel_m', 1.5, 0, 100)
        antenna_m = number('antenna_m', 2.0, 0, 100)
        required_h = number('need_h', 24, 0, 400)
    except (TypeError, ValueError) as exc:
        message = str(exc) if 'must' in str(exc) else 'Check lat, lon, start (YYYY-MM-DD) and the numbers.'
        return jsonify(error=message), 400
    try:
        sun, earth, step = ephemeris(lat, lon, start.strftime('%Y-%m-%d'), days)
    except (requests.RequestException, ValueError, HorizonsError) as exc:
        return jsonify(error='NASA Horizons request failed: ' + str(exc)), 502
    samples, summary, constraints = analyze(
        sun, earth, step, sun_min_el, earth_min_el, panel_m, antenna_m, required_h, lat, lon)
    return jsonify(
        source='NASA/JPL Horizons (observer on the Moon, CENTER coord@301)',
        site=dict(lat=lat, lon=lon),
        window=dict(start=start.strftime('%Y-%m-%d'), days=days, step_minutes=step),
        constraints=constraints, summary=summary, samples=samples,
        retrieved_at_utc=datetime.now(timezone.utc).isoformat(timespec='seconds'),
        model=('Airless apparent directions of body centers over a smooth reference Moon. '
               'No terrain shadowing. Temperature is a radiative-equilibrium estimate.'),
    )


import team_api  # noqa: E402  (needs fetch above)

team_api.HORIZONS_FETCH = fetch
app.register_blueprint(team_api.bp)

import learn_api  # noqa: E402  (the education section, ../education/, at /learn)

app.register_blueprint(learn_api.bp)

if __name__ == '__main__':
    print('Open http://127.0.0.1:8002  (the team app; the classic planner is at /classic)')
    app.run(host='127.0.0.1', port=8002, debug=False, threaded=True)
