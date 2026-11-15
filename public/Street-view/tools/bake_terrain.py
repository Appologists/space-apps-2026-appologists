"""Cut small terrain files for the street view from NASA LOLA elevation data.

Usage:  python bake_terrain.py <raw-data-dir> <out-dir>
  <raw-data-dir> must contain
    pgda-lola-5mpp/SiteNN_final_adj_5mpp_surf.tif   (and _toterr.tif)   from https://pgda.gsfc.nasa.gov/products/78
    lola-south-80s-80m/ldem_80s_80m.img                                  from PDS (LRO LOLA GDR, polar)
  (in the team repo that is data/raw/; `npm run data:fetch -- lola-south-80s-80m` gets the second one)

For each site it writes <out-dir>/<site>/
  near.bin   401 x 401 heights every 5 m (2 x 2 km), uint16, from the PGDA 5 m map
  err.bin    101 x 101 height uncertainty every 20 m, uint8 decimetres, from the PGDA error map
  far.bin    481 x 481 heights every 250 m (120 x 120 km), uint16, from LOLA 80 m
  meta.json  where it is, how to decode the files, the distant horizon (60-200 km) and sources

Frame used by the page: x = east, z = south, y = up, metres, origin on the ground at the site.
Heights are relative to the site and already include the drop of the Moon's curvature (d^2 / 2R),
so the page can treat the ground as flat.
"""
import json, math, os, sys
import numpy as np
from PIL import Image

Image.MAX_IMAGE_PIXELS = None
R = 1737400.0  # m, LOLA reference sphere
raw, out = sys.argv[1], sys.argv[2]

# Site centres in south polar stereographic metres (x = rho sin lon, y = rho cos lon).
SITES = {
    # PGDA Site04, region of interest 1: one of the spots NASA found sunlit > 70% of the time (2024-2026)
    'shackleton': dict(pgda='Site04', X=-2810.6, Y=-6645.5,
                       name='Shackleton crater rim', pick='Centre of NASA region 1 at PGDA Site04 (average sunlight above 70%, 2024-2026)'),
    # PGDA Site01, region of interest 5: Barker et al. say regions 4-6 here have the best sunlight
    'ridge': dict(pgda='Site01', X=-11100.8, Y=-11940.5,
                  name='Shackleton-de Gerlache connecting ridge', pick='Centre of NASA region 5 at PGDA Site01 (regions 4-6 have the best sunlight)'),
    # PGDA Site23: no region file on the server, so we stand on the highest ground in the 5 m map
    'malapert': dict(pgda='Site23', X=None, Y=None,
                     name='Malapert massif', pick='Our pick: highest point of the PGDA Site23 5 m map, at least 3 km from its edge'),
}

def read_tif(path):
    im = Image.open(path)
    a = np.asarray(im).astype(np.float32)
    tie = im.tag_v2[33922]; ps = im.tag_v2[33550]
    return a, dict(x0=tie[3], y0=tie[4], dx=ps[0], dy=ps[1])

def bilinear(a, col, row):
    """Sample array a at fractional (col,row) pixel centres. NaN outside."""
    h, w = a.shape
    ok = (col >= 0) & (row >= 0) & (col <= w - 1) & (row <= h - 1)
    c = np.clip(col, 0, w - 1.001); r = np.clip(row, 0, h - 1.001)
    i = c.astype(int); j = r.astype(int); fx = c - i; fy = r - j
    v = (a[j, i] * (1 - fx) * (1 - fy) + a[j, i + 1] * fx * (1 - fy) + a[j + 1, i] * (1 - fx) * fy + a[j + 1, i + 1] * fx * fy)
    return np.where(ok, v, np.nan)

def tif_sampler(a, g):
    # GeoTIFF tie point is the outer corner of the first pixel; pixel centres sit half a pixel in
    return lambda X, Y: bilinear(a, (X - g['x0']) / g['dx'] - 0.5, (g['y0'] - Y) / g['dy'] - 0.5)

