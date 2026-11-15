# Education section

A learning page for the Lunar Landing Site Navigator, served by the Flask app at
**http://127.0.0.1:8002/learn** (start it with `lunar-planner/start.ps1` or `start.sh`).

| Part | What it does | Data |
| --- | --- | --- |
| 3D lab: Moon | The 23 sites from `data/sites.json` on a 3D Moon; select one to see its measured temperature through a lunar day | LRO LROC colour map, LOLA heights (4x relief), LRO Diviner |
| 3D lab: Earth | Today's full-disc photo of Earth on a globe | NASA EPIC (DSCOVR) |
| 3D lab: Sun | Today's Sun in 4 channels (AIA 171, 193, 304; HMI visible) | NASA SDO |
| 3D lab: Sun, Earth, Moon | Where the Moon and Sun are now, the phase, and a time slider; one click checks the phase against JPL Horizons | Astronomy Engine, JPL Horizons |
| Facts | 20 cards, each with its NASA source | `content.js` |
| Exercises | Mission quiz (18 questions, timed, streak bonus); temperature estimate (5 real sites, scored against Diviner) | `content.js`, LRO Diviner |
| Leaderboard | Top 10 per exercise, shared by everyone on the same computer | `lunar-planner/data/leaderboard.json` (git-ignored) |

Progress (XP, badges, facts read) is kept in the browser (`localStorage`).

## Files

| File | What |
| --- | --- |
| `index.html`, `learn.css`, `learn.js` | The page (vanilla JS, three.js from `lunar-planner/public/vendor/`) |
| `content.js` | Facts, quiz questions and badges, each with a source |
| `fonts/` | Geist Pixel and Geist Mono (Vercel) and Wix Madefor Text (the base44 typeface), SIL Open Font License |
| `../lunar-planner/learn_api.py` | Leaderboard, and relays for the NASA SDO and EPIC images (NASA's servers send no CORS headers, so a browser cannot put them on a 3D globe directly) |

## Type

Headings use **Geist Pixel** with its `ELSH` axis (square, grid, circle, triangle and line pixels; the switch in
the header changes it). Body text is **Wix Madefor Text**; numbers are **Geist Mono**.
