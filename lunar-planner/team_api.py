"""The team app's server, in Python.

The team's app (index.html and src/ at the repo root) normally runs on the Vite dev server, whose Node
plugin (server/*.mjs) answers these requests:

    GET  /api/terrain/info                    which terrain datasets exist, and which are downloaded
    GET  /api/terrain/polar?lat=&lon=&source= the ground around a point, as a polar grid (binary)
    POST /api/terrain/landing-search          the landing-site finder (rasters out, binary)
    GET  /api/horizons?...                    JPL Horizons, forwarded (Horizons sends no CORS headers)

This module answers the same requests with the same wire formats, so the team's own front-end code runs
unchanged on Flask, with no Node and no npm. It also serves that front-end: src/*.js with the two things
only Vite understands rewritten (a CSS import and a JSON import), and an import map for `three` and
`astronomy-engine`, which are single vendored files in public/vendor/team/.

What is the same as the Node version: the datasets and their order (server/terrain-sources.mjs), how
heights and slopes are read (server/equirect.mjs, server/lola-polar.mjs), "best available" (composite.mjs),
the polar patch (samplePolarPatch), and the landing search step by step (server/landing-search.mjs,
src/surface/shadows.js, src/finder/score.js, src/finder/grid.js).
What differs: Sun and Earth directions come from JPL Horizons at the search centre (the Node version
computes them with Astronomy Engine, which the team checks against Horizons). The 59 m tiled dataset
(lola-global-512) is not read here yet.
"""
import json
import math
import re
import time
from datetime import datetime, timedelta
from pathlib import Path

import numpy as np
import requests
from flask import Blueprint, Response, abort, jsonify, request, send_file

HERE = Path(__file__).resolve().parent
REPO = HERE.parent
RAW = REPO / 'data' / 'raw'
R = 1737400.0
DEG = math.pi / 180
NONE = -1e9  # "no terrain, no shadow" (src/surface/shadows.js)
HORIZONS_URL = 'https://ssd.jpl.nasa.gov/api/horizons.api'

bp = Blueprint('team', __name__)
HORIZONS_FETCH = None  # set by lunar_server.py: fetch(target, lat, lon, start, end, step_minutes) -> rows


# ================================================================================================
# Terrain datasets (server/terrain-sources.mjs)
# ================================================================================================

def _fetch_hint(dataset_id, large=False):
    return 'python lunar-planner/fetch_data.py ' + dataset_id + (' --large' if large else '')


SOURCES = [
    dict(id='lola-south-80s-80m', label='South pole, 80 m', coverage='80° S to the south pole', southOfLat=-80,
         pixelM=80, sizeText='115 MB', fetch=_fetch_hint('lola-south-80s-80m')),
    dict(id='lola-global-512', label='Whole Moon, 59 m', coverage='the whole Moon', southOfLat=None, pixelM=59,
         sizeText='34 GB in 16 tiles', fetch='npm run data:fetch -- lola-global-512 --large',
         note='The Flask version does not read this dataset yet; the npm version does.'),
    dict(id='ldem-64', label='Whole Moon, 470 m', coverage='the whole Moon', southOfLat=None, pixelM=474,
         sizeText='1.06 GB', fetch=_fetch_hint('ldem-64', large=True), note='Uses about 1 GB of disk; read a piece at a time.'),
    dict(id='ldem-16', label='Whole Moon, 1.9 km', coverage='the whole Moon', southOfLat=None, pixelM=1895,
         sizeText='66 MB', fetch=_fetch_hint('ldem-16')),
]
REACH_DEG = 11  # a regional grid joins "best available" within this many degrees of its edge


def _files(source_id):
    """The files that hold a dataset on this computer, or None if it is not downloaded."""
    d = RAW / source_id
    if source_id == 'lola-south-80s-80m':
        img, lbl = d / 'ldem_80s_80m.img', d / 'ldem_80s_80m.lbl'
        return (img, lbl) if img.exists() and lbl.exists() else None
    if source_id == 'ldem-64':
        tif = d / 'ldem_64.tif'
        return (tif,) if tif.exists() else None
    if source_id == 'ldem-16':
        tif = d / 'ldem_16.tif'
        if tif.exists():
            return (tif,)
        npy = HERE / 'data' / 'ldem_16.npy'  # what lunar-planner/build_terrain.py makes
        return (npy,) if npy.exists() else None
    return None


def describe(source):
    return {**source, 'installed': _files(source['id']) is not None}


def covers(source, lat):
    return source['southOfLat'] is None or lat <= source['southOfLat']


def _read_tiff_layout(path):
    """First IFD of a classic, uncompressed, single-band float32 TIFF (server/equirect.mjs readTiffLayout)."""
    with open(path, 'rb') as f:
        head = f.read(8)
        if head[:2] not in (b'II', b'MM'):
            raise ValueError('%s is not a TIFF file' % path)
        end = '<' if head[:2] == b'II' else '>'
        magic, ifd = np.frombuffer(head[2:4], end + 'u2')[0], np.frombuffer(head[4:8], end + 'u4')[0]
        if magic != 42:
            raise ValueError('%s: only classic TIFF is supported' % path)
        f.seek(int(ifd))
        count = int(np.frombuffer(f.read(2), end + 'u2')[0])
        raw = f.read(count * 12)
        tags = {}
        for i in range(count):
            e = raw[i * 12:(i + 1) * 12]
            tag, typ = (int(v) for v in np.frombuffer(e[:4], end + 'u2'))
            n = int(np.frombuffer(e[4:8], end + 'u4')[0])
            size = 2 if typ == 3 else 4 if typ == 4 else 0
            if not size:
                continue
            if size * n <= 4:
                data = e[8:8 + size * n]
            else:
                f.seek(int(np.frombuffer(e[8:12], end + 'u4')[0]))
                data = f.read(size * n)
            tags[tag] = [int(v) for v in np.frombuffer(data, end + ('u2' if size == 2 else 'u4'))]
    one = lambda t, d=None: tags.get(t, [d])[0]
    width, height = one(256), one(257)
    if one(259, 1) != 1 or one(258, 1) != 32 or one(339, 1) != 3 or one(277, 1) != 1 or 324 in tags:
        raise ValueError('%s: need an uncompressed, striped, single-band 32-bit float TIFF' % path)
    rows_per_strip = min(one(278, height), height)
    return dict(width=width, height=height, endian=end, offsets=tags[273], rows_per_strip=rows_per_strip)


