"""Download a terrain dataset listed in data/catalog.json into data/raw/<id>/ (the npm version's
`npm run data:fetch -- <id>`, in Python).

    python lunar-planner/fetch_data.py --list
    python lunar-planner/fetch_data.py lola-south-80s-80m
    python lunar-planner/fetch_data.py ldem-64 --large      (over 1 GB)
"""
import json
import sys
from pathlib import Path

import requests

REPO = Path(__file__).resolve().parent.parent
CATALOG = REPO / 'data' / 'catalog.json'
RAW = REPO / 'data' / 'raw'
LARGE_BYTES = 1_000_000_000


def human(n):
    for unit in ('B', 'KB', 'MB', 'GB'):
        if n < 1000 or unit == 'GB':
            return ('%.0f %s' if unit in ('B', 'KB') else '%.1f %s') % (n, unit)
        n /= 1000


def datasets():
    return json.loads(CATALOG.read_text('utf-8'))['datasets']


def download(url, dest, expected):
    if dest.exists() and (not expected or dest.stat().st_size == expected):
        print('  have %s' % dest.name)
        return
    part = dest.with_suffix(dest.suffix + '.part')
    with requests.get(url, stream=True, timeout=(15, 120)) as r:
        r.raise_for_status()
        total = expected or int(r.headers.get('content-length', 0))
        done = 0
        shown = -1
        with open(part, 'wb') as f:
            for chunk in r.iter_content(1 << 20):
                f.write(chunk)
                done += len(chunk)
                if total and 50 * done // total != shown:
                    shown = 50 * done // total
                    print('\r  %s  %s of %s (%d%%)' % (dest.name, human(done), human(total), 100 * done // total), end='', flush=True)
    print()
    if expected and part.stat().st_size != expected:
        raise SystemExit('%s: got %d bytes, expected %d. Run this again to retry.' % (dest.name, part.stat().st_size, expected))
    part.replace(dest)


def main(args):
    if not args or args[0] in ('-h', '--help'):
        print(__doc__)
        return
    if args[0] == '--list':
        for d in datasets():
            size = sum(f.get('bytes', 0) for f in d['files'])
            have = all((RAW / d['id'] / f['url'].rsplit('/', 1)[1]).exists() for f in d['files'])
            print('%-26s %10s  %s%s' % (d['id'], human(size), d['title'], '  [downloaded]' if have else ''))
        return
    wanted = args[0]
    d = next((x for x in datasets() if x['id'] == wanted), None)
    if d is None:
        raise SystemExit('Unknown dataset "%s". Run with --list to see them.' % wanted)
    size = sum(f.get('bytes', 0) for f in d['files'])
    if size > LARGE_BYTES and '--large' not in args:
        raise SystemExit('%s is %s. Add --large to download it.' % (wanted, human(size)))
    folder = RAW / wanted
    folder.mkdir(parents=True, exist_ok=True)
    print('%s: %s (%s) -> %s' % (wanted, d['title'], human(size), folder))
    for f in d['files']:
        download(f['url'], folder / f['url'].rsplit('/', 1)[1], f.get('bytes'))
    print('Done. Reload the app.')


if __name__ == '__main__':
    main(sys.argv[1:])
