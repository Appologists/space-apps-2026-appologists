"""Server side of the education section (../education/, served at /learn).

    GET  /learn, /learn/<file>            the pages in ../education/
    GET  /api/learn/leaderboard?game=     top scores for a game (quiz or hotcold)
    POST /api/learn/score                 {name, game, score}: add a score, answer with its rank
    GET  /api/learn/sdo/<channel>.jpg     today's NASA SDO Sun image, relayed (for use as a WebGL texture)
    GET  /api/learn/epic.jpg              the newest NASA EPIC Earth image, relayed (same reason)

NASA's image servers send no CORS headers, so a browser cannot put their pictures on a 3D globe directly.
These relays fetch them once and keep them for a while. The leaderboard is a small JSON file in
lunar-planner/data/ (git-ignored), so it is shared by everyone who plays on this computer.
"""
import json
import re
import threading
import time
from datetime import datetime, timezone
from pathlib import Path

import requests
from flask import Blueprint, Response, abort, jsonify, request, send_from_directory

HERE = Path(__file__).resolve().parent
EDUCATION = HERE.parent / 'education'
BOARD_PATH = HERE / 'data' / 'leaderboard.json'
GAMES = {'quiz': 'Mission quiz', 'hotcold': 'Temperature estimate'}
MAX_SCORE = {'quiz': 4000, 'hotcold': 1000}
NAME_RE = re.compile(r"^[A-Za-z0-9 _.'-]{1,20}$")
SDO_CHANNELS = {'0171', '0193', '0304', 'HMIIC'}

bp = Blueprint('learn', __name__)
_lock = threading.Lock()
_images = {}  # key -> (expires, bytes)


@bp.get('/learn')
@bp.get('/learn/')
def learn_index():
    if not (EDUCATION / 'index.html').exists():
        abort(404)
    response = send_from_directory(EDUCATION, 'index.html', max_age=0)
    response.headers['Cache-Control'] = 'no-store'
    return response


@bp.get('/learn/<path:name>')
def learn_file(name):
    response = send_from_directory(EDUCATION, name, max_age=0)
    response.headers['Cache-Control'] = 'no-cache'
    return response


# ---------------- Leaderboard ----------------

def _load_board():
    try:
        data = json.loads(BOARD_PATH.read_text('utf-8'))
        return data if isinstance(data, list) else []
    except (OSError, ValueError):
        return []


def _top(board, game, count=10):
    rows = [r for r in board if r.get('game') == game]
    rows.sort(key=lambda r: (-r['score'], r['at']))
    return rows[:count]


@bp.get('/api/learn/leaderboard')
def leaderboard():
    game = request.args.get('game', 'quiz')
    if game not in GAMES:
        return jsonify(error='Unknown game.'), 400
    with _lock:
        board = _load_board()
    return jsonify(game=game, title=GAMES[game], top=_top(board, game),
                   players=len({r['name'].lower() for r in board if r.get('game') == game}))


@bp.post('/api/learn/score')
def add_score():
    body = request.get_json(silent=True) or {}
    name = str(body.get('name', '')).strip()
    game = body.get('game')
    try:
        score = int(body.get('score'))
    except (TypeError, ValueError):
        return jsonify(error='Score must be a whole number.'), 400
    if game not in GAMES:
        return jsonify(error='Unknown game.'), 400
    if not NAME_RE.match(name):
        return jsonify(error='Use 1 to 20 letters, numbers, spaces, dots, dashes or underscores.'), 400
    if not 0 <= score <= MAX_SCORE[game]:
        return jsonify(error='That score is out of range.'), 400
    row = dict(name=name, game=game, score=score, at=datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M'))
    with _lock:
        board = _load_board()
        board.append(row)
        # Keep each player's best 5 per game, and at most 1000 rows in all.
        board.sort(key=lambda r: (-r['score'], r['at']))
        kept, per = [], {}
        for r in board:
            key = (r['game'], r['name'].lower())
            per[key] = per.get(key, 0) + 1
            if per[key] <= 5:
                kept.append(r)
        kept = kept[:1000]
        BOARD_PATH.parent.mkdir(parents=True, exist_ok=True)
        tmp = BOARD_PATH.with_suffix('.tmp')
        tmp.write_text(json.dumps(kept, indent=0), 'utf-8')
        tmp.replace(BOARD_PATH)
        ranked = [r for r in kept if r['game'] == game]
        rank = 1 + sum(1 for r in ranked if r['score'] > score)
    return jsonify(rank=rank, top=_top(kept, game), title=GAMES[game])


# ---------------- NASA image relays ----------------

def _relay(key, url, ttl):
    now = time.time()
    hit = _images.get(key)
    if hit and hit[0] > now:
        return Response(hit[1], mimetype='image/jpeg', headers={'Cache-Control': 'max-age=600'})
    try:
        r = requests.get(url, timeout=(10, 60))
        r.raise_for_status()
    except requests.RequestException as error:
        if hit:
            return Response(hit[1], mimetype='image/jpeg')
        return jsonify(error='NASA image request failed: %s' % error), 502
    _images[key] = (now + ttl, r.content)
    return Response(r.content, mimetype='image/jpeg', headers={'Cache-Control': 'max-age=600'})


@bp.get('/api/learn/sdo/<channel>.jpg')
def sdo_image(channel):
    if channel not in SDO_CHANNELS:
        abort(404)
    return _relay('sdo-' + channel, 'https://sdo.gsfc.nasa.gov/assets/img/latest/latest_1024_%s.jpg' % channel, 900)


@bp.get('/api/learn/epic.jpg')
def epic_image():
    hit = _images.get('epic')
    if hit and hit[0] > time.time():
        return Response(hit[1], mimetype='image/jpeg', headers={'Cache-Control': 'max-age=600'})
    try:
        meta = requests.get('https://epic.gsfc.nasa.gov/api/natural', timeout=(10, 30)).json()[-1]
        when = datetime.strptime(meta['date'], '%Y-%m-%d %H:%M:%S')
        url = 'https://epic.gsfc.nasa.gov/archive/natural/%s/jpg/%s.jpg' % (when.strftime('%Y/%m/%d'), meta['image'])
    except (requests.RequestException, ValueError, KeyError, IndexError) as error:
        hit = _images.get('epic')
        if hit:
            return Response(hit[1], mimetype='image/jpeg')
        return jsonify(error='NASA EPIC request failed: %s' % error), 502
    return _relay('epic', url, 3600)