class EquirectDem:
    """Whole-Moon map in plate carrée, heights in km, column 0 at -180° (server/equirect.mjs)."""
    kind = 'equirect'

    def __init__(self, path, dataset_id):
        self.id = dataset_id
        if path.suffix == '.npy':
            self.data = np.load(path, mmap_mode='r')
        else:
            lay = _read_tiff_layout(path)
            w, h, offsets = lay['width'], lay['height'], lay['offsets']
            strip = lay['rows_per_strip'] * w * 4
            contiguous = all(offsets[i + 1] - offsets[i] == strip for i in range(len(offsets) - 1))
            if contiguous:
                self.data = np.memmap(path, dtype=lay['endian'] + 'f4', mode='r', offset=offsets[0], shape=(h, w))
            else:
                out = np.empty((h, w), dtype='<f4')
                with open(path, 'rb') as f:
                    for s, off in enumerate(offsets):
                        r0 = s * lay['rows_per_strip']
                        rows = min(lay['rows_per_strip'], h - r0)
                        f.seek(off)
                        out[r0:r0 + rows] = np.frombuffer(f.read(rows * w * 4), lay['endian'] + 'f4').reshape(rows, w)
                self.data = out
        self.height, self.width = self.data.shape
        self.ppd = self.width / 360.0
        self.pixelM = math.pi * R / 180 / self.ppd

    def _cell(self, lat, lon):
        h, w = self.height, self.width
        x = (lon + 180.0) * self.ppd - 0.5
        y = np.clip((90.0 - lat) * self.ppd - 0.5, 0, h - 1)
        xf = np.floor(x)
        y0 = np.minimum(np.floor(y), h - 1).astype(np.int64)
        y1 = np.minimum(y0 + 1, h - 1)
        x0 = (xf.astype(np.int64) % w)
        x1 = (x0 + 1) % w
        d = self.data
        return x - xf, y - y0, d[y0, x0], d[y0, x1], d[y1, x0], d[y1, x1]

    def sample(self, lat, lon):
        fx, fy, a, b, c, e = self._cell(np.asarray(lat, float), np.asarray(lon, float))
        hgt = ((a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + e * fx) * fy) * 1000.0
        dx = ((b - a) * (1 - fy) + (e - c) * fy) * 1000.0
        dy = ((c - a) * (1 - fx) + (e - b) * fx) * 1000.0
        ew = self.pixelM * np.maximum(np.cos(np.asarray(lat, float) * DEG), 1e-6)
        slope = np.degrees(np.arctan(np.sqrt((dx / ew) ** 2 + (dy / self.pixelM) ** 2)))
        return hgt, slope

    def heights(self, lat, lon):
        fx, fy, a, b, c, e = self._cell(np.asarray(lat, float), np.asarray(lon, float))
        return ((a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + e * fx) * fy) * 1000.0


class PolarDem:
    """LOLA south polar stereographic grid, 16-bit integers (server/lola-polar.mjs)."""
    kind = 'polar'

    def __init__(self, img, lbl, dataset_id):
        text = Path(lbl).read_text('latin-1')

        def num(key):
            m = re.search(r'^\s*%s\s*=\s*(-?[0-9.]+)' % key, text, re.M)
            if not m:
                raise ValueError('Label has no %s' % key)
            return float(m.group(1))

        self.id = dataset_id
        self.lines, self.samples = int(num('LINES')), int(num('LINE_SAMPLES'))
        self.scaling, self.radiusM = num('SCALING_FACTOR'), num('OFFSET')
        self.scaleM, self.lineOffset, self.sampleOffset = num('MAP_SCALE'), num('LINE_PROJECTION_OFFSET'), num('SAMPLE_PROJECTION_OFFSET')
        if num('CENTER_LATITUDE') != -90:
            raise ValueError('Only south polar grids are supported')
        self.data = np.memmap(img, dtype='<i2', mode='r', shape=(self.lines, self.samples))
        self.pixelM = self.scaleM

    def _pixel(self, lat, lon):
        r = 2 * self.radiusM * np.tan((90 + np.asarray(lat, float)) / 2 * DEG)
        lo = np.asarray(lon, float) * DEG
        return r * np.sin(lo) / self.scaleM + self.sampleOffset, self.lineOffset - r * np.cos(lo) / self.scaleM

    def sample(self, lat, lon):
        x, y = self._pixel(lat, lon)
        x0, y0 = np.floor(x), np.floor(y)
        ok = (x0 >= 0) & (y0 >= 0) & (x0 < self.samples - 1) & (y0 < self.lines - 1)
        xi = np.where(ok, x0, 0).astype(np.int64)
        yi = np.where(ok, y0, 0).astype(np.int64)
        fx, fy = x - x0, y - y0
        d = self.data
        a, b = d[yi, xi].astype(float), d[yi, xi + 1].astype(float)
        c, e = d[yi + 1, xi].astype(float), d[yi + 1, xi + 1].astype(float)
        hgt = ((a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + e * fx) * fy) * self.scaling
        dx = ((b - a) * (1 - fy) + (e - c) * fy) * self.scaling
        dy = ((c - a) * (1 - fx) + (e - b) * fx) * self.scaling
        ground = self.scaleM * (1 + np.sin(np.abs(np.asarray(lat, float)) * DEG)) / 2
        slope = np.degrees(np.arctan(np.sqrt(dx * dx + dy * dy) / ground))
        return np.where(ok, hgt, np.nan), np.where(ok, slope, np.nan)

    def heights(self, lat, lon):
        return self.sample(lat, lon)[0]


