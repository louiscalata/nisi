// Fault-injection into the optional projection only. Real host/engine with
// original-issued synthetic process observations; no native or model launch.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath,pathToFileURL} from 'node:url';

const root=fileURLToPath(new URL('../',import.meta.url));
function relocated(text,origin,overrides={}) {
  return text.replace(/from '([^']+)'/g,(full,s)=>{
    if(!s.startsWith('.'))return full;
    const absolute=path.resolve(path.dirname(path.join(root,origin)),s);
    return "from '"+(overrides[path.relative(root,absolute)]??pathToFileURL(absolute).href)+"'";
  });
}
test('optional incident projection failure cannot corrupt settled workflow or prior history', {timeout:15000}, async t=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'nisi-incident-isolation-'));
  t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  const stub=path.join(dir,'projection.mjs'),host=path.join(dir,'host.mjs'),fixture=path.join(dir,'fixture.mjs');
  await fs.writeFile(stub,"export function createRepositoryIncidentPreviewV1(){throw Error('DO_NOT_LEAK_INTERNAL_MESSAGE');}\n",{flag:'wx'});
  const source=await fs.readFile(path.join(root,'hosts/repository/reviewed-workflow-v1.mjs'),'utf8');
  assert.equal(source.split('createRepositoryIncidentPreviewV1({bundle,context:incidentContext})').length,2);
  await fs.writeFile(host,relocated(source,'hosts/repository/reviewed-workflow-v1.mjs',{
    'history/repository-incident-candidates-v1.mjs':pathToFileURL(stub).href}),{flag:'wx'});
  const helper=await fs.readFile(path.join(root,'tests/helpers/incident-host-fixture.mjs'),'utf8');
  await fs.writeFile(fixture,relocated(helper,'tests/helpers/incident-host-fixture.mjs',{
    'hosts/repository/reviewed-workflow-v1.mjs':pathToFileURL(host).href}),{flag:'wx'});
  const {createIncidentHostFixture}=await import(pathToFileURL(fixture).href);
  const f=await createIncidentHostFixture(t),report=await f.host.run(f.options),settled=await f.host.settled();
  assert.equal(report.outcome,'COMPLETED');assert.equal(settled.state,'SETTLED');
  assert.equal(settled.report,report);assert.equal(settled.bundleError,null);assert.notEqual(settled.proposedChanges,null);
  assert.equal(settled.bundleSummary.status,'CONSISTENT');assert.equal(f.host.historyPreview().status,'PREVIEW');
  const p=f.host.incidentPreview();assert.equal(p.status,'REFUSED');assert.equal(p.reason,'INVALID_EVIDENCE');
  assert.deepEqual(p.rows,[]);assert.equal(p.sha256,null);assert(!JSON.stringify(p).includes('DO_NOT_LEAK'));
});
