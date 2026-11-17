const BANDS = new Set(['STRONG', 'CONDITIONAL']);
const coords = value => Array.isArray(value) && value.length === 2 &&
  value.every(Number.isFinite) && Math.abs(value[0]) <= 180 && Math.abs(value[1]) <= 85.051129;

export function readRun(run) {
  if (run?.schema !== 'fitme-prospect-map-v1' ||
      !coords(run.focal?.coordinates) ||
      typeof run.focal.name !== 'string' ||
      !Number.isFinite(run.focal.radius_meters) || run.focal.radius_meters <= 0 ||
      typeof run.target?.label !== 'string' ||
      run.baseline?.source !== 'osm_geofabrik_pbf' ||
      !run.coverage || !Array.isArray(run.worksites) ||
      !run.occupations || typeof run.occupations !== 'object') {
    throw new Error('Choose a prospect_map.json file produced by the ESCO leads command.');
  }
  const hasTiers = run.transfer_review !== undefined;
  if (hasTiers && ![1, 2, 3, 4].every(tier => typeof run.transfer_review?.tiers?.[tier] === 'string')) {
    throw new Error('This reviewed run is missing the transfer tier definitions.');
  }
  const roles = new Map(Object.entries(run.occupations));
  const groups = readGroups(run, roles);
  const ids = new Set();
  for (const [uri, role] of roles) {
    if (!role || typeof role.label !== 'string' || typeof role.group !== 'string' ||
        !BANDS.has(role.band) || !Number.isFinite(role.score)) {
      throw new Error('The run contains an invalid ESCO source occupation: ' + uri);
    }
  }
  const targets = readTargets(run, roles);
  const rows = run.worksites.map(site => {
    if (!site || typeof site.id !== 'string' || ids.has(site.id) || typeof site.name !== 'string' ||
        !coords(site.coordinates) || !Number.isFinite(site.distance_meters) || site.distance_meters < 0 ||
        !Array.isArray(site.links) || site.links.length === 0) {
      throw new Error('The run contains an invalid or repeated worksite.');
    }
    ids.add(site.id);
    const seen = new Set();
    const matches = site.links.map(link => {
      if (!link || !roles.has(link.uri) || seen.has(link.uri) ||
          typeof link.osm_evidence !== 'string' || !link.osm_evidence ||
          typeof link.crosswalk_rules !== 'string') {
        throw new Error('The run contains an invalid occupation link for ' + site.name + '.');
      }
      if (hasTiers && (![1, 2, 3, 4].includes(link.transfer_tier) ||
          typeof link.tier_reason !== 'string' || !link.tier_reason.trim() ||
          typeof link.tier_rule !== 'string' ||
          (link.transfer_tier === 1 && roles.get(link.uri).band !== 'STRONG'))) {
        throw new Error('The reviewed occupation link has an invalid tier for ' + site.name + '.');
      }
      seen.add(link.uri);
      return { ...link, role: roles.get(link.uri) };
    });
    if (hasTiers && site.transfer_tier !== Math.min(...matches.map(link => link.transfer_tier))) {
      throw new Error('The reviewed worksite tier does not match its evidence for ' + site.name + '.');
    }
    return {
      ...site, lat: site.coordinates[1], lon: site.coordinates[0], matches,
      search: [site.name, site.city, site.state, site.address].filter(Boolean).join(' ').toLowerCase(),
    };
  });
  const competitorReview = run.competitor_review ?? null;
  const competitors = new Map();
  if (competitorReview) {
    if (competitorReview.schema !== 'fitme-competitor-review-v1' ||
        competitorReview.focal_company !== run.focal.name ||
        competitorReview.baseline_area_id !== run.baseline.area_id ||
        !Array.isArray(competitorReview.locations)) {
      throw new Error('The competitor review does not match this prospect market.');
    }
    for (const competitor of competitorReview.locations) {
      if (!competitor || !['verified', 'possible'].includes(competitor.status) ||
          !['provider', 'address', 'locality', 'overlap'].every(key => typeof competitor[key] === 'string') ||
          !Array.isArray(competitor.sources) || !competitor.sources.length ||
          !competitor.sources.every(source => typeof source === 'string')) {
        throw new Error('The prospect file contains an invalid competitor record.');
      }
      if (!competitor.osm_id) continue;
      if (!ids.has(competitor.osm_id) || competitors.has(competitor.osm_id)) {
        throw new Error('The prospect file contains an invalid competitor worksite link.');
      }
      competitors.set(competitor.osm_id, competitor);
    }
  }
  const linkedRows = rows.map(row => ({ ...row, competitor: competitors.get(row.id) }));
  const byId = new Map(linkedRows.map(row => [row.id, row]));
  // Inventory records enrich supported businesses with source metadata only.
  if (run.inventory !== undefined) {
    if (!Array.isArray(run.inventory)) throw new Error('The run inventory must be an array.');
    const inventoryIds = new Set();
    for (const site of run.inventory) {
      if (!site || typeof site.id !== 'string' || inventoryIds.has(site.id) ||
          typeof site.name !== 'string' || !coords(site.coordinates) ||
          !Number.isFinite(site.distance_meters) || site.distance_meters < 0) {
        throw new Error('The inventory contains an invalid or repeated location.');
      }
      inventoryIds.add(site.id);
      if (byId.has(site.id)) byId.set(site.id, { ...site, ...byId.get(site.id), osm_records: site.osm_records ?? byId.get(site.id).osm_records });
    }
    if (linkedRows.some(site => !inventoryIds.has(site.id))) throw new Error('A matched worksite is missing from the inventory.');
  }
  return { run, rows: [...byId.values()], roles, groups, targets, hasTiers, competitorReview };
}

