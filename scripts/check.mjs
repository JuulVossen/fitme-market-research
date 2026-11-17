import './filter-check.mjs';
import { readFile, readdir, stat } from 'node:fs/promises';
import { resolve, join, dirname, relative, sep } from 'node:path';
import { Script } from 'node:vm';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { readRun } from '../docs/prospect-data.mjs';
const root = fileURLToPath(new URL('../docs/', import.meta.url));
const catalog = JSON.parse(await readFile(join(root,'runs/index.json'),'utf8'));
assert.equal(catalog.schema, 'fitme-run-library-v1');
assert.ok(catalog.runs.length > 0);
const seen = new Set();
for (const entry of catalog.runs) {
  assert.ok(!seen.has(entry.id)); seen.add(entry.id);
  assert.match(entry.id, /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
  assert.equal(entry.file, 'runs/' + entry.id + '.json.gz');
  const bytes = await readFile(join(root,entry.file));
  assert.equal(bytes.length,entry.bytes);
  assert.equal(createHash('sha256').update(bytes).digest('hex'), entry.sha256);
  const source = gunzipSync(bytes).toString('utf8');
  assert.ok(!/C:[\\/]+Users[\\/]/i.test(source), 'User-specific filesystem path in run');
  assert.ok(!/(?:gh[pousr]_[A-Za-z0-9]{30,}|sk-proj-[A-Za-z0-9_-]{30,})/.test(source), 'Potential credential in run');
  const dataset = readRun(JSON.parse(source));
  assert.equal(dataset.rows.length, entry.worksites);
  assert.ok(dataset.hasTiers);
  if (entry.id === 'delta-atlanta-customer-service') {
    assert.equal(dataset.run.focal.radius_meters, 25 * 1609.344);
    assert.equal(entry.radius_meters, dataset.run.focal.radius_meters);
    assert.equal(dataset.targets.length, 3);
    assert.equal(dataset.roles.size, 422);
    assert.equal(new Set([...dataset.roles.values()].map(role => role.esco_uri)).size, 270);
    assert.ok(dataset.rows.every(row => row.distance_meters <= entry.radius_meters + 0.05));
  }
  console.log('PASS', entry.id, dataset.rows.length, 'businesses;', dataset.roles.size, 'occupations;', dataset.groups.length, 'groups');
}
async function checkFiles(dir) {
  for (const item of await readdir(dir,{withFileTypes:true})) {
    const path=join(dir,item.name);
    if(item.isDirectory()) await checkFiles(path);
    else assert.ok((await stat(path)).size < 100*1024*1024, 'File over GitHub limit: ' + path);
  }
}
await checkFiles(root);
async function checkPages(dir) {
  for (const item of await readdir(dir,{withFileTypes:true})) {
    const file=join(dir,item.name);
    if(item.isDirectory()) { await checkPages(file); continue; }
    if(!item.name.endsWith('.html')) continue;
    const html=await readFile(file,'utf8');
    for (const match of html.matchAll(/(?:src|href)="([^"]+)"/g)) {
      const link=match[1];
      if (/^(?:https?:|#|\?)/.test(link)) continue;
      assert.ok(!link.startsWith('/'), 'Root-relative link would break project Pages: ' + link);
      let target=resolve(dirname(file),link.split(/[?#]/)[0]);
      const local=relative(root,target);
      assert.ok(local!=='..' && !local.startsWith('..'+sep), 'Link escapes published site: ' + link);
      if((await stat(target)).isDirectory()) target=join(target,'index.html');
      await stat(target);
    }
    for(const match of html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)) {
      if(match[1].trim()) new Script(match[1],{filename:file});
    }
    console.log('PASS page links and scripts:', relative(root,file));
  }
}
await checkPages(root);
console.log('PASS static links, file sizes and run catalog');
