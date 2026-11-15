import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// The street view is one page with its script inside it (public/Street-view/index.html), so these tests read the
// page's text and run the two pieces that decide what is real in the picture: the decoration each site adds, and the
// words of the label that says so. Team decision 9: nothing as big as NASA's map can show is made up.
const page = readFileSync(new URL('../public/Street-view/index.html', import.meta.url), 'utf8');
function between(from, to) {
  const a = page.indexOf(from);
  const b = page.indexOf(to, a);
  if (a < 0 || b < 0) throw new Error(`The street view page no longer has "${from}" followed by "${to}".`);
  return page.slice(a, b);
}
const SITES = new Function(`${between('const SITES = {', 'const SITE_KEYS')}; return SITES;`)();
const groundLabel = new Function('SF', `${between('function groundLabel(', 'function showGroundLabel(')}; return groundLabel;`)(60000);
const onNasaGround = Object.entries(SITES).filter(([, site]) => site.deco);
const meta = { fineGround: true, distantHorizon: { fromKm: 60, toKm: 200 } };

describe('the street view adds nothing as big as the data can show', () => {
  it('has the four sites on NASA ground, and one that says it is made up', () => {
    expect(onNasaGround.map(([key]) => key)).toEqual(['shackleton', 'ridge', 'malapert', 'here']);
    expect(SITES.apollo11.illustrative).toBe(true);
  });

  it.each(onNasaGround)('%s: no made-up hills, rolling ground or big craters', (_key, site) => {
    const allowed = ['refSunAz', 'fine', 'small', 'atCentre'];
    expect(Object.keys(site.deco).filter((key) => !allowed.includes(key))).toEqual([]);
  });

  it.each(onNasaGround)('%s: the craters and bumps it adds are under 30 m, as the label says', (_key, site) => {
    expect(2 * site.deco.small.rmax).toBeLessThan(30); // rmax is a radius in metres
    expect(site.deco.fine).toBeLessThanOrEqual(2.2); // bumps: metres up or down, over about 22 m
  });

  it('draws real ground as the smoothed map plus that decoration only', () => {
    const real = between('if(st.near){', 'FAR=st.far;');
    expect(real).toContain('HS[k]=SM[k];');
    expect(real).toContain('H[k]=SM[k] + ');
    expect(real).not.toMatch(/hills|\.amp\b|dc\.craters|dc\.scale/);
  });
});

describe('the label on the street view picture', () => {
  it('says what is real, what is added for looks, and how far the hills are drawn', () => {
    const [real, looks, far] = groundLabel({ meta });
    expect(real).toBe('Real: the ground and hills (NASA LOLA 5 m), and where the Sun and Earth are.');
    expect(looks).toMatch(/^Added for looks: craters under 30 m, bumps and rocks\. .*drawn larger than life\.$/);
    expect(far).toBe('Hills are drawn to 60 km; the numbers use terrain to 200 km.');
  });

  it('says when a spot has only the 80 m map', () => {
    expect(groundLabel({ meta: { ...meta, fineGround: false } })[0]).toContain('NASA LOLA 80 m; no 5 m map here');
  });

  it('says the ground is made up where it is', () => {
    const lines = groundLabel({ illustrative: true });
    expect(lines[0]).toMatch(/^Made up: the ground here/);
    expect(lines.join(' ')).not.toMatch(/Real: the ground/);
  });

  it('has a short form that fits the wrist panel in VR and says the same three things', () => {
    const lines = groundLabel({ meta }, true);
    expect(lines).toHaveLength(3);
    for (const line of lines) expect(line.length).toBeLessThanOrEqual(64); // 640 px wide at 15 px mono
    expect(lines.join(' ')).toMatch(/Real: .*For looks: craters under 30 m.*60 km.*200 km/);
    expect(page).toContain('groundLabel(site,true).forEach');
  });

  it('is not hidden in a narrow window', () => {
    expect(page).not.toMatch(/@media[^\n]*#badge\s*\{\s*display:\s*none/);
    expect(page).toMatch(/@media \(max-width:1000px\)\{[^\n]*#badge, body\.in-app #badge\{top:auto;/);
  });
});
