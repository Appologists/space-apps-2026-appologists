// The regions every mission is checked against (data/missions.json), with their coordinates and sources
// resolved. Pure: the app (src/ui/flow.js) and the tools that ask the same searches ahead of time
// (tools/warm-demo.mjs, tools/export-static.mjs) all build their regions here, so they ask the same questions.

/**
 * @param {{regions: object[], sources: object}} missions   data/missions.json
 * @param {{sites: object[], sources: object}} sitesData    data/sites.json
 * @returns {{id: string, name: string, lat: number, lon: number, searchRadiusKm: number|undefined, source: object}[]}
 */
export function missionRegions(missions, sitesData) {
  return missions.regions.map((region) => {
    const site = region.site ? sitesData.sites.find((s) => s.id === region.site) : region;
    const sources = region.site ? sitesData.sources : missions.sources;
    // A named crater stands for its middle (a reference point, not a vetted landing site); missions.json says so.
    // searchRadiusKm: the crater regions are searched 20 km round their centres, to reach the rims (our choice).
    return { id: region.id, name: site.name, lat: site.lat, lon: site.lon, searchRadiusKm: region.searchRadiusKm, source: sources[site.source] };
  });
}
