import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
// These assertions retain the original C06/C07 controls and historical fixtures.
// Current versioned baseline qualification has separate additive coverage.
import { assertC07Acceptance, C07_EVIDENCE, C07_SOURCE_HASHES } from '../work-orders/v02-finish-cluster-v1/c07-baseline-v3/history/check-c07.mjs';
import { assertC06Acceptance } from '../work-orders/v02-finish-cluster-v1/c07-baseline-v3/history/check-c06.mjs';

// Intended canonical location is tests/finish-cluster-c07.test.mjs. The
// conditional keeps this private draft runnable only if the owner elects to
// inspect it before staging; the canonical form resolves tests/ -> repository.
const HERE = path.dirname(fileURLToPath(import.meta.url));
const SOURCE_ROOT = path.resolve(HERE, '..');
const CLUSTER = 'work-orders/v02-finish-cluster-v1/cluster.json';
const HISTORY = 'work-orders/v02-finish-cluster-v1/c07-baseline-v3/history';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');

function read(root, file) { return JSON.parse(fs.readFileSync(path.join(root, file))); }
function write(root, file, value) {
  const target = path.join(root, file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, `${JSON.stringify(value, null, 2)}\n`);
}
function copy(root, file) {
  assert(!path.isAbsolute(file) && !file.split('/').includes('..'), `fixture path: ${file}`);
  const target = path.join(root, file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(path.join(SOURCE_ROOT, file), target);
}
function restoreHistoricalFiles(root) {
  for (const [source, target, digest] of [
    ['run-journal-baseline-v1.test.mjs', 'tests/run-journal-baseline.test.mjs', '17a8de142999f7ebdbe164336d81ce5c0a7ef27b00e105ff7bf7a1113ea37e7f'],
    ['finish-package-v1.json', 'work-orders/v02-finish-cluster-v1/package.json', '5a648d3057b70061e6947c895981df7ce9308b4a01c578e4e3abd31aff85f935'],
    ['c07-packet-v1.packet.md', '.packets/nisi-v02-c07-native-incident-oracle.packet.md', '872ce897b91cb3b0e93338e80060a7cb7787c97e1e15e27babf043a9c73e9af4'],
  ]) {
    const bytes = fs.readFileSync(path.join(SOURCE_ROOT, HISTORY, source));
    assert.equal(sha(bytes), digest, `retained historical fixture identity: ${target}`);
    const filename = path.join(root, target);
    fs.mkdirSync(path.dirname(filename), {recursive: true});
    fs.writeFileSync(filename, bytes);
  }
}
function addRef(paths, ref) {
  if (ref?.path) paths.add(ref.path);
  if (ref?.logPath) paths.add(ref.logPath);
}
function fixture(t, {historyCurrent=false}={}) {
  const evidenceFile = path.join(SOURCE_ROOT, C07_EVIDENCE);
  assert(fs.existsSync(evidenceFile), 'owner must freeze C07 final-evidence.json before acceptance tests');
  const scratch = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'nisi-c07-acceptance-')));
  t.after(() => fs.rmSync(scratch, { recursive: true, force: true }));
  const cluster = read(SOURCE_ROOT, CLUSTER);
  delete cluster.c07BaselineControl;
  delete cluster.baselineSupersessions;
  const evidence = read(SOURCE_ROOT, C07_EVIDENCE);
  const c07 = cluster.packets.find(row => row.id === 'C07');
  c07.state = 'NODE_IMPLEMENTATION_ACCEPTED';
  c07.implementationAccepted = true;
  c07.dependencies = ['C01', 'C06'];
  c07.allowedFiles = Object.keys(evidence.sourceHashes);
  c07.ownerAcceptance = {
    scope: evidence.scope,
    acceptedBy: 'codex',
    integrationRoute: 'OWNER_IMPLEMENTATION_WITH_LUNA_TESTS_DAYBREAK_REVIEW',
    openCodeExecuted: false,
    nativeBuildAccepted: false,
    publicationAuthorized: false,
    sourceAuthenticityAttested: false,
    evidence: C07_EVIDENCE,
    evidenceSha256: sha(fs.readFileSync(evidenceFile)),
    sourceHashes: evidence.sourceHashes,
    inference: 'NOT_RUN',
  };
  cluster.dependencySupersessions = [{ ...evidence.dependencySupersession,
    evidence: C07_EVIDENCE, evidenceSha256: c07.ownerAcceptance.evidenceSha256 }];
  const paths = new Set([CLUSTER, C07_EVIDENCE, evidence.prerequisite.evidence]);
  addRef(paths, evidence.packet); addRef(paths, evidence.candidateCheckpoint); addRef(paths, evidence.checkpoint); addRef(paths, evidence.mutations);
  addRef(paths, evidence.validation); addRef(paths, evidence.review); addRef(paths, evidence.integrationReview); addRef(paths, evidence.canonical);
  for (const file of Object.keys(evidence.sourceHashes ?? {})) paths.add(file);
  const checkpoint = evidence.checkpoint?.path && fs.existsSync(path.join(SOURCE_ROOT, evidence.checkpoint.path))
    ? read(SOURCE_ROOT, evidence.checkpoint.path) : null;
  for (const row of checkpoint?.checks ?? []) paths.add(path.posix.join(path.posix.dirname(evidence.checkpoint.path), row.name + '.log'));
  const mutations = read(SOURCE_ROOT, evidence.mutations.path);
  for (const row of mutations.checks) paths.add(path.posix.join(path.posix.dirname(evidence.mutations.path), row.name + '.log'));
  const canonical = evidence.canonical?.path && fs.existsSync(path.join(SOURCE_ROOT, evidence.canonical.path))
    ? read(SOURCE_ROOT, evidence.canonical.path) : null;
  for (const file of Object.keys(canonical?.dependencyHashes ?? {})) paths.add(file);
  for (const row of canonical?.checks ?? []) addRef(paths, row);
  const previous = read(SOURCE_ROOT, evidence.prerequisite.evidence);
  paths.add(previous.prerequisite.evidence);
  for (const kind of ['packet', 'checkpoint', 'review', 'validation', 'canonical']) addRef(paths, previous[kind]);
  for (const file of [...Object.keys(previous.sourceHashes), ...Object.keys(previous.dependencyHashes)]) paths.add(file);
  for (const row of read(SOURCE_ROOT, previous.checkpoint.path).checks)
    paths.add(path.posix.join(path.posix.dirname(previous.checkpoint.path), row.name + '.log'));
  for (const row of read(SOURCE_ROOT, previous.canonical.path).checks) addRef(paths, row);
  for (const file of paths) copy(scratch, file);
  if (historyCurrent) {
    const h=read(SOURCE_ROOT,cluster.historyHardening.evidence),c=read(SOURCE_ROOT,h.canonical);
    for (const file of new Set([cluster.historyHardening.evidence,...Object.keys(h.bindings),...Object.keys(c.before)])) copy(scratch,file);
  } else {
  delete cluster.historyHardening;
  // Historical acceptance fixtures retain their exact original history bytes.
  for (const [file, digest] of [["history/journal-owner-v2.mjs","b64e21ae717870faf220baf3f0ddc9c44841f0492415805f7b75b812828e7184"],["history/run-journal-v1.mjs","dee9f490c091000b2560cd9464d945885e7f341091b87dde9ae4f2b7cdbd359e"]]) {
    const bytes = fs.readFileSync(path.join(SOURCE_ROOT,'.packet-diagnostics/history-proxy-owner-20260920/before',file));
    assert.equal(sha(bytes),digest,'retained history predecessor');
    fs.writeFileSync(path.join(scratch,file),bytes);
  }
  }
  restoreHistoricalFiles(scratch);
  write(scratch, CLUSTER, cluster);
  return { scratch, cluster: read(scratch, CLUSTER), evidence: read(scratch, C07_EVIDENCE) };
}
function rebind(f) {
  write(f.scratch, C07_EVIDENCE, f.evidence);
  const c07 = f.cluster.packets.find(row => row.id === 'C07');
  c07.ownerAcceptance.evidenceSha256 = sha(fs.readFileSync(path.join(f.scratch, C07_EVIDENCE)));
  write(f.scratch, CLUSTER, f.cluster);
}
function mutateBound(f, kind, mutation) {
  const ref = f.evidence[kind];
  const value = read(f.scratch, ref.path);
  mutation(value);
  write(f.scratch, ref.path, value);
  ref.sha256 = sha(fs.readFileSync(path.join(f.scratch, ref.path)));
  rebind(f);
}
function refuses(t, mutate, message) {
  const f = fixture(t);
  mutate(f);
  assert.throws(() => assertC07Acceptance({ root: f.scratch, cluster: f.cluster, sha }), error =>
    (error.code === 'ERR_ASSERTION' && (message.test(error.message) || /C07 evidence digest pin/.test(error.message))) ||
    (error.code === 'ENOENT' && message.test(error.message)));
}

