import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { assertC06Acceptance } from '../work-orders/v02-finish-cluster-v1/c07-baseline-v3/history/check-c06.mjs';

// These assertions retain the original C06 control and historical fixtures.
// Current versioned baseline qualification has separate additive coverage.
const SOURCE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLUSTER = 'work-orders/v02-finish-cluster-v1/cluster.json';
const EVIDENCE = '.packet-diagnostics/c06-owner-draft-20260920/final-evidence.json';
const HISTORY = 'work-orders/v02-finish-cluster-v1/c07-baseline-v3/history';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');

function read(root, file) { return JSON.parse(fs.readFileSync(path.join(root, file))); }
function write(root, file, value) { fs.writeFileSync(path.join(root, file), `${JSON.stringify(value, null, 2)}\n`); }
function copy(root, file) {
  const target = path.join(root, file); fs.mkdirSync(path.dirname(target), { recursive: true });
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

function fixture(t) {
  assert(fs.existsSync(path.join(SOURCE_ROOT, EVIDENCE)), 'owner must freeze real C06 final-evidence.json before running acceptance tests');
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'nisi-c06-acceptance-'));
  t.after(() => fs.rmSync(scratch, { recursive: true, force: true }));
  const cluster = read(SOURCE_ROOT, CLUSTER), evidence = read(SOURCE_ROOT, EVIDENCE);
  // Exercise the historical C06 contract independently of a later C07 overlay.
  const c07 = cluster.packets.find(row => row.id === 'C07');
  c07.implementationAccepted = false;
  delete c07.ownerAcceptance;
  delete cluster.dependencySupersessions;
  delete cluster.c07BaselineControl;
  delete cluster.baselineSupersessions;
  const c06 = cluster.packets.find(row => row.id === 'C06');
  c06.state = 'NODE_IMPLEMENTATION_ACCEPTED'; c06.implementationAccepted = true;
  c06.allowedFiles = Object.keys(evidence.sourceHashes);
  c06.ownerAcceptance = {
    scope: evidence.scope, acceptedBy: 'codex',
    integrationRoute: 'OWNER_FABLE_DESIGN_DAYBREAK_IMPLEMENTATION_LUNA_REVIEW',
    openCodeExecuted: false, nativeBuildAccepted: false, publicationAuthorized: false,
    evidence: EVIDENCE, evidenceSha256: sha(fs.readFileSync(path.join(SOURCE_ROOT, EVIDENCE))),
    sourceHashes: evidence.sourceHashes
  };
  const canonical = read(SOURCE_ROOT, evidence.canonical.path);
  const checkpoint = read(SOURCE_ROOT, evidence.checkpoint.path);
  const paths = new Set([
    CLUSTER, EVIDENCE, evidence.packet.path, evidence.checkpoint.path, evidence.review.path,
    evidence.validation.path, evidence.validation.logPath, evidence.canonical.path,
    '.packet-diagnostics/c05-owner-review-PeEuLA/final-evidence.json', ...canonical.checks.map(row => row.logPath),
    ...checkpoint.checks.map(row => path.posix.join(path.posix.dirname(evidence.checkpoint.path),row.name+'.log')),
    ...Object.keys(evidence.sourceHashes), ...Object.keys(evidence.dependencyHashes)
  ]);
  for (const file of paths) copy(scratch, file);
  const predecessor = 'hosts/repository/native-incident-source-v1.mjs';
  const oldBytes = fs.readFileSync(path.join(SOURCE_ROOT,
    '.packet-diagnostics/c07-owner-draft-20260920/predecessor-source', predecessor));
  assert.equal(sha(oldBytes), evidence.dependencyHashes[predecessor], 'C06 retained predecessor identity');
  fs.writeFileSync(path.join(scratch, predecessor), oldBytes);
  delete cluster.historyHardening;
  // Historical acceptance fixtures retain their exact original history bytes.
  for (const [file, digest] of [["history/journal-owner-v2.mjs","b64e21ae717870faf220baf3f0ddc9c44841f0492415805f7b75b812828e7184"],["history/run-journal-v1.mjs","dee9f490c091000b2560cd9464d945885e7f341091b87dde9ae4f2b7cdbd359e"]]) {
    const bytes = fs.readFileSync(path.join(SOURCE_ROOT,'.packet-diagnostics/history-proxy-owner-20260920/before',file));
    assert.equal(sha(bytes),digest,'retained history predecessor');
    fs.writeFileSync(path.join(scratch,file),bytes);
  }
  restoreHistoricalFiles(scratch);
  write(scratch, CLUSTER, cluster);
  return { scratch, cluster: read(scratch, CLUSTER), evidence: read(scratch, EVIDENCE) };
}

function rebind(f) {
  write(f.scratch, EVIDENCE, f.evidence);
  const c06 = f.cluster.packets.find(row => row.id === 'C06');
  c06.ownerAcceptance.evidenceSha256 = sha(fs.readFileSync(path.join(f.scratch, EVIDENCE)));
  write(f.scratch, CLUSTER, f.cluster);
}

function mutateBound(f, kind, mutation) {
  const ref = f.evidence[kind], value = read(f.scratch, ref.path); mutation(value);
  write(f.scratch, ref.path, value); ref.sha256 = sha(fs.readFileSync(path.join(f.scratch, ref.path)));
  rebind(f);
}

function refuses(t, mutation, pattern) {
  const f = fixture(t); mutation(f); assert.throws(() => assertC06Acceptance({ root: f.scratch, cluster: f.cluster, sha }), pattern);
}

test('C06 exact owner-frozen evidence is accepted by the additive guard', t => {
  const f = fixture(t);
  assert.equal(assertC06Acceptance({ root: f.scratch, cluster: f.cluster, sha }), true);
});

