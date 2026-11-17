import { initializeLibrary, readRunBlob } from './hosted-runs.mjs';
import { TalentMap } from './map.js';
import { readRun, filterRun, groupMatches, rankedGroups, targetCounts } from './prospect-data.mjs';
import { renderOsmCard } from './prospect-view.mjs';

const $ = selector => document.querySelector(selector);
const format = value => new Intl.NumberFormat('en-US').format(value);
const MILE = 1609.344;
const PAGE_SIZE = 25;
const TIER_COLORS = { 1: '#176b58', 2: '#405f96', 3: '#8d602b', 4: '#725d74' };
const PALETTE = ['#287b61','#ab7736','#456fa3','#945d7d','#788340','#328c96','#a25540','#7763a4','#397456','#997c20','#6a7695','#b05f7c','#567f84','#795b3e'];
const bandName = band => band === 'STRONG' ? 'Strong' : 'Conditional';
const distance = meters => new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(meters / MILE) + ' mi';
const escape = value => String(value ?? '').replace(/[&<>"']/g, char =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);

let dataset, map, groups = [], availableGroups = [], enabledGroups = new Set(), enabledTargets = new Set(), selected = [], visible = new Map(), page = 0, mode = 'clusters';

function safeUrl(value) {
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) ? url.href : '';
  } catch {
    return '';
  }
}

function status(message) {
  $('#status').textContent = message;
  $('#status').hidden = !message;
}

function bandBadge(band) {
  return '<span class="band prospect-band-label ' + band.toLowerCase() + '">' + bandName(band) + '</span>';
}

function tierBadge(tier) {
  return '<span class="prospect-tier-badge" style="--tier-color:' + TIER_COLORS[tier] + '">Tier ' + tier + '</span>';
}

function showMapKey() {
  const byTier = $('#map-colour').value === 'tiers' && dataset?.hasTiers;
  const messages = {
    clusters: 'Cluster size shows the location count. Colour shows the most frequent ' + (byTier ? 'transfer tier' : 'ESCO report group') + '.',
    locations: 'Click a location to open its card. Colour shows ' + (byTier ? 'its transfer tier' : 'the first supported report group; its card lists all groups') + '.',
    breadth: 'Each cell shows the number of distinct ESCO report groups in the visible locations.',
  };
  $('#map-key-copy').textContent = messages[mode];
}

function groupBadge(group) {
  return '<span class="report-group-badge" style="--group-colour:' + group.color + '"><span class="group-dot"></span>' + escape(group.label) + '</span>';
}

function showGroupFilters(available) {
  const container = $('#group-choices');
  const focused = document.activeElement?.dataset.reportGroup;
  const scrollTop = container.scrollTop;
  const markup = available.map(group => '<label class="report-group-choice"><input type="checkbox" data-report-group="' + escape(group.id) + '"' + (enabledGroups.has(group.id) ? ' checked' : '') + '><span class="group-dot" style="--group-colour:' + group.color + '"></span><span>' + escape(group.label) + '</span><span class="group-count">' + format(group.count) + '</span></label>').join('') ||
    '<p class="field-help">' + (dataset.targets.length > 1 && !enabledTargets.size ? 'Select at least one target job to show its groups.' : 'No groups have businesses matching these filters.') + '</p>';
  if (container.innerHTML !== markup) {
    container.innerHTML = markup;
    if (focused) [...container.querySelectorAll('[data-report-group]')].find(control => control.dataset.reportGroup === focused)?.focus({ preventScroll: true });
    container.scrollTop = scrollTop;
  }
  $('#groups-all').disabled = $('#groups-none').disabled = available.length === 0;
}

function selectedGroups() {
  return enabledGroups.size === groups.length ? null : new Set(groups.filter(group => enabledGroups.has(group.id)).map(group => group.label));
}

function showTargetFilters() {
  $('#target-options').hidden = dataset.targets.length < 2;
  $('#target-choices').innerHTML = dataset.targets.map(target => '<label class="target-job-choice"><input type="checkbox" data-target-job="' + escape(target.id) + '"' + (enabledTargets.has(target.id) ? ' checked' : '') + '><span>' + escape(target.label) + '</span><span class="group-count target-count" data-target-count="' + escape(target.id) + '" aria-label="0 businesses">0</span></label>').join('');
}