export function filterRun(rows, { search, band, occupation, radius, tiers = null, competitorStatus = '', groups = null, targets = null }) {
  const query = search.trim().toLowerCase();
  const selected = [];
  for (const row of rows) {
    if (!row.matches.length || row.distance_meters > radius + 0.05 || (query && !row.search.includes(query)) ||
        (tiers && row.matches.length > 0 && !tiers.has(row.transfer_tier)) ||
        (competitorStatus && row.competitor?.status !== competitorStatus)) continue;
    const matches = row.matches.filter(link => (!band || link.role.band === band) &&
      (!occupation || link.uri === occupation) && (!groups || groups.has(link.role.group)) &&
      (!targets || targets.has(link.role.component)));
    if (matches.length) {
      selected.push({ ...row, matches, strong: matches.some(link => link.role.band === 'STRONG') });
    }
  }
  return selected.sort((left, right) => (tiers ? (left.transfer_tier || 9) - (right.transfer_tier || 9) : 0) ||
    Number(right.strong) - Number(left.strong) ||
    left.distance_meters - right.distance_meters || left.id.localeCompare(right.id));
}
export function readGroups(run, roles) {
  if (run.groups !== undefined) {
    if (!Array.isArray(run.groups)) throw new Error('The report groups must be an array.');
    const labels = new Set(), ids = new Set(), members = new Set();
    for (const group of run.groups) {
      if (!group || typeof group.id !== 'string' || !group.id || ids.has(group.id) ||
          typeof group.label !== 'string' || !group.label || labels.has(group.label) || !Array.isArray(group.member_uris)) {
        throw new Error('The run contains an invalid or repeated report group.');
      }
      labels.add(group.label); ids.add(group.id);
      for (const uri of group.member_uris) {
        if (!roles.has(uri) || roles.get(uri).group !== group.label || members.has(uri)) {
          throw new Error('Report group membership does not match the occupation analysis.');
        }
        members.add(uri);
      }
    }
    if (members.size !== roles.size) throw new Error('Some occupations are missing from the report groups.');
    return run.groups.map((group, index) => ({ ...group, number: index + 1 }));
  }
  // Earlier run files keep the exact report group label on each occupation.
  return [...new Set([...roles.values()].map(role => role.group))].sort().map((label, index) => ({
    id: 'group-' + (index + 1), label, number: index + 1,
    member_uris: [...roles].filter(([,role]) => role.group === label).map(([uri]) => uri),
  }));
}

export function groupMatches(matches, groups) {
  const byLabel = new Map();
  for (const link of matches) {
    if (!byLabel.has(link.role.group)) byLabel.set(link.role.group, []);
    byLabel.get(link.role.group).push(link);
  }
  return groups.filter(group => byLabel.has(group.label))
    .map(group => ({ ...group, matches: byLabel.get(group.label) }));
}

export function groupCounts(rows) {
  const counts = new Map();
  for (const row of rows) {
    for (const label of new Set(row.matches.map(link => link.role.group))) counts.set(label, (counts.get(label) || 0) + 1);
  }
  return counts;
}

// Target identities come from the run, never from prefixes in display labels.
export function readTargets(run, roles) {
  if (run.components === undefined) return [];
  if (!Array.isArray(run.components)) throw new Error('The target jobs must be an array.');
  const ids = new Set();
  const targets = run.components.map(component => {
    if (!component || typeof component.id !== 'string' || !component.id || ids.has(component.id) ||
        typeof component.label !== 'string' || !component.label.trim()) {
      throw new Error('The run contains an invalid or repeated target job.');
    }
    ids.add(component.id);
    return { id: component.id, label: component.label };
  });
  if ([...roles.values()].some(role => !ids.has(role.component))) {
    throw new Error('An occupation refers to an unknown target job.');
  }
  return targets;
}

// Count each business once per group, independently of the group's own checkbox.
export function rankedGroups(groups, rows) {
  const counts = groupCounts(rows);
  return groups.map(group => ({ ...group, count: counts.get(group.label) || 0 }))
    .filter(group => group.count > 0)
    .sort((left, right) => right.count - left.count || left.label.localeCompare(right.label) || left.id.localeCompare(right.id));
}
