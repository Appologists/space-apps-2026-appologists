"""Prepare NASA LOLA 5 m/pixel south-pole site data for the app.

Put the files in lunar-planner/data/south-pole/ (git-ignored):
  <Name>_final_adj_5mpp_slp.tif    slope, degrees (required)
  <Name>_final_adj_5mpp_surf.tif   height, metres above the 1737.4 km sphere (optional)
  <Name>_ROIs.shp/.shx/.dbf/.prj   regions of interest (polygons), or the .tgz/.zip that holds them

All files use south polar stereographic metres on a 1737.4 km sphere.

Writes small files to public/south-pole/:
  context.webp     hill-shaded LOLA ldem_16 around the pole (background)
  <Name>.webp      slope map of each tile, flat ground (< 5 deg) in teal
  sites.json       regions and auto-found flat spots: slope statistics, ground tilt,
                   and a terrain horizon (720 directions) from the 5 m heights plus regional LOLA
"""
from pathlib import Path
import json
import math
import re
import tarfile
import zipfile

import numpy as np
import shapefile
import tifffile
from PIL import Image

ROOT = Path(__file__).resolve().parent
SRC = ROOT / 'data' / 'south-pole'
OUT = ROOT / 'public' / 'south-pole'
LDEM = ROOT / 'data' / 'ldem_16.npy'
R = 1737400.0
CELL = 20.0          # working grid, metres
EYE_M = 2.0          # panel / antenna height for the horizon
SAFE_DEG = 5.0       # "flat enough to land" threshold
N_AZ = 720           # horizon directions (every 0.5 deg)
CONTEXT_HALF = 200000.0
ORANGE = ['#621d00', '#752500', '#8a2e00', '#9e3601', '#b53e00', '#c74b12', '#d85a27', '#e96a38',
          '#f97948', '#fe9068', '#ffa98a', '#ffbfa9', '#fed5c7']   # team repo slope ramp


def xy_to_latlon(x, y):
    rho = np.hypot(x, y)
    lon = np.degrees(np.arctan2(x, y))
    lat = np.degrees(2 * np.arctan(rho / (2 * R)) - np.pi / 2)
    return lat, lon