function showOccupationChoices() {
  const choices = $('#occupation');
  const previous = choices.value;
  choices.replaceChildren(new Option('All source occupations', ''));
  for (const [uri, role] of [...dataset.roles].sort((a, b) => a[1].label.localeCompare(b[1].label))) {
    if (dataset.targets.length < 2 || enabledTargets.has(role.component)) choices.add(new Option(role.label + ' · ' + bandName(role.band), uri));
  }
  if ([...choices.options].some(option => option.value === previous)) choices.value = previous;
}

function showTierFilters(run) {
  $('#tier-options').hidden = !dataset.hasTiers;
  $('#tier-column').hidden = !dataset.hasTiers;
  $('#ranking-description').textContent = dataset.hasTiers
    ? 'Ranked by the reviewed worksite tier, then visible transfer band and distance.'
    : 'Ranked by strongest visible pathway, then distance.';
  $('#tier-choices').innerHTML = dataset.hasTiers ? [1, 2, 3, 4].map(tier =>
    '<label class="prospect-tier-choice"><input type="checkbox" data-transfer-tier="' + tier + '" checked>' +
    '<span>' + tierBadge(tier) + '<small>' + escape(run.transfer_review.tiers[tier]) + '</small></span></label>'
  ).join('') : '';
}

function competitorBadge(entry) {
  const verified = entry.status === 'verified';
  return '<span class="competitor-badge ' + (verified ? 'verified' : 'possible') + '">' +
    (verified ? 'Potential competitor' : 'Check location') + '</span>';
}

function publicSources(entry) {
  return entry.sources.map((source, index) => {
    const href = safeUrl(source);
    return href ? '<a href="' + escape(href) + '" target="_blank" rel="noopener">Source ' + (index + 1) + '</a>' : '';
  }).filter(Boolean).join(' · ');
}

function showCompetitors() {
  const review = dataset.competitorReview;
  $('#competitor-nav').hidden = !review;
  $('#competitors').hidden = !review;
  $('#competitor-filter-field').hidden = !review;
  $('#competitor-filter').value = '';
  if (!review) return;
  const verified = review.locations.filter(row => row.status === 'verified');
  const mapped = verified.filter(row => row.osm_id);
  $('#competitor-market').textContent = review.market;
  $('#competitor-coverage').textContent = format(verified.length) + ' potential competitor offices · ' +
    format(mapped.length) + ' linked to map prospects · Reviewed ' + review.checked_on +
    '. Selected offices from the current research.';
  const sites = new Map(dataset.rows.map(site => [site.id, site]));
  $('#competitor-table').innerHTML = review.locations.map(row => {
    const site = sites.get(row.osm_id);
    const tier = site?.transfer_tier;
    return '<tr><td><strong>' + escape(row.provider) + '</strong><span class="business-address">' +
      escape(row.address) + ', ' + escape(row.locality) + '</span></td><td>' + competitorBadge(row) +
      '</td><td>' + (tier ? tierBadge(tier) : '—') + '</td><td><span>' + escape(row.overlap) +
      '</span><span class="competitor-sources">' + publicSources(row) + '</span></td><td>' +
      (site ? '<button type="button" class="button ghost small" data-competitor-site="' + escape(site.id) +
        '" aria-label="Show ' + escape(row.provider + ' ' + row.address) + ' on map">Show on map</button>' :
        '<span class="muted">Directory only</span>') + '</td></tr>';
  }).join('');
}

function showCoverage(run) {
  const coverage = run.coverage;
  $('#coverage-note').textContent = format(dataset.rows.length) + ' businesses with supported occupation pathways from the saved run.' +
    (run.baseline.bbox_covers_radius ? '' : ' The run extends beyond the baseline coverage.');
  const list = (title, values) => Array.isArray(values) && values.length
    ? '<p><strong>' + title + '</strong></p><ul>' + values.map(value => '<li>' + escape(value) + '</li>').join('') + '</ul>'
    : '';
  $('#coverage-detail').innerHTML =
    '<p>' + format(coverage.occupations_with_leads) + ' of ' + format(dataset.roles.size) + ' source occupations have local leads.</p>' +
    list('No OSM crosswalk rule', coverage.unmapped_occupations) +
    list('Rule available, no local matches', coverage.mapped_occupations_without_local_leads);
}

