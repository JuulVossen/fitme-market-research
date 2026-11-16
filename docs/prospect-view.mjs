const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const CATEGORY_KEYS = ['amenity','shop','office','industrial','craft','aeroway','railway','healthcare','leisure','tourism','building','landuse'];
export function osmLink(id) {
  const match = /^osm_(node|way|relation)_(\d+)$/.exec(id || '');
  return match ? 'https://www.openstreetmap.org/' + match[1] + '/' + match[2] : '';
}
function plainTags(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).filter(([,item]) => typeof item === 'string' || typeof item === 'number'));
}
export function renderOsmCard(row, run) {
  const records = Array.isArray(row.osm_records) ? row.osm_records.filter(record => record && osmLink(record.id)).map(record => ({...record,tags:plainTags(record.tags)})) : [];
  const tags = (records.find(record => record.id === row.id) || records[0])?.tags || {};
  const category = CATEGORY_KEYS.filter(key => tags[key]).map(key => key + '=' + tags[key]);
  const fallbackCategory = Array.isArray(row.categories) ? row.categories.join(' · ') : '';
  const pairs = [
    ['Recorded activity / building', category.join(' · ') || fallbackCategory || 'Not included in this saved run'],
    ['Recorded operator / brand', [tags.operator,tags.brand].filter(Boolean).join(' · ') || 'Not supplied'],
    ['Recorded phone', tags['contact:phone'] || tags.phone || row.phone || 'Not supplied'],
    ['Recorded opening hours', tags.opening_hours || 'Not supplied'],
    ['Recorded locality / postcode', [tags['addr:city'],tags['addr:postcode'] || row.postal_code].filter(Boolean).join(' · ') || 'Not supplied'],
    ['Mapped coordinates', Number(row.lat).toFixed(6) + ', ' + Number(row.lon).toFixed(6)],
    ['Imported sector', typeof row.sector === 'string' ? row.sector.replaceAll('_',' ') : 'Not included in this saved run'],
    ['OSM extract date', String(run.baseline.extract_timestamp || '').slice(0,10) || 'Not included in this saved run'],
  ];
  const summary = '<dl class="detail-meta osm-meta">' + pairs.map(([key,value]) => '<div><dt>'+escape(key)+'</dt><dd>'+escape(value)+'</dd></div>').join('') + '</dl>';
  const sources = records.length ? records.map(record => {
    const entries = Object.entries(record.tags).sort(([a],[b]) => a.localeCompare(b));
    return '<details class="osm-source-record"><summary>OSM '+escape(record.id.replace('osm_','').replace('_',' '))+' · '+entries.length+' recorded tags</summary><a class="source-record-link" href="'+osmLink(record.id)+'" target="_blank" rel="noopener">Open source record ↗</a><table class="osm-tags"><thead><tr><th scope="col">OSM key</th><th scope="col">Recorded value</th></tr></thead><tbody>'+entries.map(([key,value])=>'<tr><th scope="row">'+escape(key)+'</th><td>'+escape(value)+'</td></tr>').join('')+'</tbody></table></details>';
  }).join('') : '<p class="field-help">This saved run does not contain the original OSM tags. The available matching evidence is shown with each occupation below.</p>';
  return '<section class="osm-source-card"><h3>OSM location data</h3>'+summary+
    (/^Near\s*\(/.test(row.address || '') ? '<p class="field-help">The source has no street address; the displayed address is a coordinate placeholder.</p>' : '')+
    (records.length > 1 ? '<p class="field-help">'+records.length+' nearby source records were consolidated into this location. Their original tags remain separate below.</p>' : '')+
    sources+'</section>';
}