class Composite:
    """"Best available": regional grids first, then the whole-Moon data that suits the detail wanted."""
    kind = 'composite'

    def __init__(self, entries, dataset_id, pixel_m):
        regional = [e['dem'] for e in entries if e['regional']]
        glob = sorted([e for e in entries if not e['regional']], key=lambda e: e['pixelM'])
        self.tiers = []
        for pick in range(len(glob)):
            order = [glob[i]['dem'] for i in range(pick, -1, -1)] + [glob[i]['dem'] for i in range(pick + 1, len(glob))]
            below = glob[pick + 1]['pixelM'] if pick + 1 < len(glob) else math.inf
            self.tiers.append((below, regional + order))
        if not self.tiers:
            self.tiers.append((math.inf, regional))
        self.id, self.pixelM = dataset_id, pixel_m
        self.detailVaries = len(glob) > 1

    def sources_for(self, want_m):
        for below, sources in self.tiers:
            if want_m is None or not want_m >= below:
                return sources
        return self.tiers[-1][1]

    def sample(self, lat, lon, want_m=None):
        lat, lon = np.asarray(lat, float), np.asarray(lon, float)
        hgt = np.full(lat.shape, np.nan)
        slope = np.full(lat.shape, np.nan)
        for dem in self.sources_for(want_m):
            need = np.isnan(hgt)
            if not need.any():
                break
            h, s = dem.sample(lat[need], lon[need])
            hgt[need], slope[need] = h, s
        return hgt, slope

    def heights(self, lat, lon, want_m=None):
        return self.sample(lat, lon, want_m)[0]


def sample(dem, lat, lon, want_m=None):
    if dem.kind == 'composite':
        return dem.sample(lat, lon, want_m)
    return dem.sample(lat, lon)


def heights(dem, lat, lon, want_m=None):
    return sample(dem, lat, lon, want_m)[0]


_opened = {}


def open_source(source):
    sid = source['id']
    if sid not in _opened:
        files = _files(sid)
        if sid == 'lola-south-80s-80m':
            _opened[sid] = PolarDem(files[0], files[1], sid)
        else:
            _opened[sid] = EquirectDem(files[0], sid)
    return _opened[sid]


def dem_for(lat, source_id='auto', lon=None):
    """(dem, source) to use at a point, or an error dict (server/terrain-sources.mjs demFor)."""
    readable = [s for s in SOURCES if s['id'] != 'lola-global-512']
    if source_id and source_id != 'auto':
        source = next((s for s in SOURCES if s['id'] == source_id), None)
        if source is None:
            return {'error': 'Unknown terrain data "%s"' % source_id}
        if source not in readable or _files(source['id']) is None:
            return {'missing': source}
        if not covers(source, lat):
            return {'outside': source}
        return {'dem': open_source(source), 'source': describe(source)}
    usable = [s for s in readable if _files(s['id']) is not None]
    if not usable:
        return {'missing': next(s for s in SOURCES if s['id'] == 'ldem-16')}
    if not any(covers(s, lat) for s in usable):
        return {'outside': usable[0]}
    used = [s for s in usable if s['southOfLat'] is None or lat <= s['southOfLat'] + REACH_DEG]
    dems = [open_source(s) for s in used]
    here = []
    for s, d in zip(used, dems):
        ok = covers(s, lat) and (lon is None or not np.isnan(float(np.asarray(d.heights(np.array([lat]), np.array([lon])))[0])))
        here.append(ok)
    primary = here.index(True) if True in here else next(i for i, s in enumerate(used) if covers(s, lat))
    if len(used) == 1:
        return {'dem': dems[0], 'source': describe(used[0])}
    entries = [dict(dem=d, pixelM=s['pixelM'], regional=s['southOfLat'] is not None) for s, d in zip(used, dems)]
    did = '+'.join([used[primary]['id']] + [s['id'] for i, s in enumerate(used) if i != primary])
    return {'dem': Composite(entries, did, used[primary]['pixelM']), 'source': describe(used[primary])}


def _terrain_error(found):
    if 'missing' in found:
        s = found['missing']
        return jsonify(error='Terrain data "%s" is not downloaded yet.' % s['label'], hint=s['fetch']), 404
    if 'outside' in found:
        s = found['outside']
        return jsonify(error='No terrain data at this point: "%s" covers %s.' % (s['label'], s['coverage'])), 404
    return jsonify(error=found.get('error', 'No terrain data')), 404


# ================================================================================================
# Geometry shared with the browser (src/terrain/polar-grid.js, src/finder/grid.js)
# ================================================================================================

def destination(lat_deg, lon_deg, azimuth_deg, distance_m):
    la = np.asarray(lat_deg, float) * DEG
    az = np.asarray(azimuth_deg, float) * DEG
    g = np.asarray(distance_m, float) / R
    sin_lat = np.sin(la) * np.cos(g) + np.cos(la) * np.sin(g) * np.cos(az)
    lat = np.arcsin(np.clip(sin_lat, -1, 1))
    lon = np.asarray(lon_deg, float) * DEG + np.arctan2(np.sin(az) * np.sin(g) * np.cos(la), np.cos(g) - np.sin(la) * sin_lat)
    lon_deg_out = ((((lon / DEG + 180) % 360) + 360) % 360) - 180
    return lat / DEG, lon_deg_out