L80 = 7600; OFF80 = 3799.5; S80 = 80.0
lola80 = np.memmap(f'{raw}/lola-south-80s-80m/ldem_80s_80m.img', dtype='<i2', mode='r', shape=(L80, L80))
def s80(X, Y):
    col = X / S80 + OFF80; row = OFF80 - Y / S80
    i0 = int(max(0, np.nanmin(col) - 2)); i1 = int(min(L80, np.nanmax(col) + 3))
    j0 = int(max(0, np.nanmin(row) - 2)); j1 = int(min(L80, np.nanmax(row) + 3))
    sub = np.asarray(lola80[j0:j1, i0:i1]).astype(np.float32) * 0.5  # PDS label: SCALING_FACTOR 0.5 m
    return bilinear(sub, col - i0, row - j0)

def frame(X0, Y0):
    rho = math.hypot(X0, Y0)
    n = np.array([X0, Y0]) / rho          # local north = away from the pole
    e = np.array([n[1], -n[0]])           # local east
    lat = 2 * math.degrees(math.atan(rho / (2 * R))) - 90
    lon = math.degrees(math.atan2(X0, Y0))
    k = 2 / (1 + math.sin(abs(lat) * math.pi / 180))  # stereographic scale: map metres per ground metre
    return n, e, lat, lon, k

def to_map(X0, Y0, n, e, k, x, z):
    # page x east, z south  ->  map X, Y
    return X0 + k * (x * e[0] - z * n[0]), Y0 + k * (x * e[1] - z * n[1])

def quant16(h):
    lo = float(np.nanmin(h)); hi = float(np.nanmax(h)); step = max((hi - lo) / 65000, 1e-4)
    q = np.round((np.nan_to_num(h, nan=lo) - lo) / step).astype('<u2')
    return q, lo, step

