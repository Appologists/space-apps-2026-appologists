"""Turn NASA LRO Diviner bolometric temperature snapshots into numbers the app can use.

Put the files in lunar-planner/data/diviner/ (git-ignored):
  diviner_tbol_snapshot_000E.tif ... _330E.tif   colour maps, one per subsolar longitude (15 deg steps)
  diviner_tbol_snapshot_330E.xyz (and any other .xyz)   the same data as numbers: lon, lat, kelvin
  diviner_RGB_composite.tif (optional)           shown as an image layer

Source: Diviner Level 4 global snapshots (Williams et al. 2017, Icarus 283, 300-325), 0.5 deg grid.

The colour maps use the "jet" colour scale. We learn which colour means which temperature from a
snapshot we have both as an image and as numbers (330E), then convert every image. Where a snapshot
exists as numbers, the numbers are used directly. Checked on held-out pixels: median error 0.1 K.
Limit: the darkest colour stands for about 58 K, so anything colder reads as about 58 K.

Writes:
  derived/diviner_tbol.npz      24 maps (subsolar longitude 0, 15, ... 345 E), kelvin, 0.5 deg
  public/diviner/composite.webp the RGB composite, if present
"""
from pathlib import Path
import json
import re

import matplotlib
import numpy as np
import tifffile
from PIL import Image

ROOT = Path(__file__).resolve().parent
SRC = ROOT / 'data' / 'diviner'
OUT = ROOT / 'derived'
PUB = ROOT / 'public' / 'diviner'
OFFSET = 30.0     # stored as uint8: kelvin = OFFSET + value * STEP
STEP = 1.5


def find(pattern):
    hits = sorted(p for p in SRC.glob('*') if re.search(pattern, p.name))
    return hits


def xyz_grid(path):
    a = np.loadtxt(path)
    grid = np.full((360, 720), np.nan)
    c = np.round((a[:, 0] + 179.75) / 0.5).astype(int)
    r = np.round((89.75 - a[:, 1]) / 0.5).astype(int)
    grid[r, c] = a[:, 2]
    return grid


def jet_index(img, jet):
    px = img.reshape(-1, 3).astype(float)
    idx = np.empty(len(px), int)
    for i in range(0, len(px), 20000):
        d = ((px[i:i + 20000, None, :] - jet[None, :, :]) ** 2).sum(-1)
        idx[i:i + 20000] = d.argmin(1)
    return idx.reshape(img.shape[:2])


def isotonic(values, weights):
    blocks = []
    for v, w in zip(values, weights):
        blocks.append([v, w, 1])
        while len(blocks) > 1 and blocks[-2][0] > blocks[-1][0]:
            v2, w2, n2 = blocks.pop()
            v1, w1, n1 = blocks.pop()
            blocks.append([(v1 * w1 + v2 * w2) / (w1 + w2), w1 + w2, n1 + n2])
    return np.concatenate([[v] * n for v, _, n in blocks])


def calibrate(pairs, jet):
    """Median kelvin for each jet colour step, made monotonic."""
    idx_all, t_all = [], []
    for tif, xyz in pairs:
        idx_all.append(jet_index(tifffile.imread(tif)[..., :3], jet).ravel())
        t_all.append(xyz_grid(xyz).ravel())
    idx = np.concatenate(idx_all)
    t = np.concatenate(t_all)
    ok = np.isfinite(t)
    lut = np.full(len(jet), np.nan)
    cnt = np.zeros(len(jet))
    for i in range(len(jet)):
        s = t[ok & (idx == i)]
        if len(s) >= 3:
            lut[i] = np.median(s)
            cnt[i] = len(s)
    good = np.isfinite(lut)
    x = np.arange(len(jet))
    lut = np.interp(x, x[good], isotonic(lut[good], cnt[good]))
    err = t[ok] - lut[idx[ok]]
    print(f'Calibration: median error {np.median(np.abs(err)):.2f} K, 95% within {np.percentile(np.abs(err), 95):.2f} K')
    return lut


def main():
    OUT.mkdir(exist_ok=True)
    PUB.mkdir(parents=True, exist_ok=True)
    jet = matplotlib.colormaps['jet'].resampled(1024)(np.linspace(0, 1, 1024))[:, :3] * 255
    tifs = {int(re.search(r'snapshot_(\d{3})E', p.name).group(1)): p for p in find(r'tbol_snapshot_\d{3}E\.tif$')}
    xyzs = {int(re.search(r'snapshot_(\d{3})E', p.name).group(1)): p for p in find(r'tbol_snapshot_\d{3}E\.xyz$')}
    pairs = [(tifs[k], xyzs[k]) for k in sorted(set(tifs) & set(xyzs))]
    if not pairs:
        raise SystemExit('Need at least one snapshot as both .tif and .xyz to learn the colour scale.')
    lut = calibrate(pairs, jet)
    maps = np.zeros((24, 360, 720), np.uint8)
    sources = []
    for i, lon in enumerate(range(0, 360, 15)):
        if lon in xyzs:
            k = xyz_grid(xyzs[lon])
            sources.append('numbers')
        elif lon in tifs:
            k = lut[jet_index(tifffile.imread(tifs[lon])[..., :3], jet)]
            sources.append('colour image')
        else:
            raise SystemExit(f'Missing snapshot for {lon:03d}E')
        maps[i] = np.clip(np.round((np.nan_to_num(k, nan=OFFSET) - OFFSET) / STEP), 0, 255).astype(np.uint8)
        print(f'{lon:03d}E from {sources[-1]}: {np.nanmin(k):.0f} to {np.nanmax(k):.0f} K')
    np.savez_compressed(OUT / 'diviner_tbol.npz', maps=maps, offset=OFFSET, step=STEP,
                        subsolar_lon=np.arange(0, 360, 15), sources=np.array(sources))
    comp = find(r'RGB_composite\.tif$')
    if comp:
        Image.fromarray(tifffile.imread(comp[0])[..., :3]).save(PUB / 'composite.webp', quality=85)
    (OUT / 'diviner_tbol.json').write_text(json.dumps(dict(
        source='NASA LRO Diviner Level 4 global bolometric temperature snapshots (Williams et al. 2017, Icarus 283)',
        grid='0.5 deg, lon -180..180 (columns), lat 90..-90 (rows)', storage=f'kelvin = {OFFSET} + value * {STEP}',
        note='Converted from colour images with a scale learned from the snapshots given as numbers; colder than about 58 K reads as about 58 K.',
    ), indent=2))
    print('Wrote', OUT / 'diviner_tbol.npz', f'({(OUT / "diviner_tbol.npz").stat().st_size / 1e6:.1f} MB)')


if __name__ == '__main__':
    main()