def offset_to_latlon(center, east, north):
    east, north = np.asarray(east, float), np.asarray(north, float)
    d = np.hypot(east, north)
    lat, lon = destination(center['lat'], center['lon'], np.degrees(np.arctan2(east, north)), d)
    tiny = d < 1e-6
    return np.where(tiny, center['lat'], lat), np.where(tiny, center['lon'], lon)


def ring_distances(max_m=300_000):
    out, d = [], 2.0
    while d < max_m:
        out.append(d)
        if d < 2000:
            d += max(d * 0.08, 0.5)
        elif d < 8000:
            d += 80
        elif d < 50_000:
            d += d * 0.01
        elif d < 120_000:
            d += 500
        else:
            d += 1000
    return np.array(out)


def search_grid(radius_km):
    width = 2 * radius_km * 1000
    cell_m = max(80, math.ceil(width / 400 / 20) * 20)
    n = math.ceil(width / cell_m / 2) * 2
    return n, cell_m, n * cell_m / 2


# ================================================================================================
# Wire formats (src/finder/wire.js, src/terrain/polar-grid.js)
# ================================================================================================

def _pad4(k):
    return (k + 3) // 4 * 4


def _header_bytes(obj):
    text = json.dumps(obj, allow_nan=False, separators=(',', ':')).encode('utf-8')
    size = _pad4(len(text))
    return size, text + b' ' * (size - len(text))


def encode_rasters(header, rasters):
    directory, offset, parts = [], 0, []
    names = {np.dtype('float32'): 'f32', np.dtype('uint16'): 'u16', np.dtype('uint8'): 'u8'}
    for name, arr in rasters.items():
        arr = np.ascontiguousarray(arr)
        directory.append(dict(name=name, type=names[arr.dtype], length=int(arr.size), offset=offset))
        raw = arr.astype(arr.dtype.newbyteorder('<'), copy=False).tobytes()
        parts.append(raw + b'\0' * (_pad4(len(raw)) - len(raw)))
        offset += _pad4(len(raw))
    size, head = _header_bytes(dict(header=header, directory=directory))
    return np.uint32(size).astype('<u4').tobytes() + head + b''.join(parts)


def encode_patch(patch, heights_arr, slopes_arr):
    header = dict(patch, distances=[float(x) for x in patch['distances']], hasSlopes=True)
    size, head = _header_bytes(header)
    slope_bytes = np.where(np.isnan(slopes_arr), 255, np.minimum(np.round(np.nan_to_num(slopes_arr) * 3), 254)).astype(np.uint8)
    return np.uint32(size).astype('<u4').tobytes() + head + heights_arr.astype('<f4').tobytes() + slope_bytes.tobytes()


def _binary(data):
    return Response(data, mimetype='application/octet-stream', headers={'Cache-Control': 'no-store'})


# ================================================================================================
# Endpoints
# ================================================================================================

@bp.get('/api/terrain/info')
def terrain_info():
    sources = [describe(s) for s in SOURCES]
    return jsonify(sources=sources, available=any(s['installed'] for s in sources), hint=_fetch_hint('ldem-16'))


@bp.get('/api/terrain/polar')
def terrain_polar():
    try:
        lat, lon = float(request.args['lat']), float(request.args['lon'])
    except (KeyError, ValueError):
        return jsonify(error='lat and lon are required'), 400
    found = dem_for(lat, request.args.get('source') or 'auto', lon)
    if 'dem' not in found:
        return _terrain_error(found)
    dem, source = found['dem'], found['source']
    ground, ground_slope = (float(v[0]) for v in sample(dem, np.array([lat]), np.array([lon])))
    if math.isnan(ground):
        return jsonify(error='No terrain data at this point: "%s" covers %s.' % (source['label'], source['coverage'])), 404
    n_az = 720
    dist = ring_distances()
    nk = len(dist)
    want = np.empty(nk)
    want[:-1] = dist[1:] - dist[:-1]
    want[-1] = dist[-1] - dist[-2]
    az = np.arange(n_az) * 360.0 / n_az
    plat, plon = destination(lat, lon, az[None, :].repeat(nk, 0), dist[:, None].repeat(n_az, 1))
    hgt = np.full((nk, n_az), np.nan)
    slp = np.full((nk, n_az), np.nan)
    if dem.kind == 'composite':
        # Rings that want the same tier of detail are read together.
        tiers = [dem.sources_for(w) for w in want]
        keys = [id(t) for t in tiers]
        for key in set(keys):
            rows = np.array([i for i, k in enumerate(keys) if k == key])
            h, s = dem.sample(plat[rows], plon[rows], want[rows[0]])
            hgt[rows], slp[rows] = h, s
    else:
        hgt, slp = dem.sample(plat, plon)
    hgt = np.asarray(hgt, float).reshape(-1)
    slp = np.asarray(slp, float).reshape(-1)
    missing = np.isnan(hgt).reshape(nk, n_az).any(axis=1)
    data_edge = float(dist[np.argmax(missing)]) if missing.any() else None
    patch = dict(lat=lat, lon=lon, groundHeightM=ground, groundSlopeDeg=0.0 if math.isnan(ground_slope) else ground_slope,
                 nAz=n_az, distances=dist, coverage=float(np.mean(~np.isnan(hgt))), dataEdgeM=data_edge,
                 dataset=dem.id, pixelM=dem.pixelM, sourceLabel=source['label'])
    if getattr(dem, 'detailVaries', False):
        patch['sourceNote'] = 'Ground far from you is read from coarser data, in step with how sparsely it is sampled.'
    return _binary(encode_patch(patch, hgt.astype(np.float32), slp.astype(np.float32)))


