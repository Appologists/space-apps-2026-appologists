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


def analyze(sun, earth, step_minutes, sun_min_el, earth_min_el, panel_m, antenna_m, required_h):
    step_h = step_minutes / 60.0
    sun_dip = horizon_dip_deg(panel_m)
    earth_dip = horizon_dip_deg(antenna_m)
    samples = []
    for s, e in zip(sun, earth):
        sun_ok = s['elevation_deg'] > sun_min_el - sun_dip
        earth_ok = e['elevation_deg'] > earth_min_el - earth_dip
        flux = SOLAR_CONSTANT_W_M2 / (s['range_au'] ** 2) if sun_ok else 0.0
        samples.append(dict(
            t=s['time_utc'],
            sun_az=round(s['azimuth_deg'], 4), sun_el=round(s['elevation_deg'], 4),
            sun_au=s['range_au'],
            earth_az=round(e['azimuth_deg'], 4), earth_el=round(e['elevation_deg'], 4),
            earth_km=round(e['range_au'] * AU_KM, 1),
            sun_ok=sun_ok, earth_ok=earth_ok, both_ok=sun_ok and earth_ok,
            temp_k=round(surface_temp_k(s['elevation_deg'], s['range_au']), 1),
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


@app.get('/data/sites.json')
def sites():
    """Use the team repo's curated site list when this folder sits inside the repo."""
    from flask import send_file
    repo_sites = ROOT.parent / 'data' / 'sites.json'
    local_sites = ROOT / 'public' / 'data' / 'sites.json'
    return send_file(repo_sites if repo_sites.exists() else local_sites, mimetype='application/json')


@app.get('/')
def index():
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
        sun, earth, step, sun_min_el, earth_min_el, panel_m, antenna_m, required_h)
    return jsonify(
        source='NASA/JPL Horizons (observer on the Moon, CENTER coord@301)',
        site=dict(lat=lat, lon=lon),
        window=dict(start=start.strftime('%Y-%m-%d'), days=days, step_minutes=step),
        constraints=constraints, summary=summary, samples=samples,
        retrieved_at_utc=datetime.now(timezone.utc).isoformat(timespec='seconds'),
        model=('Airless apparent directions of body centers over a smooth reference Moon. '
               'No terrain shadowing. Temperature is a radiative-equilibrium estimate.'),
    )


if __name__ == '__main__':
    print('Open http://127.0.0.1:8002')
    app.run(host='127.0.0.1', port=8002, debug=False, threaded=True)