os.makedirs(out, exist_ok=True)
index = []
for key, s in SITES.items():
    surf, g = read_tif(f"{raw}/pgda-lola-5mpp/{s['pgda']}_final_adj_5mpp_surf.tif")
    err, ge = read_tif(f"{raw}/pgda-lola-5mpp/{s['pgda']}_final_adj_5mpp_toterr.tif")
    S5 = tif_sampler(surf, g); E5 = tif_sampler(err, ge)
    if s['X'] is None:
        m = int(3000 / g['dx']); inner = surf[m:-m, m:-m]
        j, i = np.unravel_index(np.argmax(inner), inner.shape)
        s['X'] = g['x0'] + (i + m + 0.5) * g['dx']; s['Y'] = g['y0'] - (j + m + 0.5) * g['dy']
    X0, Y0 = s['X'], s['Y']
    n, e, lat, lon, k = frame(X0, Y0)
    h0 = float(S5(np.array([X0]), np.array([Y0]))[0])

    # near grid: 401 x 401, 5 m, x east (columns), z south (rows)
    N = 401; S = 1000.0
    zz, xx = np.mgrid[0:N, 0:N].astype(np.float64)
    x = -S + xx * 5; z = -S + zz * 5
    MX, MY = to_map(X0, Y0, n, e, k, x, z)
    near = S5(MX, MY) - h0 - (x * x + z * z) / (2 * R)
    assert not np.isnan(near).any(), key
    qn, nlo, nstep = quant16(near)
    # cross-check against the independent 80 m map (same reference sphere)
    c80 = float(s80(np.array([X0]), np.array([Y0]))[0])

    # uncertainty: 101 x 101 every 20 m
    zz2, xx2 = np.mgrid[0:101, 0:101].astype(np.float64)
    ex, ez = -S + xx2 * 20, -S + zz2 * 20
    EX, EY = to_map(X0, Y0, n, e, k, ex, ez)
    qe = np.clip(np.round(np.nan_to_num(E5(EX, EY), nan=0) * 10), 0, 255).astype(np.uint8)

    # far grid: 481 x 481, 250 m (+-60 km), LOLA 80 m, 3x3 box average to cut aliasing
    NF = 481; SF = 60000.0; DF = 250.0
    zz3, xx3 = np.mgrid[0:NF, 0:NF].astype(np.float64)
    fx, fz = -SF + xx3 * DF, -SF + zz3 * DF
    acc = np.zeros_like(fx); cnt = np.zeros_like(fx)
    for ox in (-80, 0, 80):
        for oz in (-80, 0, 80):
            FX, FY = to_map(X0, Y0, n, e, k, fx + ox, fz + oz)
            v = s80(FX, FY); good = ~np.isnan(v); acc[good] += v[good]; cnt[good] += 1
    far = np.where(cnt > 0, acc / np.maximum(cnt, 1), np.nan) - h0 - (fx * fx + fz * fz) / (2 * R)
    far_missing = float(np.isnan(far).mean())
    far = np.where(np.isnan(far), np.nanmin(far), far)
    qf, flo, fstep = quant16(far)

    # distant horizon, 60-200 km, 720 azimuths, from 2 m above the site
    az = np.arange(720) * 0.5
    d = np.arange(60000, 200001, 160.0)
    A, D = np.meshgrid(az * math.pi / 180, d, indexing='ij')
    hx, hz = D * np.sin(A), -D * np.cos(A)
    HX, HY = to_map(X0, Y0, n, e, k, hx, hz)
    hh = s80(HX, HY) - h0 - 2 - D * D / (2 * R)
    elev = np.degrees(np.arctan2(hh, D))
    distant = np.nanmax(np.where(np.isnan(elev), -90, elev), axis=1)

    od = f'{out}/{key}'; os.makedirs(od, exist_ok=True)
    qn.tofile(f'{od}/near.bin'); qe.tofile(f'{od}/err.bin'); qf.tofile(f'{od}/far.bin')
    meta = dict(
        key=key, name=s['name'], lat=round(lat, 5), lon=round(lon, 4), heightM=round(h0, 2),
        stereoXY=[round(X0, 1), round(Y0, 1)], pick=s['pick'],
        near=dict(n=N, half=S, cell=5.0, lo=nlo, step=nstep, file='near.bin'),
        err=dict(n=101, half=S, cell=20.0, unit=0.1, file='err.bin'),
        far=dict(n=NF, half=SF, cell=DF, lo=flo, step=fstep, file='far.bin', missingFraction=round(far_missing, 4)),
        distantHorizon=dict(fromKm=60, toKm=200, stepDeg=0.5, elevDeg=[round(float(v), 3) for v in distant]),
        check=dict(height80mAtSite=round(c80, 1), difference=round(h0 - c80, 1)),
        sources=[
            f"Near ground: NASA GSFC PGDA, High-Resolution LOLA Topography for Lunar South Pole Sites, {s['pgda']} 5 m/px LDEM and total height error (Barker et al. 2021), https://pgda.gsfc.nasa.gov/products/78",
            "Far ground and distant horizon: LRO LOLA gridded polar elevation LDEM_80S_80M (PDS Geosciences Node)",
        ],
    )
    json.dump(meta, open(f'{od}/meta.json', 'w'), indent=1)
    index.append(dict(key=key, name=s['name'], lat=meta['lat'], lon=meta['lon']))
    print(f"{key}: lat {lat:.4f} lon {lon:.3f} h0 {h0:.1f} m (80 m map says {c80:.1f}); near {near.min():.1f}..{near.max():.1f} m;"
          f" far {np.nanmin(far):.0f}..{np.nanmax(far):.0f} m, missing {far_missing:.1%}; distant horizon max {distant.max():.2f} deg;"
          f" median err {np.median(qe)/10:.2f} m")
json.dump(index, open(f'{out}/sites.json', 'w'), indent=1)