@bp.route('/api/horizons', methods=['GET'])
def horizons_proxy():
    try:
        r = requests.get(HORIZONS_URL, params=request.args, timeout=(10, 90))
    except requests.RequestException as error:
        return jsonify(error='JPL Horizons did not answer: %s' % error), 502
    return Response(r.content, status=r.status_code, mimetype=r.headers.get('content-type', 'application/json'))


# ------------------------------------------------------------------------------------------------
# Landing-site finder (server/landing-search.mjs)
# ------------------------------------------------------------------------------------------------

FAIL = dict(SLOPE=1, NO_SUN_AT_LANDING=2, DARK_TOO_LONG=4, NO_EARTH_AT_LANDING=8, OUTSIDE=16)
FAR_MARGIN_M = 150_000
COARSE_CELL_M = 500
MAX_ELLIPSE_CELLS = 30
BATCH = 24  # Sun/Earth directions swept together


def default_finder():
    return dict(radiusKm=10, ellipseRadiusM=500, maxLandingSlopeDeg=10, maxDarknessHours=50, needSunAtLanding=True,
                needEarthAtLanding=True, roverMaxSlopeDeg=15, roverSpeedMPerHour=200, roverRangeKm=20,
                roverNeedsEarthToDrive=False)


def sky_series(lat, lon, start, duration_h, step_min):
    """Sun and Earth azimuth/elevation at a point, one row per step (ephemerisSeries + altAz)."""
    fetch = HORIZONS_FETCH  # the Horizons client the rest of the Flask app uses (set by lunar_server.py)
    count = int(math.floor(duration_h * 60 / step_min)) + 1
    end = start + timedelta(minutes=step_min * (count - 1))
    sun = fetch(10, lat, lon, start, end, step_min)
    earth = fetch(399, lat, lon, start, end, step_min)
    n = min(len(sun), len(earth), count)
    if n < 2:
        raise ValueError('JPL Horizons returned too few rows')
    get = lambda rows, key: np.array([r[key] for r in rows[:n]], float)
    return get(sun, 'azimuth_deg'), get(sun, 'elevation_deg'), get(earth, 'azimuth_deg'), get(earth, 'elevation_deg')


def direction(az_deg, el_deg):
    az, el = np.asarray(az_deg) * DEG, np.asarray(el_deg) * DEG
    return np.stack([np.cos(el) * np.sin(az), np.sin(el), -np.cos(el) * np.cos(az)], axis=-1)


class ShadowGrid:
    def __init__(self, half_m, cell_m, height_fn):
        self.n = int(round(2 * half_m / cell_m))
        self.cellM, self.halfSizeM = cell_m, half_m
        pos = -half_m + (np.arange(self.n) + 0.5) * cell_m
        x = np.broadcast_to(pos[None, :], (self.n, self.n))
        z = np.broadcast_to(pos[:, None], (self.n, self.n))
        y = height_fn(x, z)
        self.Y = np.where(np.isnan(y), NONE, y).astype(np.float32)  # [iz, ix]

    def position(self, index):
        return -self.halfSizeM + (index + 0.5) * self.cellM


def sample_fields(grid, fields, k, x, z):
    """Bilinear lookup in fields[k] (one field per direction) at positions x, z; NaN outside (sampleGrid)."""
    n = grid.n
    fx = (x + grid.halfSizeM) / grid.cellM - 0.5
    fz = (z + grid.halfSizeM) / grid.cellM - 0.5
    ix, iz = np.floor(fx), np.floor(fz)
    ok = (ix >= 0) & (iz >= 0) & (ix < n - 1) & (iz < n - 1)
    ixi = np.where(ok, ix, 0).astype(np.int64)
    izi = np.where(ok, iz, 0).astype(np.int64)
    tx, tz = fx - ix, fz - iz
    f = fields
    v = ((f[k, izi, ixi] * (1 - tx) + f[k, izi, ixi + 1] * tx) * (1 - tz)
         + (f[k, izi + 1, ixi] * (1 - tx) + f[k, izi + 1, ixi + 1] * tx) * tz)
    return np.where(ok, v, np.nan)