def block_mean(a, k):
    n0 = a.shape[0] // k * k
    n1 = a.shape[1] // k * k
    b = a[:n0, :n1].reshape(n0 // k, k, n1 // k, k)
    with np.errstate(invalid='ignore'):
        return np.nanmean(b, axis=(1, 3))


def bilinear(grid, fx, fy):
    """Sample grid at fractional (column, row); NaN outside."""
    h, w = grid.shape
    ok = (fx >= 0) & (fy >= 0) & (fx <= w - 1.001) & (fy <= h - 1.001)
    fx = np.clip(fx, 0, w - 1.001)
    fy = np.clip(fy, 0, h - 1.001)
    x0 = fx.astype(int)
    y0 = fy.astype(int)
    ax = fx - x0
    ay = fy - y0
    v = (grid[y0, x0] * (1 - ax) * (1 - ay) + grid[y0, x0 + 1] * ax * (1 - ay)
         + grid[y0 + 1, x0] * (1 - ax) * ay + grid[y0 + 1, x0 + 1] * ax * ay)
    return np.where(ok, v, np.nan)


class Ldem:
    """Global LOLA ldem_16 (km), sampled by south polar stereographic x, y (m)."""

    def __init__(self):
        self.g = np.load(LDEM, mmap_mode='r') if LDEM.exists() else None

    def height_m(self, x, y):
        if self.g is None:
            return np.full(np.shape(x), np.nan)
        lat, lon = xy_to_latlon(np.asarray(x, float), np.asarray(y, float))
        rows, cols = self.g.shape
        ppd = cols / 360.0
        fx = ((lon + 180.0) % 360.0) * ppd - 0.5
        fy = np.clip((90.0 - lat) * ppd - 0.5, 0, rows - 1.001)
        x0 = np.floor(fx).astype(int)
        y0 = np.floor(fy).astype(int)
        ax = fx - x0
        ay = fy - y0
        xa = x0 % cols
        xb = (x0 + 1) % cols
        g = self.g
        v = (g[y0, xa] * (1 - ax) * (1 - ay) + g[y0, xb] * ax * (1 - ay)
             + g[y0 + 1, xa] * (1 - ax) * ay + g[y0 + 1, xb] * ax * ay)
        return v * 1000.0


class Tile:
    def __init__(self, slp_path):
        self.name = re.match(r'(.+?)_final_adj_5mpp_slp', slp_path.stem).group(1)
        with tifffile.TiffFile(slp_path) as t:
            tags = {k.name: k.value for k in t.pages[0].tags.values()}
            self.slope5 = t.asarray().astype(np.float32)
        self.res = float(tags['ModelPixelScaleTag'][0])
        tie = tags['ModelTiepointTag']
        self.x0 = float(tie[3])
        self.y0 = float(tie[4])
        self.n = self.slope5.shape[0]
        self.size = self.n * self.res
        surf_path = slp_path.with_name(slp_path.name.replace('_slp', '_surf'))
        self.surf5 = tifffile.imread(surf_path).astype(np.float32) if surf_path.exists() else None
        k = int(CELL / self.res)
        self.slope20 = block_mean(self.slope5, k)
        self.surf20 = block_mean(self.surf5, k) if self.surf5 is not None else None

    def contains(self, x, y):
        return self.x0 <= x < self.x0 + self.size and self.y0 - self.size < y <= self.y0

    def frac(self, x, y, cell):
        """Fractional (column, row) on a grid with the given cell size."""
        return (x - self.x0) / cell - 0.5, (self.y0 - y) / cell - 0.5


def find_rois():
    """Extract any ROI archives, then read every ROI shapefile."""
    for arc in list(SRC.glob('*.tgz')) + list(SRC.glob('*.tar.gz')):
        with tarfile.open(arc) as t:
            for m in t.getmembers():
                if m.isfile() and Path(m.name).suffix in ('.shp', '.shx', '.dbf', '.prj'):
                    (SRC / Path(m.name).name).write_bytes(t.extractfile(m).read())
    for arc in SRC.glob('*.zip'):
        with zipfile.ZipFile(arc) as z:
            for n in z.namelist():
                if Path(n).suffix in ('.shp', '.shx', '.dbf', '.prj'):
                    (SRC / Path(n).name).write_bytes(z.read(n))
    rois = []
    for shp in sorted(SRC.glob('*_ROIs.shp')):
        site = shp.stem.replace('_ROIs', '')
        for i, sh in enumerate(shapefile.Reader(str(shp)).shapes()):
            pts = np.array(sh.points, float)
            rois.append(dict(site=site, index=i + 1, pts=pts))
    return rois


def polygon_centroid_area(p):
    x, y = p[:, 0], p[:, 1]
    cross = x * np.roll(y, -1) - np.roll(x, -1) * y
    a = cross.sum() / 2
    if abs(a) < 1e-9:
        return p.mean(axis=0), 0.0
    cx = ((x + np.roll(x, -1)) * cross).sum() / (6 * a)
    cy = ((y + np.roll(y, -1)) * cross).sum() / (6 * a)
    return np.array([cx, cy]), abs(a)


def inside(px, py, poly):
    """Even-odd point-in-polygon for arrays of points."""
    res = np.zeros(px.shape, bool)
    x, y = poly[:, 0], poly[:, 1]
    j = len(poly) - 1
    for i in range(len(poly)):
        cond = ((y[i] > py) != (y[j] > py)) & (px < (x[j] - x[i]) * (py - y[i]) / (y[j] - y[i] + 1e-12) + x[i])
        res ^= cond
        j = i
    return res


def roi_stats(tile, poly):
    xs, ys = poly[:, 0], poly[:, 1]
    c0 = int(max(0, (xs.min() - tile.x0) / tile.res))
    c1 = int(min(tile.n, (xs.max() - tile.x0) / tile.res + 1))
    r0 = int(max(0, (tile.y0 - ys.max()) / tile.res))
    r1 = int(min(tile.n, (tile.y0 - ys.min()) / tile.res + 1))
    cols, rows = np.meshgrid(np.arange(c0, c1), np.arange(r0, r1))
    px = tile.x0 + (cols + 0.5) * tile.res
    py = tile.y0 - (rows + 0.5) * tile.res
    m = inside(px, py, poly)
    s = tile.slope5[r0:r1, c0:c1][m]
    s = s[np.isfinite(s)]
    out = dict(slope_mean=float(np.mean(s)), slope_p90=float(np.percentile(s, 90)),
               frac_safe=float(np.mean(s < SAFE_DEG))) if s.size else {}
    if tile.surf5 is not None:
        z = tile.surf5[r0:r1, c0:c1][m]
        z = z[np.isfinite(z)]
        if z.size:
            out['elev_m'] = float(np.mean(z))
    return out


def ground_normal(tile, x, y, ldem):
    """Tilt and downhill direction (compass deg) of the ground, over about 60 m."""
    north = np.array([x, y]) / max(1.0, math.hypot(x, y))
    east = np.array([y, -x]) / max(1.0, math.hypot(x, y))
    d = CELL * 1.5
    if tile is not None and tile.surf20 is not None:
        f = lambda xx, yy: float(bilinear(tile.surf20, *map(np.array, tile.frac(xx, yy, CELL))))
    else:
        d = 2000.0
        f = lambda xx, yy: float(ldem.height_m(xx, yy))
    def h(dn, de):
        p = np.array([x, y]) + dn * north + de * east
        return f(p[0], p[1])
    dzde = (h(0, d) - h(0, -d)) / (2 * d)
    dzdn = (h(d, 0) - h(-d, 0)) / (2 * d)
    if not (np.isfinite(dzde) and np.isfinite(dzdn)):
        return 0.0, 0.0
    tilt = math.degrees(math.atan(math.hypot(dzde, dzdn)))
    downhill = (math.degrees(math.atan2(-dzde, -dzdn)) + 360) % 360
    return tilt, downhill


def horizon(tile, x, y, z0, ldem):
    """Elevation angle of the highest terrain in each of 720 directions (deg), from EYE_M above ground."""
    az = np.radians(np.arange(N_AZ) * 360.0 / N_AZ)
    rho = max(1.0, math.hypot(x, y))
    north = np.array([x, y]) / rho
    east = np.array([y, -x]) / rho
    dirx = np.cos(az)[:, None] * north[0] + np.sin(az)[:, None] * east[0]
    diry = np.cos(az)[:, None] * north[1] + np.sin(az)[:, None] * east[1]
    best = np.full(N_AZ, -90.0)
    eye = z0 + EYE_M
    local_max = 0.0
    if tile is not None and tile.surf20 is not None:
        d = np.arange(CELL, tile.size * 1.45, CELL)[None, :]
        px = x + dirx * d
        py = y + diry * d
        fx, fy = tile.frac(px, py, CELL)
        z = bilinear(tile.surf20, fx, fy)
        ang = np.degrees(np.arctan2(z - eye - d * d / (2 * R), d))
        best = np.fmax(best, np.nanmax(np.where(np.isfinite(ang), ang, -90), axis=1))
        local_max = 6000.0
    d = np.arange(max(local_max, 1000.0), 150000.0, 500.0)[None, :]
    px = x + dirx * d
    py = y + diry * d
    z = ldem.height_m(px, py)
    ang = np.degrees(np.arctan2(z - eye - d * d / (2 * R), d))
    best = np.fmax(best, np.nanmax(np.where(np.isfinite(ang), ang, -90), axis=1))
    return best


def hex_rgb(h):
    return [int(h[i:i + 2], 16) for i in (1, 3, 5)]


def render_tile(tile):
    s = tile.slope20
    n = s.shape[0]
    t = np.clip(s / 25.0, 0, 1) * (len(ORANGE) - 1)
    i = np.clip(np.floor(t).astype(int), 0, len(ORANGE) - 2)
    f = (t - i)[..., None]
    ramp = np.array([hex_rgb(h) for h in ORANGE], float)
    rgb = ramp[i] * (1 - f) + ramp[i + 1] * f
    if tile.surf20 is not None:
        z = tile.surf20
        gy, gx = np.gradient(np.nan_to_num(z, nan=np.nanmean(z)), CELL)
        shade = np.clip(0.55 + 0.45 * ((-gx * -0.5 + gy * 0.5 + 0.7) / np.sqrt(gx * gx + gy * gy + 1)), 0.25, 1.15)
        rgb *= shade[..., None]
    safe = s < SAFE_DEG
    rgb[safe] = rgb[safe] * 0.25 + np.array([79, 227, 193]) * 0.75
    alpha = np.where(np.isfinite(s), 235, 0)
    img = np.dstack([np.clip(rgb, 0, 255), alpha]).astype(np.uint8)
    im = Image.fromarray(img, 'RGBA')
    im = im.resize((min(n, 640), min(n, 640)), Image.LANCZOS)
    im.save(OUT / f'{tile.name}.webp', quality=80, method=6)


def render_context(ldem):
    n = 900
    cell = 2 * CONTEXT_HALF / n
    xs = -CONTEXT_HALF + (np.arange(n) + 0.5) * cell
    gx, gy = np.meshgrid(xs, -xs)
    z = ldem.height_m(gx, gy)
    dzx = np.gradient(z, cell, axis=1)
    dzy = np.gradient(z, cell, axis=0) * -1
    ex = 3.0
    dzx *= ex
    dzy *= ex
    lam = (dzx * 0.6 + dzy * 0.6 + 1.0) / np.sqrt(dzx * dzx + dzy * dzy + 1) / np.sqrt(1.72)
    shade = np.clip((lam - 0.35) / 0.65, 0, 1) ** 1.3
    v = (18 + 175 * shade).astype(np.uint8)
    Image.fromarray(np.dstack([v, v, v]), 'RGB').save(OUT / 'context.webp', quality=82, method=6)


def flat_spots(tile, how_many=3):
    """Best flat ground in a tile: the highest share of < 5 deg slope within 100 m."""
    safe = np.nan_to_num(tile.slope20 < SAFE_DEG).astype(float)
    k = 11
    c = np.pad(safe, ((1, 0), (1, 0))).cumsum(0).cumsum(1)
    win = (c[k:, k:] - c[:-k, k:] - c[k:, :-k] + c[:-k, :-k]) / (k * k)
    slope = np.nan_to_num(tile.slope20, nan=90.0)
    cs = np.pad(slope, ((1, 0), (1, 0))).cumsum(0).cumsum(1)
    mean_slope = (cs[k:, k:] - cs[:-k, k:] - cs[k:, :-k] + cs[:-k, :-k]) / (k * k)
    rank = win * 100 - mean_slope
    picks = []
    order = np.argsort(rank, axis=None)[::-1]
    for idx in order[:20000]:
        r, cidx = np.unravel_index(idx, rank.shape)
        if win[r, cidx] < 0.95:
            break
        x = tile.x0 + (cidx + k / 2) * CELL
        y = tile.y0 - (r + k / 2) * CELL
        if all(math.hypot(x - p[0], y - p[1]) > 2500 for p in picks):
            picks.append((x, y, float(win[r, cidx]), float(mean_slope[r, cidx])))
        if len(picks) >= how_many:
            break
    return picks


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    ldem = Ldem()
    if ldem.g is None:
        print('Note: data/ldem_16.npy not found (run build_terrain.py). Horizons will use 5 m tiles only.')
    tiles = [Tile(p) for p in sorted(SRC.glob('*_final_adj_5mpp_slp.tif'))]
    print('Tiles:', ', '.join(f'{t.name}{"+surf" if t.surf5 is not None else ""}' for t in tiles))
    for t in tiles:
        render_tile(t)
    if ldem.g is not None:
        render_context(ldem)
    tile_for = lambda x, y: next((t for t in tiles if t.contains(x, y)), None)

    sites = []
    for roi in find_rois():
        (cx, cy), area = polygon_centroid_area(roi['pts'])
        t = tile_for(cx, cy)
        stats = roi_stats(t, roi['pts']) if t else {}
        sites.append(dict(id=f"{roi['site']}-R{roi['index']}", kind='roi', label=f"{roi['site']} region {roi['index']}",
                          tile=t.name if t else None, x=cx, y=cy, area_m2=area,
                          poly=[[round(float(a), 1), round(float(b), 1)] for a, b in roi['pts'][::2]], **stats))
    for t in tiles:
        for i, (x, y, frac, ms) in enumerate(flat_spots(t)):
            # Tiles can overlap: skip a spot already found in another tile.
            if any(s['kind'] == 'flat' and math.hypot(s['x'] - x, s['y'] - y) < 1000 for s in sites):
                continue
            sites.append(dict(id=f'{t.name}-F{i + 1}', kind='flat', label=f'{t.name} flat spot {i + 1}', tile=t.name,
                              x=x, y=y, area_m2=math.pi * 100 ** 2, slope_mean=ms, frac_safe=frac))
    for s in sites:
        t = next((t for t in tiles if t.name == s['tile']), None)
        lat, lon = xy_to_latlon(s['x'], s['y'])
        s['lat'] = round(float(lat), 5)
        s['lon'] = round(float(lon), 5)
        if 'elev_m' not in s:
            if t is not None and t.surf20 is not None:
                s['elev_m'] = float(bilinear(t.surf20, *map(np.array, t.frac(s['x'], s['y'], CELL))))
            else:
                s['elev_m'] = float(ldem.height_m(s['x'], s['y']))
        s['tilt_deg'], s['downhill_deg'] = ground_normal(t, s['x'], s['y'], ldem)
        s['horizon_source'] = '5 m LOLA tile + regional LOLA' if (t is not None and t.surf20 is not None) else 'regional LOLA (1.9 km)'
        s['horizon'] = [round(float(v), 2) for v in horizon(t, s['x'], s['y'], s['elev_m'], ldem)]
        for k in ('slope_mean', 'slope_p90', 'frac_safe', 'elev_m', 'area_m2', 'x', 'y', 'tilt_deg', 'downhill_deg'):
            if k in s and s[k] is not None:
                s[k] = round(float(s[k]), 3)
        print(f"{s['id']:<14} {s['lat']:9.4f} {s['lon']:9.3f}  slope {s.get('slope_mean', float('nan')):5.1f}  "
              f"max horizon {max(s['horizon']):5.2f} deg")
    meta = dict(
        source='NASA LOLA 5 m/pixel south-pole site products (surface, slope, regions of interest); regional horizon from LOLA ldem_16',
        projection='South polar stereographic, sphere radius 1737400 m',
        safe_slope_deg=SAFE_DEG, eye_height_m=EYE_M, context_half_m=CONTEXT_HALF,
        tiles=[dict(name=t.name, png=f'/south-pole/{t.name}.webp', x0=t.x0, y0=t.y0, size=t.size,
                    has_surface=t.surf5 is not None) for t in tiles],
        sites=sites,
    )
    (OUT / 'sites.json').write_text(json.dumps(meta))
    print(f'Wrote {len(sites)} sites and {len(tiles)} tiles to {OUT}')


if __name__ == '__main__':
    main()