test('current history correction composes with C06 and C07 without rewriting predecessor receipts',t=>{
  const f=fixture(t,{historyCurrent:true});
  assert.equal(assertC07Acceptance({root:f.scratch,cluster:f.cluster,sha}),true);
  assert.equal(assertC06Acceptance({root:f.scratch,cluster:f.cluster,sha}),true);
});
test('new history source without its exact hardening record fails C07',t=>{
  const f=fixture(t,{historyCurrent:true}); delete f.cluster.historyHardening;
  assert.throws(()=>assertC07Acceptance({root:f.scratch,cluster:f.cluster,sha}),/C07 dependency drift: history\//);
});
test('history record cannot replace or merge the existing C07 supersession',t=>{
  for(const mutate of [f=>{delete f.cluster.dependencySupersessions;},f=>{f.cluster.dependencySupersessions.push(f.cluster.historyHardening);},
    f=>{f.cluster.dependencySupersessions[0].newSha256='0'.repeat(64);}]){
    const f=fixture(t,{historyCurrent:true});mutate(f);
    assert.throws(()=>assertC07Acceptance({root:f.scratch,cluster:f.cluster,sha}),/C07 dependency supersession binding/);
  }
});

test('C07 exact owner-frozen evidence and five-file scope pass the additive guard', t => {
  const f = fixture(t);
  assert.equal(assertC07Acceptance({ root: f.scratch, cluster: f.cluster, sha }), true);
});

test('C07 rejects accepted source drift and missing source closure', async t => {
  await t.test('accepted source drift', t => refuses(t, f => {
    const file = Object.keys(C07_SOURCE_HASHES).find(value => !value.includes('/README.md'));
    fs.appendFileSync(path.join(f.scratch, file), '\n// drift\n');
  }, /source drift|digest mismatch/));
  await t.test('accepted documentation omitted', t => refuses(t, f => {
    const file = 'work-orders/v02-finish-cluster-v1/native-incident/README.md';
    fs.unlinkSync(path.join(f.scratch, file));
  }, /regular file|source drift|ENOENT/));
  await t.test('dependency removed from canonical receipt', t => refuses(t, f => mutateBound(f, 'canonical', value => {
    delete value.dependencyHashes['workflow/contracts.mjs'];
  }), /dependency source transition|exact C06 dependency map|dependency/));
});

test('C07 rejects recomputed but contradictory receipts', async t => {
  await t.test('checkpoint count rebinding', t => refuses(t, f => mutateBound(f, 'checkpoint', value => {
    value.checks[0].counts.pass -= 1;
  }), /counts/));
  await t.test('canonical check rebinding', t => refuses(t, f => mutateBound(f, 'canonical', value => {
    value.checks[0].counts.tests += 1;
    value.checks[0].counts.pass += 1;
  }), /canonical c07|canonical check inventory|counts/));
  await t.test('review verdict rebinding', t => refuses(t, f => mutateBound(f, 'review', value => {
    value.verdict = 'FAIL';
  }), /verdict|PASS/));
  await t.test('validation authority rebinding', t => refuses(t, f => {
    const raw = read(f.scratch, f.evidence.validation.logPath);
    raw.authorizing = true;
    write(f.scratch, f.evidence.validation.logPath, raw);
    f.evidence.validation.logSha256 = sha(fs.readFileSync(path.join(f.scratch, f.evidence.validation.logPath)));
    const receipt = read(f.scratch, f.evidence.validation.path);
    receipt.logSha256 = f.evidence.validation.logSha256;
    write(f.scratch, f.evidence.validation.path, receipt);
    f.evidence.validation.sha256 = sha(fs.readFileSync(path.join(f.scratch, f.evidence.validation.path)));
    rebind(f);
  }, /authorizing|validation/));
});

test('C07 preserves C06 history and refuses authority or supersession rebinding', async t => {
  await t.test('C06 immutable owner evidence changed', t => refuses(t, f => {
    f.cluster.packets.find(row => row.id === 'C06').ownerAcceptance.evidenceSha256 = '0'.repeat(64);
  }, /C06 historical evidence/));
  await t.test('C07 native authority', t => refuses(t, f => {
    f.evidence.nativeExecutionAttested = true;
    rebind(f);
  }, /forbidden credit|nativeExecutionAttested/));
  await t.test('dependency supersession changed', t => refuses(t, f => {
    f.cluster.dependencySupersessions[0].newSha256 = 'f'.repeat(64);
  }, /supersession/));
  await t.test('predecessor metadata changed', t => refuses(t, f => {
    f.cluster.packets.find(row => row.id === 'C06').ownerAcceptance.scope = 'OTHER';
  }, /predecessor|C06/));
  await t.test('accepted file inventory changed', t => refuses(t, f => {
    f.cluster.packets.find(row => row.id === 'C07').allowedFiles.pop();
  }, /five-file scope|source map|accepted/));
});

test('C07 binds raw evidence, current dependencies and declared authority', async t => {
  await t.test('unrelated live dependency', t => refuses(t, f => {
    fs.appendFileSync(path.join(f.scratch, 'workflow/contracts.mjs'), '\n// drift\n');
  }, /dependency drift/));
  await t.test('raw checkpoint log', t => refuses(t, f => {
    const file=path.posix.join(path.posix.dirname(f.evidence.checkpoint.path),'c07-candidate.log');
    fs.appendFileSync(path.join(f.scratch,file),'changed');
  }, /log identity/));
  await t.test('missing mutation log', t => refuses(t, f => {
    const file=path.posix.join(path.posix.dirname(f.evidence.mutations.path),'alias-digest.log');
    fs.unlinkSync(path.join(f.scratch,file));
  }, /ENOENT/));
  await t.test('declared dependency omitted', t => refuses(t, f => { f.cluster.packets[6].dependencies=['C01']; }, /prerequisite inventory/));
  await t.test('row-level authority', t => {
    for(const key of ['openCodeExecuted','nativeBuildAccepted','publicationAuthorized','sourceAuthenticityAttested','nativeExecutionAttested','resumeGranted','inference'])
      refuses(t,f=>{f.cluster.packets[6][key]=key==='inference'?'RUN':true;},/C07 ledger/);
  });
  await t.test('extra transition', t=>refuses(t,f=>{f.cluster.dependencySupersessions.push({...f.cluster.dependencySupersessions[0]});},/supersession/));
  await t.test('affected acceptance inventory is exact', t=>{
    for(const affected of [['C06'],['C04','C05','C06','C01'],['C06','C05','C04']])
      refuses(t,f=>{f.cluster.dependencySupersessions[0].affectedAcceptances=affected;},/supersession/);
  });
  await t.test('false transition evidence', t=>refuses(t,f=>{f.cluster.dependencySupersessions[0].evidenceSha256='0'.repeat(64);},/supersession/));
  await t.test('unaccepted predecessor', t=>refuses(t,f=>{f.cluster.packets[5].implementationAccepted=false;},/accepted C06/));
});

test('C06 admits only the complete C07 one-dependency transition', async t => {
  await t.test('complete exact transition', t => {
    const f=fixture(t); assert.equal(assertC06Acceptance({root:f.scratch,cluster:f.cluster,sha}),true);
  });
  await t.test('flag alone with missing evidence', t=>{
    const f=fixture(t);fs.unlinkSync(path.join(f.scratch,C07_EVIDENCE));
    assert.throws(()=>assertC06Acceptance({root:f.scratch,cluster:f.cluster,sha}),/ENOENT/);
  });
  await t.test('unaccepted C07 cannot activate a record', t=>{
    const f=fixture(t);f.cluster.packets[6].implementationAccepted=false;
    assert.throws(()=>assertC06Acceptance({root:f.scratch,cluster:f.cluster,sha}),/without accepted C07/);
  });
  await t.test('new bytes alone cannot pass historical C06', t=>{
    const f=fixture(t);f.cluster.packets[6].implementationAccepted=false;delete f.cluster.dependencySupersessions;
    assert.throws(()=>assertC06Acceptance({root:f.scratch,cluster:f.cluster,sha}),/C06 dependency drift/);
  });
});