def sweep_batch(grid, dirs, beyond=None):
    """sweepShadows for several directions at once. All must share the axis and side the light comes from.

    Returns (S, M), each [k, iz, ix]. `beyond(k, x, z)` gives max(terrain, shadow line) outside the grid.
    """
    n, cell = grid.n, grid.cellM
    K = len(dirs)
    sx, sy, sz = dirs[:, 0], dirs[:, 1], dirs[:, 2]
    along_x = abs(sx[0]) >= abs(sz[0])
    major = sx if along_x else sz
    minor = sz if along_x else sx
    to_sun = 1 if major[0] > 0 else -1
    shift = minor / np.abs(major)
    drop = (cell * sy / np.abs(major)).astype(np.float32)
    Y = grid.Y.T if along_x else grid.Y  # [a (major), b (minor)]
    S = np.empty((K, n, n), np.float32)
    M = np.empty((K, n, n), np.float32)
    b = np.arange(n)
    f = b[None, :] + shift[:, None]
    b0 = np.floor(f)
    t = (f - b0).astype(np.float32)
    inner = (b0 >= 0) & (b0 < n - 1)
    b0c = np.clip(b0, 0, n - 2).astype(np.int64)
    outer_k, outer_b = np.nonzero(~inner)
    kk = np.arange(K)[:, None]
    order = range(n - 1, -1, -1) if to_sun > 0 else range(n)
    for a in order:
        up = a + to_sun
        if 0 <= up < n:
            prev = M[:, up, :]
            upwind = prev[kk, b0c] * (1 - t) + prev[kk, b0c + 1] * t
            if outer_k.size:
                if beyond is None:
                    upwind[outer_k, outer_b] = NONE
                else:
                    fo = f[outer_k, outer_b]
                    pu = grid.position(up)
                    v = beyond(outer_k, np.full(fo.shape, pu), grid.position(fo)) if along_x else beyond(outer_k, grid.position(fo), np.full(fo.shape, pu))
                    upwind[outer_k, outer_b] = np.where(np.isnan(v), NONE, v)
        else:
            if beyond is None:
                upwind = np.full((K, n), NONE, np.float32)
            else:
                pu = np.full(f.shape, grid.position(up))
                kf = np.broadcast_to(kk, f.shape)
                v = beyond(kf, pu, grid.position(f)) if along_x else beyond(kf, grid.position(f), pu)
                upwind = np.where(np.isnan(v), NONE, v).astype(np.float32)
        line = upwind - drop[:, None]
        S[:, a, :] = line
        M[:, a, :] = np.maximum(Y[a][None, :], line)
    if along_x:
        S = S.transpose(0, 2, 1)
        M = M.transpose(0, 2, 1)
    return S, M


def visible_steps(fine, coarse, dirs, extra_height, up_dot_ok):
    """For each direction, which fine cells see it: one bool row per direction (the lit/inView test)."""
    steps = len(dirs)
    out = np.zeros((steps, fine.n * fine.n), bool)
    groups = {}
    for i, d in enumerate(dirs):
        if max(abs(d[0]), abs(d[2])) < 1e-6:
            groups.setdefault('overhead', []).append(i)
            continue
        along_x = abs(d[0]) >= abs(d[2])
        side = (d[0] if along_x else d[2]) > 0
        groups.setdefault((along_x, side), []).append(i)
    yfine = fine.Y.reshape(-1)
    for key, idx in groups.items():
        for s in range(0, len(idx), BATCH):
            chunk = np.array(idx[s:s + BATCH])
            d = dirs[chunk]
            if key == 'overhead':
                lit_terrain = np.ones((len(chunk), yfine.size), bool)
            else:
                _, coarse_m = sweep_batch(coarse, d)
                beyond = lambda k, x, z: sample_fields(coarse, coarse_m, k, x, z)
                S, _ = sweep_batch(fine, d, beyond)
                lit_terrain = (yfine[None, :] + extra_height) > S.reshape(len(chunk), -1)
            out[chunk] = lit_terrain & up_dot_ok(d)
    return out


def longest_runs(flags):
    """Longest run of True per column (cells) over rows (steps)."""
    run = np.zeros(flags.shape[1], np.int32)
    best = np.zeros(flags.shape[1], np.int32)
    for row in flags:
        run = np.where(row, run + 1, 0)
        np.maximum(best, run, out=best)
    return best


