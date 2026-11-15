// "Best available" terrain: several datasets behind one, with the dataset chosen for each sample.
// Node only. server/lola-polar.mjs's heightAt/sampleAt walk the list this module returns and take the first
// dataset that has data at the point.
//
// A caller may say how fine it needs the terrain (metres per pixel). Far-away ground is sampled sparsely, so
// 59 m data adds nothing there and reading it would touch gigabytes of the tiled dataset. The rule:
//   1. Regional grids (the south-pole 80 m grid) come first wherever they cover: they are made for their
//      area, already in memory, and better near the pole than a whole-Moon map.
//   2. Among whole-Moon datasets: the coarsest one that is still at least as fine as asked. If it has no
//      data at the point, finer ones (nearest first), then coarser ones (nearest first).
//   3. Asking for finer than anything here, or not saying, gets the finest.

/**
 * @param {{dem: object, pixelM: number, regional?: boolean}[]} entries  the datasets to combine
 * @param {{id: string, pixelM: number}} info  what the whole reports as its id and its pixel size
 */
export function makeComposite(entries, { id, pixelM }) {
  const regional = entries.filter((e) => e.regional).map((e) => e.dem);
  const global = entries.filter((e) => !e.regional).sort((a, b) => a.pixelM - b.pixelM);
  // One list per choice of first whole-Moon dataset. tiers[i] serves requests below tiers[i].belowM.
  const tiers = global.map((_, pick) => {
    const order = [];
    for (let i = pick; i >= 0; i--) order.push(global[i].dem); // the pick, then finer
    for (let i = pick + 1; i < global.length; i++) order.push(global[i].dem); // then coarser
    return { belowM: pick + 1 < global.length ? global[pick + 1].pixelM : Infinity, sources: [...regional, ...order] };
  });
  if (tiers.length === 0) tiers.push({ belowM: Infinity, sources: regional });
  // detailVaries: far-away samples may come from coarser data than near ones (the app says so).
  return { kind: 'composite', id, pixelM, sources: tiers[0].sources, tiers, detailVaries: global.length > 1 };
}

/**
 * The datasets to try for a sample, in order.
 * @param {object} composite
 * @param {number} [wantM]  how fine the caller needs the terrain, metres per pixel; omit for the finest
 */
export function sourcesFor(composite, wantM) {
  const { tiers } = composite;
  if (!tiers) return composite.sources;
  for (let i = 0; i < tiers.length; i++) {
    if (!(wantM >= tiers[i].belowM)) return tiers[i].sources; // also true when wantM is missing
  }
  return tiers[tiers.length - 1].sources;
}