function openRun(run) {
  const next = readRun(run);
  $('#empty-state').hidden = true;
  $('#close-run').hidden = false;
  if (map) {
    map.destroy();
    $('#map').replaceChildren();
  }
  dataset = next;
  groups = dataset.groups.map(group => ({ ...group, color: PALETTE[(group.number - 1) % PALETTE.length] }));
  enabledGroups = new Set(groups.map(group => group.id));
  enabledTargets = new Set(dataset.targets.map(target => target.id));
  showTargetFilters();
  $('#map-colour').value = 'groups';
  $('#map-colour').querySelector('[value="tiers"]').disabled = !dataset.hasTiers;
  const company = run.focal;
  const center = [company.coordinates[1], company.coordinates[0]];
  $('#company').textContent = company.name;
  $('#run-description').textContent = run.target.label + ' · ' + format(next.rows.length) + ' businesses with supported occupation pathways.';
  $('#run-radius').textContent = distance(company.radius_meters) + ' research radius';
  const date = String(run.baseline.refreshed_at || '').slice(0, 10);
  $('#run-date').textContent = date ? 'Geofabrik baseline · ' + date : 'Geofabrik baseline';
  $('#prospect-content').hidden = false;
  $('#occupation').value = '';
  showOccupationChoices();
  $('#search').value = '';
  $('#band').value = '';
  $('#radius').value = '1000';
  map = new TalentMap('map', {
    center, coverageRadiusMiles: company.radius_meters / MILE,
    maxBounds: null, minZoom: 3, company: { name: company.name, address: company.address }, groups,
    priorityColors: null,
    onSelectBusiness: row => details(row.id),
  });
  showTierFilters(run);
  showCompetitors();
  showCoverage(run);
  showMapKey();
  map.setMode(mode);
  update();
  map.fit();
}

function update() {
  if (!dataset || !map) return;
  const maximum = dataset.run.focal.radius_meters;
  const radius = maximum * Number($('#radius').value) / 1000;
  const tiers = dataset.hasTiers ? new Set([...document.querySelectorAll('[data-transfer-tier]:checked')]
    .map(control => Number(control.dataset.transferTier))) : null;
  const baseFilters = {
    search: $('#search').value, band: $('#band').value, occupation: $('#occupation').value, radius, tiers, competitorStatus: $('#competitor-filter').value,
    targets: dataset.targets.length > 1 ? enabledTargets : null,
  };
  if (dataset.targets.length > 1) {
    const counts = targetCounts(dataset.rows, baseFilters);
    for (const counter of document.querySelectorAll('[data-target-count]')) {
      const count = counts.get(counter.dataset.targetCount) || 0;
      counter.textContent = format(count);
      counter.setAttribute('aria-label', format(count) + (count === 1 ? ' business' : ' businesses'));
    }
  }
  const beforeGroups = filterRun(dataset.rows, baseFilters);
  availableGroups = rankedGroups(groups, beforeGroups);
  showGroupFilters(availableGroups);
  selected = filterRun(beforeGroups, { ...baseFilters, groups: selectedGroups() });
  visible = new Map(selected.map(row => [row.id, row]));
  const plotted = selected.map(row => ({
    ...row,
    activeGroups: groupMatches(row.matches, groups).map(group => group.number),
  }));
  map.setCatchment(map.origin, radius / MILE, dataset.run.focal.name);
  map.setRecords(plotted);
  $('#radius-label').textContent = distance(radius);
  $('#metric-sites').textContent = format(selected.length);
  $('#metric-priority-label').textContent = dataset.hasTiers ? 'Tier 1–2 businesses' : 'With a Strong pathway';
  $('#metric-strong').textContent = format(selected.filter(row => dataset.hasTiers ? row.transfer_tier <= 2 : row.strong).length);
  $('#metric-roles').textContent = format(new Set(selected.flatMap(row => row.matches.map(link => link.role.group))).size);
  $('#business-count').textContent = format(selected.length);
  $('#export').disabled = !selected.some(row => row.matches.length);
  page = 0;
  renderTable();
}