def search_landing(dem, params):
    started = time.perf_counter()
    p = dict(stepMinutes=60, panelHeightM=2, antennaHeightM=2, weights=dict(sunlight=1, earthComms=0.7))
    p.update(default_finder())
    p.update(params)
    center = dict(lat=float(p['center']['lat']), lon=float(p['center']['lon']))
    ground = float(heights(dem, np.array([center['lat']]), np.array([center['lon']]))[0])
    if math.isnan(ground):
        return None
    n, cell_m, half_m = search_grid(float(p['radiusKm']))
    count = n * n

    def scene_height(want_m):
        def fn(x, z):
            d = np.hypot(x, z)
            lat, lon = offset_to_latlon(center, x, -z)
            h = heights(dem, lat, lon, want_m)
            return (R + h) * np.cos(d / R) - (R + ground)
        return fn

    fine = ShadowGrid(half_m, cell_m, scene_height(cell_m))
    coarse_half = math.ceil((half_m + FAR_MARGIN_M) / COARSE_CELL_M) * COARSE_CELL_M
    coarse = ShadowGrid(coarse_half, COARSE_CELL_M, scene_height(COARSE_CELL_M))

    # Height, slope and each cell's own "up".
    pos = (np.arange(n) + 0.5) * cell_m - half_m
    east = np.broadcast_to(pos[None, :], (n, n)).reshape(-1)
    north = np.broadcast_to(-pos[:, None], (n, n)).reshape(-1)
    lat, lon = offset_to_latlon(center, east, north)
    elev, slope = sample(dem, lat, lon, cell_m)
    elev, slope = np.asarray(elev, float), np.asarray(slope, float)
    valid = ~np.isnan(elev)
    inside = np.hypot(east, north) <= float(p['radiusKm']) * 1000
    y = fine.Y.reshape(-1).astype(float) + R + ground
    length = np.sqrt(east ** 2 + y ** 2 + north ** 2)
    up = np.stack([east / length, y / length, -north / length], axis=1)
    above = np.maximum(np.nan_to_num(elev), 0)
    sin_dip_panel = np.sin(np.arccos(R / (R + above + float(p['panelHeightM']))))
    sin_dip_antenna = np.sin(np.arccos(R / (R + above + float(p['antennaHeightM']))))

    # Sun and Earth over the mission, from Horizons at the search centre.
    start = datetime.strptime(str(p['start'])[:16].replace('T', ' '), '%Y-%m-%d %H:%M')
    step_min = int(p['stepMinutes'])
    sun_az, sun_el, earth_az, earth_el = sky_series(center['lat'], center['lon'], start, float(p['durationHours']), step_min)
    steps = len(sun_az)
    step_h = step_min / 60
    sun_dirs = direction(sun_az, sun_el)
    earth_dirs = direction(earth_az, earth_el)

    def up_ok(sin_dip):
        return lambda d: (d @ up.T) > -sin_dip[None, :]

    lit = visible_steps(fine, coarse, sun_dirs, float(p['panelHeightM']), up_ok(sin_dip_panel)) & valid[None, :]
    seen = visible_steps(fine, coarse, earth_dirs, float(p['antennaHeightM']), up_ok(sin_dip_antenna)) & valid[None, :]

    window_h = max(steps - 1, 1) * step_h
    nan = np.full(count, np.nan)
    sun_frac = np.where(valid, lit.sum(0) / steps, nan)
    earth_frac = np.where(valid, seen.sum(0) / steps, nan)
    longest_lit = np.where(valid, np.minimum(longest_runs(lit) * step_h, window_h), nan)
    longest_dark = np.where(valid, np.minimum(longest_runs(~lit & valid[None, :]) * step_h, window_h), nan)
    point_fail = np.zeros(count, np.uint8)
    point_fail[valid & (slope > float(p['maxLandingSlopeDeg']))] |= FAIL['SLOPE']
    if p['needSunAtLanding']:
        point_fail[valid & ~lit[0]] |= FAIL['NO_SUN_AT_LANDING']
    point_fail[valid & (longest_dark > float(p['maxDarknessHours']))] |= FAIL['DARK_TOO_LONG']
    if p['needEarthAtLanding']:
        point_fail[valid & ~seen[0]] |= FAIL['NO_EARTH_AT_LANDING']
    point_fail[~valid] = FAIL['OUTSIDE']

    # Every point of the landing ellipse must pass.
    reach = min(int(round(float(p['ellipseRadiusM']) / cell_m)), MAX_ELLIPSE_CELLS)
    pf = np.pad(point_fail.reshape(n, n), reach, constant_values=FAIL['OUTSIDE'])
    sl = np.pad(np.where(np.isnan(slope), -np.inf, slope).reshape(n, n), reach, constant_values=-np.inf)
    bits = np.zeros((n, n), np.uint8)
    steepest = np.zeros((n, n))
    for dr in range(-reach, reach + 1):
        for dc in range(-reach, reach + 1):
            if dr * dr + dc * dc > reach * reach:
                continue
            bits |= pf[reach + dr:reach + dr + n, reach + dc:reach + dc + n]
            np.maximum(steepest, sl[reach + dr:reach + dr + n, reach + dc:reach + dc + n], out=steepest)
    bits = bits.reshape(-1)
    steepest = steepest.reshape(-1)
    fail = np.where(valid, bits | np.where(inside, 0, FAIL['OUTSIDE']), FAIL['OUTSIDE']).astype(np.uint8)
    ellipse_slope = np.where(valid, steepest, np.nan)
    w = p.get('weights') or {}
    w_sun, w_earth = max(float(w.get('sunlight', 1)), 0), max(float(w.get('earthComms', 0)), 0)
    passing = valid & inside & (fail == 0)
    score = np.full(count, np.nan)
    if w_sun + w_earth > 0:
        score[passing] = (w_sun * np.minimum(longest_lit[passing] / window_h, 1) + w_earth * earth_frac[passing]) / (w_sun + w_earth)
    else:
        score[passing] = 0
    ev = valid & inside
    counts = dict(evaluated=int(ev.sum()), passing=int(passing.sum()),
                  slope=int((ev & ~passing & ((fail & FAIL['SLOPE']) > 0)).sum()),
                  noSun=int((ev & ~passing & ((fail & FAIL['NO_SUN_AT_LANDING']) > 0)).sum()),
                  dark=int((ev & ~passing & ((fail & FAIL['DARK_TOO_LONG']) > 0)).sum()),
                  noEarth=int((ev & ~passing & ((fail & FAIL['NO_EARTH_AT_LANDING']) > 0)).sum()))

    # The best sites, spaced apart (pickSites).
    cand = np.nonzero(~np.isnan(score))[0]
    order = np.lexsort((cand, ellipse_slope[cand], -score[cand]))
    min_cells2 = (max(2 * float(p['ellipseRadiusM']), 1000) / cell_m) ** 2
    picked = []
    for idx in cand[order]:
        r_, c_ = divmod(int(idx), n)
        if all((pr - r_) ** 2 + (pc - c_) ** 2 >= min_cells2 for pr, pc, _ in picked):
            picked.append((r_, c_, int(idx)))
            if len(picked) == 10:
                break
    sites = []
    for i, (r_, c_, idx) in enumerate(picked):
        sites.append(dict(rank=i + 1, lat=float(lat[idx]), lon=float(lon[idx]), row=r_, col=c_, score=float(score[idx]),
                          sunFraction=float(sun_frac[idx]), longestLitH=float(longest_lit[idx]),
                          longestDarkH=float(longest_dark[idx]), earthFraction=float(earth_frac[idx]),
                          ellipseSlopeDeg=float(ellipse_slope[idx]), elevationM=float(elev[idx])))

    stride = (count + 7) // 8
    pack = lambda flags: np.packbits(flags, axis=1, bitorder='little')[:, :stride].reshape(-1)
    header = dict(n=n, cellM=cell_m, halfSizeM=half_m, center=center, radiusKm=p['radiusKm'], groundHeightM=ground,
                  stepHours=step_h, steps=steps, windowHours=window_h, maskStride=stride, params=p, sites=sites,
                  counts=counts, computeMs=int((time.perf_counter() - started) * 1000), dataset=dem.id,
                  terrainPixelM=dem.pixelM, ephemerisSource='JPL Horizons (at the search centre)')
    f32 = lambda a: np.asarray(a, np.float32)
    rasters = dict(elevation=f32(elev), slope=f32(slope), ellipseSlope=f32(ellipse_slope), sunFraction=f32(sun_frac),
                   longestLitH=f32(longest_lit), longestDarkH=f32(longest_dark), earthFraction=f32(earth_frac),
                   fail=fail, score=f32(score), sunMask=pack(lit), earthMask=pack(seen))
    return header, rasters


