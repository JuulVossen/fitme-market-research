import assert from 'node:assert/strict';
import { readRun, filterRun, rankedGroups, targetCounts } from '../docs/prospect-data.mjs';

const role = (group, component) => ({ label: group, group, component, band: 'STRONG', score: 42 });
const roles = { a: role('Airport service', 'airport'), a2: role('Airport service', 'airport'), b: role('Reservations', 'reservations'), c: role('Customer care', 'care'), d: role('Empty group', 'care') };
const groups = [
  { id: 'a', label: 'Airport service', member_uris: ['a', 'a2'] },
  { id: 'b', label: 'Reservations', member_uris: ['b'] },
  { id: 'c', label: 'Customer care', member_uris: ['c'] },
  { id: 'd', label: 'Empty group', member_uris: ['d'] },
];
const site = (id, tier, uris, distance) => ({ id, name: 'Business ' + id, coordinates: [-84, 33], distance_meters: distance, transfer_tier: tier,
  links: uris.map(uri => ({ uri, transfer_tier: tier, osm_evidence: 'office=company', crosswalk_rules: 'fixture', tier_reason: 'Reviewed fixture', tier_rule: 'fixture' })) });
const input = { schema: 'fitme-prospect-map-v1', focal: { name: 'Test', coordinates: [-84, 33], radius_meters: 100 }, target: { label: 'Test targets' }, baseline: { source: 'osm_geofabrik_pbf' }, coverage: {}, occupations: roles, groups,
  components: ['airport', 'reservations', 'care'].map(id => ({ id, label: id })),
  transfer_review: { tiers: {1: 'One', 2: 'Two', 3: 'Three', 4: 'Four'} },
  worksites: [site('1', 1, ['a', 'a2', 'b'], 10), site('2', 2, ['b', 'c'], 20), site('3', 2, ['b'], 30), site('4', 1, ['a'], 40), site('5', 2, ['b'], 50)] };
const dataset = readRun(input);
const base = { search: '', band: '', occupation: '', radius: 100, tiers: new Set([1, 2, 3, 4]) };
const filtered = options => filterRun(dataset.rows, { ...base, ...options });
const ranked = options => rankedGroups(dataset.groups, filtered(options)).map(g => [g.id, g.count]);
assert.deepEqual(ranked({}), [['b', 4], ['a', 2], ['c', 1]], 'largest groups first; duplicate occupations at a business count once; empty groups hidden');
assert.deepEqual(ranked({ tiers: new Set([1]) }), [['a', 2], ['b', 1]], 'tier changes reorder groups');
assert.deepEqual(ranked({ tiers: new Set([2]) }), [['b', 3], ['c', 1]], 'groups without businesses in a selected tier disappear');
assert.deepEqual(ranked({ tiers: new Set([4]) }), [], 'empty tier has no groups');
assert.deepEqual(ranked({ tiers: new Set() }), [], 'no selected tiers means no groups');
assert.deepEqual(ranked({ targets: new Set(['airport']) }), [['a', 2]], 'single target');
assert.deepEqual(ranked({ targets: new Set(['airport', 'care']) }), [['a', 2], ['c', 1]], 'multiple simultaneous targets');
assert.deepEqual(ranked({ targets: new Set() }), [], 'no selected targets means no matches');
assert.deepEqual(ranked({ radius: 20 }), [['b', 2], ['a', 1], ['c', 1]], 'radius changes counts');
assert.deepEqual(ranked({ search: 'Business 4' }), [['a', 1]], 'search changes counts');
assert.deepEqual(ranked({ occupation: 'a2' }), [['a', 1]], 'source occupation changes counts');
assert.deepEqual(ranked({ band: 'CONDITIONAL' }), [], 'band changes counts');
const targetRows = filtered({ targets: new Set(['reservations']) });
assert.ok(targetRows.every(row => row.matches.every(link => link.role.component === 'reservations')));
assert.equal(targetRows.find(row => row.id === '1').transfer_tier, 1, 'worksite priority remains its reviewed tier');
const beforeGroups = filtered({});
const onlyAirport = filterRun(beforeGroups, { ...base, groups: new Set(['Airport service']) });
assert.equal(onlyAirport.length, 2);
assert.deepEqual(rankedGroups(dataset.groups, beforeGroups).map(g => [g.id, g.count]), [['b', 4], ['a', 2], ['c', 1]], 'group facets remain available when unchecked');
assert.equal(filterRun(beforeGroups, { ...base, groups: new Set() }).length, 0);
assert.deepEqual(dataset.targets.map(t => t.id), ['airport', 'reservations', 'care']);
assert.deepEqual(dataset.groups.map(g => g.number), [1, 2, 3, 4], 'ranking must not mutate group identity or colours');
const legacy = structuredClone(input); delete legacy.components; delete legacy.groups;
for (const r of Object.values(legacy.occupations)) delete r.component;
assert.deepEqual(readRun(legacy).targets, [], 'existing single-target runs need no new metadata');
const invalid = structuredClone(input); invalid.components.push(invalid.components[0]);
assert.throws(() => readRun(invalid), /repeated target/);
const unknown = structuredClone(input); unknown.occupations.a.component = 'unknown';
assert.throws(() => readRun(unknown), /unknown target/);
console.log('PASS tier-aware group counts, sorting, empty groups, multiple target jobs, radius/search/band/occupation filters and legacy runs');

const targetTotals = options => {
  const counts = targetCounts(dataset.rows, { ...base, ...options });
  return dataset.targets.map(target => [target.id, counts.get(target.id) || 0]);
};
assert.deepEqual(targetTotals({}), [['airport', 2], ['reservations', 4], ['care', 1]], 'count businesses once per target even with multiple occupations');
assert.deepEqual(targetTotals({ tiers: new Set([1]) }), [['airport', 2], ['reservations', 1], ['care', 0]], 'target counts follow selected worksite tiers');
assert.deepEqual(targetTotals({ tiers: new Set([2]) }), [['airport', 0], ['reservations', 3], ['care', 1]]);
assert.deepEqual(targetTotals({ tiers: new Set() }), [['airport', 0], ['reservations', 0], ['care', 0]], 'no selected tiers shows zero for every target');
assert.deepEqual(targetTotals({ tiers: new Set([4]) }), [['airport', 0], ['reservations', 0], ['care', 0]], 'empty selected tier shows zero');
assert.deepEqual(targetTotals({ targets: new Set(), groups: new Set() }), targetTotals({}), 'unchecked targets and groups retain comparable available counts');
assert.deepEqual(targetTotals({ radius: 20 }), [['airport', 1], ['reservations', 2], ['care', 1]], 'target counts follow radius');
assert.deepEqual(targetTotals({ search: 'Business 4' }), [['airport', 1], ['reservations', 0], ['care', 0]], 'target counts follow search');
assert.deepEqual(targetTotals({ band: 'CONDITIONAL' }), [['airport', 0], ['reservations', 0], ['care', 0]], 'target counts follow transfer band');
assert.deepEqual(targetTotals({ occupation: 'a2' }), [['airport', 1], ['reservations', 0], ['care', 0]], 'target counts follow source occupation');
const differentGroups = structuredClone(dataset.rows);
differentGroups[0].matches.find(link => link.uri === 'a2').role.group = 'Other airport group';
assert.equal(targetCounts(differentGroups, base).get('airport'), 2, 'multiple report groups at the same business do not inflate its target count');
console.log('PASS distinct-business target counts, tier changes, empty states, unchecked targets/groups and other filters');
