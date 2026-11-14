import { describe, expect, it } from 'vitest';
import { horizonsQuery, parseHorizonsAltAz } from '../src/astro/horizons.js';

describe('Horizons client', () => {
  it('asks for a surface point on the Moon with east longitude first', () => {
    const q = horizonsQuery({ site: { lat: -89.5, lon: 12.25 }, body: 'earth', start: new Date('2026-11-14T18:00Z'), stop: new Date('2026-11-14T19:00Z') });
    expect(q.get('COMMAND')).toBe("'399'");
    expect(q.get('CENTER')).toBe("'coord@301'");
    expect(q.get('SITE_COORD')).toBe("'12.25,-89.5,0'");
    expect(q.get('START_TIME')).toBe("'2026-11-14 18:00'");
  });

  it('parses the table between $$SOE and $$EOE', () => {
    const text = [
      'header',
      ' Date__(UT)__HR:MN, , ,Azi_(a-app), Elev_(a-app),',
      '$$SOE',
      ' 2026-Nov-14 18:00,*, , 117.488482,     1.325769,',
      ' 2026-Nov-15 06:00,*,i, 111.397578,    -1.373767,',
      '$$EOE',
    ].join('\n');
    const rows = parseHorizonsAltAz(text);
    expect(rows).toHaveLength(2);
    expect(rows[0].date.toISOString()).toBe('2026-11-14T18:00:00.000Z');
    expect(rows[0].azimuth).toBeCloseTo(117.488482);
    expect(rows[1].elevation).toBeCloseTo(-1.373767);
  });

  it('fails loudly when Horizons returns an error page instead of a table', () => {
    expect(() => parseHorizonsAltAz('No ephemeris for target')).toThrow(/no table/);
  });
});