@bp.post('/api/terrain/landing-search')
def landing_search():
    params = request.get_json(silent=True) or {}
    c = params.get('center') or {}
    try:
        ok = math.isfinite(float(c.get('lat'))) and math.isfinite(float(c.get('lon'))) and params.get('start') and float(params.get('durationHours', 0)) > 0
    except (TypeError, ValueError):
        ok = False
    if not ok:
        return jsonify(error='center, start and durationHours are required'), 400
    found = dem_for(float(c['lat']), params.get('source') or 'auto', float(c['lon']))
    if 'dem' not in found:
        return _terrain_error(found)
    try:
        result = search_landing(found['dem'], params)
    except Exception as error:  # Horizons down, bad input: say why, as the Node version does
        return jsonify(error=str(error)), 500
    if result is None:
        s = found['source']
        return jsonify(error='No terrain data at the centre of the search: "%s" covers %s.' % (s['label'], s['coverage'])), 404
    header, rasters = result
    header['sourceLabel'] = found['source']['label']
    if getattr(found['dem'], 'detailVaries', False):
        header['sourceNote'] = 'Mountains beyond the search area, which can block a low Sun, are read from coarser data (500 m cells).'
    return _binary(encode_rasters(header, rasters))


# ================================================================================================
# The team's front-end (index.html, src/), served without Vite
# ================================================================================================

STYLESHEET = '<link rel="stylesheet" href="/src/styles.css">\n'
IMPORT_MAP = ('<script type="importmap">{"imports":{"three":"/vendor/team/three.module.js",'
              '"astronomy-engine":"/vendor/team/astronomy.js"}}</script>\n')


def team_app_present():
    return (REPO / 'index.html').exists() and (REPO / 'src' / 'main.js').exists()


def team_index():
    html = (REPO / 'index.html').read_text('utf-8')
    style = 'color:#9aa3ad;text-decoration:none;padding:4px 8px;border-radius:6px;background:rgba(0,0,0,.45)'
    link = ('<nav aria-label="Other pages" style="position:fixed;right:12px;bottom:10px;z-index:50;display:flex;gap:6px;'
            'font:12px system-ui;opacity:.85">'
            f'<a href="/learn" style="{style}">Education</a>'
            f'<a href="/classic" style="{style}">Classic planner &rarr;</a></nav>\n'
            '<script src="/live-sync.js" defer></script>\n')
    head = IMPORT_MAP if '/src/styles.css' in html else STYLESHEET + IMPORT_MAP
    html = html.replace('</head>', head + '</head>', 1).replace('</body>', link + '</body>', 1)
    return Response(html, mimetype='text/html', headers={'Cache-Control': 'no-store'})


_CSS_IMPORT = re.compile(r"""^\s*import\s+['"][^'"]+\.css['"];?\s*$""", re.M)
_JSON_IMPORT = re.compile(r"""(import\s+[\w{}\s,*]+\s+from\s+['"][^'"]+\.json['"])\s*;""")


@bp.get('/src/<path:name>')
def team_src(name):
    path = (REPO / 'src' / name).resolve()
    if not str(path).startswith(str((REPO / 'src').resolve())) or not path.is_file():
        abort(404)
    if path.suffix == '.js':
        text = path.read_text('utf-8')
        text = _CSS_IMPORT.sub('', text)
        text = _JSON_IMPORT.sub(r"\1 with { type: 'json' };", text)
        text = text.replace('import.meta.env.BASE_URL', "'/'")
        return Response(text, mimetype='text/javascript', headers={'Cache-Control': 'no-store'})
    response = send_file(path, max_age=0)
    response.headers['Cache-Control'] = 'no-store'
    return response


@bp.get('/data/<name>.json')
def team_data_json(name):
    path = REPO / 'data' / (name + '.json')
    if not re.fullmatch(r'[\w-]+', name) or not path.is_file():
        path = HERE / 'public' / 'data' / (name + '.json')
        if not path.is_file():
            abort(404)
    return send_file(path, mimetype='application/json', max_age=0)


@bp.get('/textures/<path:name>')
def team_textures(name):
    for base in (REPO / 'public' / 'textures', HERE / 'public' / 'textures'):
        path = (base / name).resolve()
        if str(path).startswith(str(base.resolve())) and path.is_file():
            return send_file(path, max_age=3600)
    abort(404)


@bp.get('/images/<path:name>')
def team_images(name):
    # Vite serves the team's public/ folder at the site root; the mission cards use public/images/.
    base = REPO / 'public' / 'images'
    path = (base / name).resolve()
    if not str(path).startswith(str(base.resolve())) or not path.is_file():
        abort(404)
    return send_file(path, max_age=3600)


@bp.get('/favicon.ico')
def favicon():
    svg = ('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><circle cx="16" cy="16" r="13" fill="#c9c4bb"/>'
           '<circle cx="11" cy="12" r="3" fill="#9d978d"/><circle cx="20" cy="20" r="4" fill="#9d978d"/></svg>')
    return Response(svg, mimetype='image/svg+xml', headers={'Cache-Control': 'max-age=86400'})
