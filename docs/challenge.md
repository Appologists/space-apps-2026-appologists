# The challenge

[Lunar Landing Site Navigator](https://www.spaceappschallenge.org/2026/challenges/lunar-landing-site-navigator/),
NASA Space Apps Challenge 2026. Read the page itself for the full text; this is our summary (read 2026-11-14).

## The problem, in one paragraph

Picking where and when to land on the Moon depends on where the Sun is (power, temperature) and where Earth
is (talking to the lander without a relay satellite). At the south pole both sit near the horizon, so a small
change in place or date changes everything. Plans slip, so planners must re-check other sites and dates
quickly. The tools that have the answers (QuickMap, Moon Trek, JPL Horizons) are built for specialists and
slow for comparing options. The ask: an intuitive tool that lets mission planners, teachers and the public
compare sites and dates fast.

## What the challenge suggests, and where we stand

| Suggested | Status here |
| --- | --- |
| Choose from notable sites (Apollo, CLPS targets, commercial, other countries) and enter your own coordinates | Started: 23 sites, click or type your own. No CLPS or Artemis targets yet. |
| Compare several sites side by side | Ranked list only. Side-by-side view not built. |
| Choose landing date and time; explore lunar days and seasons | Date, time and five mission lengths. No date-versus-date comparison yet. |
| Show Sun and Earth relative to the horizon; time left before sunset or Earthset | Done on the site card, for a smooth-Moon horizon. |
| Power and communication numbers: Sun elevation, hours of sunlight, Earth visibility windows | Done for a smooth-Moon horizon. No power estimate yet. |
| 2D maps, 3D views or other pictures | 3D globe and a timeline strip. No sky view or 2D map. |
| Animations or timelines over a lunar day | Time slider and Play. |
| Useful to planners and understandable to the public | Not yet tested on anyone. |
| Real terrain for horizons (LOLA); steep slopes and deep craters at the south pole | **Not done. Biggest gap.** |
| Earth's libration and the Moon's orbit | Included: the ephemeris has both. |
| No atmosphere, so no refraction | Included: none applied. Height above ground lowers the horizon slightly. |

## Resources the challenge lists

- **LROC QuickMap** (Arizona State University): browse LRO imagery and topography.
- **NASA Moon Trek**: 3D viewer with terrain layers.
- **JPL Horizons**: positions of the Sun and Earth from any point on the Moon. We check our maths against it.
- **Canadian Space Agency, Moon Exploration portal**: background on Canada's Moon missions and its part in
  Artemis. Reading material, not a dataset.

## Questions judges may ask

- *Why not just use Horizons?* It answers one site, one body, one time range per request, as a text table.
  We answer "which of these sites is best for this mission" on one screen, and show our numbers agree with
  Horizons (the "Check against JPL Horizons" button, and `npm run check:horizons`).
- *How accurate is it?* Positions agree with Horizons to about 0.004°. The horizon is a smooth sphere until
  terrain is added; the app says so on screen.