function renderTable() {
  const start = page * PAGE_SIZE;
  const matches = selected.slice(start, start + PAGE_SIZE);
  $('#business-table').innerHTML = matches.length ? matches.map(row => {
    const categories = groupMatches(row.matches, groups);
    const names = categories.map(groupBadge);
    const location = [row.address, row.city, row.state].filter(Boolean).map(escape).join(', ');
    return '<tr><td><button class="business-name" data-site="' + escape(row.id) + '">' + escape(row.name) +
      '</button><span class="business-address">' + location + '</span>' +
      (row.competitor ? competitorBadge(row.competitor) : '') + '</td><td>' +
      '<div class="company-groups">' + names.join('') + '</div>' +
      '</td>' + (dataset.hasTiers ? '<td>' + (row.transfer_tier ? tierBadge(row.transfer_tier) : '—') + '</td>' : '') +
      '<td>' + bandBadge(row.strong ? 'STRONG' : 'CONDITIONAL') +
      '</td><td>' + distance(row.distance_meters) + '</td></tr>';
  }).join('') : '<tr><td colspan="' + (dataset.hasTiers ? 5 : 4) + '" class="empty-table">No worksites match your filters.</td></tr>';
  $('#table-range').textContent = matches.length ? format(start + 1) + '–' +
    format(start + matches.length) + ' of ' + format(selected.length) + ' worksites' : '0 worksites';
  $('#previous').disabled = page === 0;
  $('#next').disabled = start + PAGE_SIZE >= selected.length;
}

function details(id) {
  const row = visible.get(id);
  if (!row) return;
  const osm = /^osm_(node|way|relation)_(\d+)$/.exec(row.id);
  const siteUrl = safeUrl(row.website);
  const osmUrl = osm ? 'https://www.openstreetmap.org/' + osm[1] + '/' + osm[2] : '';
  const linked = (url, label) => url ? '<a class="button ghost small" href="' + escape(url) +
    '" target="_blank" rel="noopener">' + label + '</a>' : '';
  const occupationMarkup = link => {
    const role = link.role;
    const prompts = Array.isArray(role.candidate_evidence) && role.candidate_evidence.length
      ? '<h4>Candidate evidence prompts</h4><ul>' + role.candidate_evidence.map(prompt => '<li>' + escape(prompt) + '</li>').join('') + '</ul>'
      : '';
    return '<details class="occupation"><summary><span>' + escape(role.label) + '</span>' + bandBadge(role.band) +
      '</summary><div class="occupation-body">' +
      (dataset.hasTiers ? '<p>' + tierBadge(link.transfer_tier) + ' ' + escape(link.tier_reason) + '</p>' : '') +
      '<p><strong>OSM evidence</strong> ' + escape(link.osm_evidence) +
      '</p><p><strong>Matching rule</strong> ' + escape(link.crosswalk_rules) +
      '</p><p><strong>ESCO group</strong> ' + escape(role.group) +
      '</p><p><strong>Taxonomy similarity</strong> ' + role.score.toFixed(2) + ' / 100</p><p>' +
      escape(role.rationale) + '</p>' + (role.context_limit ? '<p><strong>Transfer conditions</strong> ' +
        escape(role.context_limit) + '</p>' : '') + prompts + linked(safeUrl(link.uri), 'ESCO occupation ↗') +
      '</div></details>';
  };
  const categories = groupMatches(row.matches, groups);
  const groupedEvidence = categories.map(group => '<details class="location-group"><summary>' + groupBadge(group) + '<span class="group-role-count">' + format(group.matches.length) + (group.matches.length === 1 ? ' linked job' : ' linked jobs') + '</span></summary><div class="location-group-body">' + (group.summary ? '<p>' + escape(group.summary) + '</p>' : '') + (group.grouping_basis ? '<p class="muted">' + escape(group.grouping_basis) + '</p>' : '') + group.matches.map(occupationMarkup).join('') + '</div></details>').join('');
  $('#dialog-body').innerHTML = '<h2 id="detail-title">' + escape(row.name) + '</h2><p class="muted">' +
    [row.address, row.city, row.state].filter(Boolean).map(escape).join(', ') + ' · ' + distance(row.distance_meters) +
    '</p><div class="detail-actions">' + linked(siteUrl, 'Business website ↗') + linked(osmUrl, 'OSM record ↗') +
    '<button id="locate" class="button secondary small" type="button">Locate on map</button></div>' +
    (dataset.hasTiers && row.transfer_tier ? '<p>' + tierBadge(row.transfer_tier) + ' ' + escape(dataset.run.transfer_review.tiers[row.transfer_tier]) +
      '. The worksite tier uses the best reviewed role across this worksite.</p>' : '') +
    (row.competitor ? '<section class="competitor-evidence"><h3>Competitor evidence</h3>' +
      competitorBadge(row.competitor) + '<p>' + escape(row.competitor.overlap) + '</p><p>' +
      publicSources(row.competitor) + '</p></section>' : '') +
    '<p class="muted">' + 'The worksite category supports these potential occupation pathways. ' + 'Current operations, employment and vacancies are unverified.</p>' +
    '<section class="location-groups"><h3>ESCO report groups</h3>' + groupedEvidence + '</section>' + renderOsmCard(row, dataset.run);
  $('#locate').addEventListener('click', () => {
    $('#detail-dialog').close();
    $('#map').scrollIntoView({ block: 'center' });
    map.focus(row);
  });
  if (!$('#detail-dialog').open) $('#detail-dialog').showModal();
  $('#detail-dialog').scrollTop = 0;
  $('#close-dialog').focus();
}