test('C06 refuses accepted source and dependency drift', async t => {
  await t.test('accepted source', t => refuses(t, f => {
    const file = Object.keys(f.evidence.sourceHashes)[0]; fs.appendFileSync(path.join(f.scratch, file), '\n// drift\n');
  }, /source drift/));
  await t.test('meaningful dependency', t => refuses(t, f => {
    const file = Object.keys(f.evidence.dependencyHashes)[0]; fs.appendFileSync(path.join(f.scratch, file), '\n// drift\n');
  }, /dependency drift/));
});

test('C06 refuses omitted, rebound, and contradictory evidence', async t => {
  await t.test('missing review', t => refuses(t, f => fs.unlinkSync(path.join(f.scratch, f.evidence.review.path)), /ENOENT/));
  await t.test('recomputed review digest with false served identity', t => refuses(t, f => mutateBound(f, 'review', value => {
    value.modelActuallyServed = 'CLAUDE';
  }), /UNKNOWN/));
  await t.test('recomputed checkpoint digest with skipped test', t => refuses(t, f => mutateBound(f, 'checkpoint', value => {
    value.checks[0].counts.skipped = 1;
  }), /counts/));
  await t.test('recomputed validation digest with wrong candidate', t => refuses(t, f => mutateBound(f, 'validation', value => {
    value.binding.candidateFingerprint = '0'.repeat(64);
  }), /candidateFingerprint/));
  await t.test('recomputed packet and outer digest', t => refuses(t, f => {
    fs.appendFileSync(path.join(f.scratch, f.evidence.packet.path), '\nchanged\n');
    const text = fs.readFileSync(path.join(f.scratch, f.evidence.packet.path), 'utf8').replace(/^project_root: .+$/m, 'project_root: <PROJECT_ROOT>');
    f.evidence.packet.sha256 = sha(text); rebind(f);
  }, /packet identity/));
  await t.test('dependency removed from evidence and canonical receipt', t => refuses(t, f => {
    const file = Object.keys(f.evidence.dependencyHashes)[0]; delete f.evidence.dependencyHashes[file];
    f.evidence.dependencyClosureSha256 = sha(Buffer.from(JSON.stringify(f.evidence.dependencyHashes)));
    mutateBound(f, 'canonical', value => { delete value.dependencyHashes[file]; });
  }, /dependency closure inventory|dependency closure receipt identity/));
  await t.test('raw validation relabeled authorizing with rebound receipts', t => refuses(t, f => {
    const raw = read(f.scratch, f.evidence.validation.logPath); raw.authorizing = true;
    write(f.scratch, f.evidence.validation.logPath, raw);
    const receipt = read(f.scratch, f.evidence.validation.path);
    receipt.logSha256 = sha(fs.readFileSync(path.join(f.scratch, f.evidence.validation.logPath)));
    write(f.scratch, f.evidence.validation.path, receipt);
    f.evidence.validation.logSha256 = receipt.logSha256;
    f.evidence.validation.sha256 = sha(fs.readFileSync(path.join(f.scratch, f.evidence.validation.path)));
    rebind(f);
  }, /authorizing/));
});

test('C06 refuses unauthorized authority and predecessor changes', async t => {
  await t.test('native credit', t => refuses(t, f => {
    f.evidence.nativeBuildAccepted = true; rebind(f);
  }, /nativeBuildAccepted/));
  await t.test('resume credit in canonical receipt', t => refuses(t, f => mutateBound(f, 'canonical', value => {
    value.resumeGranted = true;
  }), /resumeGranted/));
  await t.test('publication credit', t => refuses(t, f => {
    f.evidence.publicationAuthorized = true; rebind(f);
  }, /publicationAuthorized/));
  await t.test('C05 acceptance removed', t => refuses(t, f => {
    f.cluster.packets.find(row => row.id === 'C05').implementationAccepted = false;
  }, /accepted C05/));
  await t.test('canonical receipt claims publication authority', t => refuses(t, f => mutateBound(f, 'canonical', value => {
    value.publicationAuthorized = true;
  }), /publicationAuthorized/));
  await t.test('integration route changed', t => refuses(t, f => {
    f.cluster.packets.find(row => row.id === 'C06').ownerAcceptance.integrationRoute = 'OTHER';
  }, /integration route/));
  await t.test('accepted file omitted', t => refuses(t, f => {
    f.cluster.packets.find(row => row.id === 'C06').allowedFiles.pop();
  }, /accepted file inventory/));
});

test('C06 binds ledger authority, immutable receipt identity, historical logs and runtime', async t => {
  await t.test('row-level authority cannot bypass subordinate evidence', t => {
    for(const key of ['publicationAuthorized','nativeBuildAccepted','resumeGranted','sourceAuthenticityAttested','openCodeExecuted','inference']){
      refuses(t, f => { f.cluster.packets[5][key] = key === 'inference' ? 'RUN' : true; }, /C06 ledger/);
    }
  });
  await t.test('semantically equivalent receipt replacement still needs a new owner pin', t => refuses(t, f => {
    mutateBound(f, 'review', value => { value.note += ' replacement'; });
  }, /immutable owner evidence identity/));
  await t.test('retained checkpoint log bytes are required', t => refuses(t, f => {
    const file=path.posix.join(path.posix.dirname(f.evidence.checkpoint.path),'c06.log');
    fs.appendFileSync(path.join(f.scratch,file),'\nchanged\n');
  }, /log digest/));
  await t.test('another executable named node is not the recorded runtime', t => refuses(t, f => {
    mutateBound(f,'canonical',value=>{value.checks[0].command[0]='/different/node';});
  }, /executable/));
});
