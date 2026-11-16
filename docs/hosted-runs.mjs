const $ = selector => document.querySelector(selector);
const count = value => new Intl.NumberFormat('en-US').format(value);
const escape = value => String(value ?? '').replace(/[&<>"']/g, char =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);

export async function readRunBlob(blob) {
  const signature = new Uint8Array(await blob.slice(0, 2).arrayBuffer());
  if (signature[0] === 31 && signature[1] === 139) {
    if (!globalThis.DecompressionStream) {
      throw new Error('This browser cannot open compressed runs. Download the file, decompress it, then open the JSON file here.');
    }
    return new Response(blob.stream().pipeThrough(new DecompressionStream('gzip'))).json();
  }
  return JSON.parse(await blob.text());
}

function validateCatalog(catalog) {
  if (catalog?.schema !== 'fitme-run-library-v1' || !Array.isArray(catalog.runs)) {
    throw new Error('The research library is unavailable. You can still open a local file.');
  }
  const ids = new Set();
  for (const run of catalog.runs) {
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(run.id) || ids.has(run.id) ||
        run.file !== 'runs/' + run.id + '.json.gz' || !Number.isFinite(run.worksites) ||
        !Number.isFinite(run.bytes) || !['title','occupation','region','description'].every(key => typeof run[key] === 'string')) {
      throw new Error('The research library contains an invalid entry.');
    }
    ids.add(run.id);
  }
  return catalog.runs;
}

export async function initializeLibrary({ openRun, status }) {
  const selectedId = new URL(window.location.href).searchParams.get('run');
  try {
    const response = await fetch(new URL('runs/index.json', import.meta.url));
    if (!response.ok) throw new Error('The research library could not be loaded (' + response.status + '). You can still open a local file.');
    const runs = validateCatalog(await response.json());
    $('#library-count').textContent = runs.length + ' completed research runs';
    $('#run-cards').innerHTML = runs.map((run, index) => {
      const downloadSize = (run.bytes / 1024 / 1024).toFixed(1) + ' MB';
      return '<article class="run-card"><div class="run-card-top"><span class="run-number">0' + (index + 1) +
        '</span><span class="run-region">' + escape(run.region) + '</span></div><h3>' + escape(run.title) +
        '</h3><p class="run-role">' + escape(run.occupation) + '</p><p class="run-summary">' + escape(run.description) +
        '</p><div class="run-stat"><strong>' + count(run.worksites) + '</strong><span>supported businesses</span></div>' +
        '<div class="run-meta"><span>25-mile radius</span><span>Baseline ' + escape(run.baseline_date) + '</span></div>' +
        '<div class="run-card-actions"><a class="button primary" href="?run=' + encodeURIComponent(run.id) +
        '">Open map <span aria-hidden="true">↗</span></a><a class="run-download" href="' + escape(run.file) +
        '" download>Download run <small>.json.gz · ' + downloadSize + '</small></a></div></article>';
    }).join('');
    if (!selectedId) return;
    const entry = runs.find(run => run.id === selectedId);
    if (!entry) throw new Error('That research run was not found. Choose a run from the library.');
    status('Loading ' + entry.title + ' (' + (entry.bytes / 1024 / 1024).toFixed(1) + ' MB)…');
    const result = await fetch(new URL(entry.file, import.meta.url));
    if (!result.ok) throw new Error('The selected run could not be downloaded (' + result.status + '). Please try again.');
    const blob = await result.blob();
    status('Preparing ' + count(entry.worksites) + ' businesses for the map…');
    await new Promise(resolve => setTimeout(resolve, 30));
    const run = await readRunBlob(blob);
    await new Promise(resolve => setTimeout(resolve, 30));
    openRun(run);
    document.title = entry.title + ' | Fitme Market Research';
    status('Opened ' + entry.title + '.');
  } catch (error) {
    $('#library-count').textContent = 'Research library';
    status(error.message || 'The run could not be opened.');
  }
}