function download(name, body, type) {
  const url = URL.createObjectURL(new Blob([body], { type }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const csvCell = value => {
  const text = String(value ?? '');
  const safe = /^[\s]*[=+@-]/.test(text) && !Number.isFinite(value) ? "'" + text : text;
  return '"' + safe.replaceAll('"', '""') + '"';
};

function exportMatches() {
  const rows = [['osm_id', 'business', 'address', 'city', 'state', 'website', 'longitude', 'latitude',
    'distance_meters', 'esco_uri', 'occupation', 'band', 'taxonomy_score', 'reporting_group', 'osm_evidence', 'crosswalk_rules', 'worksite_tier', 'occupation_tier', 'tier_rule', 'tier_reason', 'competitor_status']];
  for (const row of selected) {
    for (const link of row.matches) {
      rows.push([row.id, row.name, row.address, row.city, row.state, row.website, row.lon, row.lat, row.distance_meters,
        link.uri, link.role.label, link.role.band, link.role.score, link.role.group, link.osm_evidence, link.crosswalk_rules,
        row.transfer_tier, link.transfer_tier, link.tier_rule, link.tier_reason, row.competitor?.status]);
    }
  }
  download('prospect-occupation-links.csv', '\uFEFF' + rows.map(row => row.map(csvCell).join(',')).join('\r\n'), 'text/csv;charset=utf-8');
}

$('#empty-open').addEventListener('click', () => $('#run-file').click());
$('#close-run').addEventListener('click', () => { window.location.href = new URL('./', window.location.href).href; });
$('#open-run').addEventListener('click', () => $('#run-file').click());
$('#run-file').addEventListener('change', async event => {
  const file = event.target.files[0];
  event.target.value = '';
  if (!file) return;
  try {
    openRun(await readRunBlob(file));
    const localUrl = new URL(window.location.href);
    localUrl.searchParams.delete('run');
    history.replaceState(null, '', localUrl);
    status('Opened ' + file.name + ' in this browser.');
  } catch (error) {
    status(error.message);
  }
});
$('#download-run').addEventListener('click', () => download('prospect_map.json', JSON.stringify(dataset.run), 'application/json'));
$('#export').addEventListener('click', exportMatches);
$('#fit-map').addEventListener('click', () => map?.fit());
$('#close-dialog').addEventListener('click', () => $('#detail-dialog').close());
$('#business-table').addEventListener('click', event => {
  const control = event.target.closest('[data-site]');
  if (control) details(control.dataset.site);
});
$('#previous').addEventListener('click', () => { page--; renderTable(); });
$('#next').addEventListener('click', () => { page++; renderTable(); });
$('#tier-options').addEventListener('change', update);
$('#group-choices').addEventListener('change', event => {
  const id = event.target.dataset.reportGroup;
  if (!id) return;
  if (event.target.checked) enabledGroups.add(id); else enabledGroups.delete(id);
  update();
});
$('#target-choices').addEventListener('change', event => {
  const id = event.target.dataset.targetJob;
  if (!id) return;
  if (event.target.checked) enabledTargets.add(id); else enabledTargets.delete(id);
  showOccupationChoices();
  update();
});
for (const id of ['groups-all','groups-none']) $('#' + id).addEventListener('click', () => {
  for (const group of availableGroups) {
    if (id === 'groups-all') enabledGroups.add(group.id); else enabledGroups.delete(group.id);
  }
  update();
});
$('#map-colour').addEventListener('change', () => {
  map?.setPriorityColors($('#map-colour').value === 'tiers' && dataset?.hasTiers ? TIER_COLORS : null);
  showMapKey();
});
function openCompetitor(event) {
  const button = event.target.closest('[data-competitor-site]');
  if (!button) return;
  resetFilters();
  const site = visible.get(button.dataset.competitorSite);
  if (site) {
    $('#map').scrollIntoView({ block: 'center' });
    map.focus(site);
    details(site.id);
  }
}

function exportCompetitors() {
  const tiers = new Map(dataset.rows.map(row => [row.id, row.transfer_tier]));
  const rows = [['provider','address','locality','status','worksite_tier','osm_id','overlap','sources']];
  for (const row of dataset.competitorReview.locations) {
    rows.push([row.provider, row.address, row.locality, row.status, tiers.get(row.osm_id),
      row.osm_id, row.overlap, row.sources.join(' | ')]);
  }
  download('competitors.csv', '\uFEFF' + rows.map(row => row.map(csvCell).join(',')).join('\r\n'), 'text/csv;charset=utf-8');
}

function resetFilters() {
  for (const control of document.querySelectorAll('[data-transfer-tier]')) control.checked = true;
  enabledGroups = new Set(groups.map(group => group.id));
  enabledTargets = new Set(dataset.targets.map(target => target.id));
  showTargetFilters();
  showOccupationChoices();
  for (const selector of ['#search', '#band', '#occupation', '#competitor-filter']) $(selector).value = '';
  $('#radius').value = '1000';
  update();
}

$('#reset').addEventListener('click', resetFilters);
$('#competitor-table').addEventListener('click', openCompetitor);
$('#export-competitors').addEventListener('click', exportCompetitors);
$('#competitor-filter').addEventListener('change', update);
for (const selector of ['#search', '#band', '#occupation', '#radius']) {
  $(selector).addEventListener(selector === '#band' || selector === '#occupation' ? 'change' : 'input', update);
}
for (const button of document.querySelectorAll('[data-mode]')) {
  button.addEventListener('click', () => {
    mode = button.dataset.mode;
    map?.setMode(mode);
    for (const control of document.querySelectorAll('[data-mode]')) {
      const active = control === button;
      control.classList.toggle('active', active);
      control.setAttribute('aria-pressed', String(active));
    }
    showMapKey();
  });
}

$('#export-locations').addEventListener('click', () => {
  const rows = [['id','name','address','city','state','website','longitude','latitude','distance_meters','transfer_tier','report_groups','matched_occupations']];
  for (const row of selected) rows.push([row.id,row.name,row.address,row.city,row.state,row.website,row.lon,row.lat,row.distance_meters,row.transfer_tier,groupMatches(row.matches,groups).map(group=>group.label).join(' | '),row.matches.map(link => link.role.label).join(' | ')]);
  download('supported-businesses.csv', '\uFEFF' + rows.map(row => row.map(csvCell).join(',')).join('\r\n'), 'text/csv;charset=utf-8');
});

initializeLibrary({ openRun, status });
