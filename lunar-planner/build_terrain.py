"""Download NASA LOLA elevation (16 px/deg, about 1.9 km) and prepare it for the app.

Makes:
  data/ldem_16.npy                         float32 km, for street-view terrain
  public/textures/moon-elevation-grid.bin  int16 m, 1440 x 720, for hover readouts
"""
from pathlib import Path
import sys

import numpy as np
import requests
from PIL import Image

ROOT = Path(__file__).resolve().parent
DATA = ROOT / 'data'
URL = 'https://svs.gsfc.nasa.gov/vis/a000000/a004700/a004720/ldem_16.tif'


def download(path):
    with requests.get(URL, stream=True, timeout=(10, 300)) as response:
        response.raise_for_status()
        total = int(response.headers.get('content-length', 0))
        done = 0
        temp = path.with_suffix('.part')
        with open(temp, 'wb') as out:
            for chunk in response.iter_content(1 << 20):
                out.write(chunk)
                done += len(chunk)
                if total:
                    sys.stdout.write('\rDownloading LOLA ldem_16.tif: %d%%' % (100 * done // total))
                    sys.stdout.flush()
        temp.replace(path)
    print()


def main():
    DATA.mkdir(exist_ok=True)
    tif = DATA / 'ldem_16.tif'
    if not tif.exists():
        download(tif)
    Image.MAX_IMAGE_PIXELS = None
    height = np.array(Image.open(tif), dtype=np.float32)
    if height.shape != (2880, 5760):
        raise ValueError('Unexpected DEM shape %s' % (height.shape,))
    if not np.isfinite(height).all() or height.min() < -20 or height.max() > 20:
        raise ValueError('Unexpected DEM values. Expected kilometers.')
    np.save(DATA / 'ldem_16.npy', height)
    coarse = height.reshape(720, 4, 1440, 4).mean(axis=(1, 3))
    out = ROOT / 'public' / 'textures'
    out.mkdir(parents=True, exist_ok=True)
    np.round(coarse * 1000).astype('<i2').tofile(out / 'moon-elevation-grid.bin')
    print('Ready. Elevation range %.2f to %.2f km.' % (height.min(), height.max()))


if __name__ == '__main__':
    main()
