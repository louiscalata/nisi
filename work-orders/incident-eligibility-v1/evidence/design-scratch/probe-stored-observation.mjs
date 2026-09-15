// READ-ONLY probe: builds a synthetic (no native/no model) repository run,
// captures one FAILURE_CANDIDATE row into an in-memory journal, then queries it
// through every status view. Prints shapes verbatim with Reflect.ownKeys.
// TMPDIR is pointed at the scratchpad so fixture mkdtemp stays under iec/.
import {createRepositoryIncidentAccessV1, queryRepositoryIncidentV1} from '/Users/louiscalata/nisi-next-private/history/repository-incident-capture-v1.mjs';
import {createRepositoryIncidentPreviewV1} from '/Users/louiscalata/nisi-next-private/history/repository-incident-candidates-v1.mjs';
import {createRepositoryRunBundleV1} from '/Users/louiscalata/nisi-next-private/receipts/repository-run-v1.mjs';
import {openJournalOwner, recordJournalObservation, maintainJournalOwner, inspectJournalOwner} from '/Users/louiscalata/nisi-next-private/history/journal-owner-v2.mjs';
import {combinedFixture} from '/Users/louiscalata/nisi-next-private/tests/helpers/repository-run-fixture.mjs';
import {memfs} from '/Users/louiscalata/nisi-next-private/tests/journal-owner-v2.memfs.mjs';
import {stableStringify} from '/Users/louiscalata/nisi-next-private/workflow/contracts.mjs';

const PATH = '/j/incidents.jsonl';
const fakeT = {after(fn) { process.on('exit', () => { try { fn(); } catch {} }); }};
const keys = o => o && typeof o === 'object' ? Reflect.ownKeys(o).map(String) : typeof o;
const section = title => console.log('\n=== ' + title + ' ===');
const dump = (label, v) => console.log(label + ' ' + JSON.stringify(v, null, 1));

section('FIXTURE (staticOnly => static-check FAILURE_CANDIDATE) + tests-stage failure fixture');
const fStatic = await combinedFixture(fakeT, {staticOnly: true});
const previewStatic = createRepositoryIncidentPreviewV1({bundle: createRepositoryRunBundleV1(fStatic.context), context: fStatic.context});
const fTests = await combinedFixture(fakeT, {});
const previewTests = createRepositoryIncidentPreviewV1({bundle: createRepositoryRunBundleV1(fTests.context), context: fTests.context});

section('PREVIEW top-level keys + classification histogram');
console.log('preview keys:', keys(previewStatic));
console.log('preview.status/sourceTrust/freshness/persistable/learningEligible/authorizing:',
  previewStatic.status, previewStatic.sourceTrust, previewStatic.freshness, previewStatic.persistable, previewStatic.learningEligible, previewStatic.authorizing);
for (const [name, p] of [['staticOnly', previewStatic], ['tests', previewTests]]) {
  console.log(name, 'rows:', p.rows.length, 'histogram:',
    JSON.stringify(p.rows.map(r => `${r.binding.stage}/${r.classification}/${r.reason}/${r.rawStatus}/${r.stageStatus}/${r.disposition}`)));
}

const rowStatic = previewStatic.rows.find(r => r.classification === 'FAILURE_CANDIDATE');
const rowTests = previewTests.rows.find(r => r.classification === 'FAILURE_CANDIDATE' && r.binding.stage === 'tests');
const rowPass = previewStatic.rows.find(r => r.classification === 'PASS');

section('FAILURE_CANDIDATE ROW (staticChecks) verbatim');
console.log('row keys:', keys(rowStatic));
console.log('row.binding keys:', keys(rowStatic.binding));
console.log('row.source keys:', keys(rowStatic.source));
console.log('row.subject keys:', keys(rowStatic.subject));
dump('row =', rowStatic);

section('FAILURE_CANDIDATE ROW (tests) verbatim');
if (rowTests) dump('row =', rowTests); else console.log('no tests-stage FAILURE_CANDIDATE in fixture');

section('PASS ROW (for contrast; classification/reason/rawStatus)');
if (rowPass) dump('row =', {classification: rowPass.classification, reason: rowPass.reason, rawStatus: rowPass.rawStatus, stageStatus: rowPass.stageStatus, disposition: rowPass.disposition, failureCodes: rowPass.failureCodes, sourceTrust: rowPass.sourceTrust});

// ---- Capture into an in-memory journal ----
const row = rowStatic, preview = previewStatic;
const projectId = 'task:' + row.binding.taskFingerprint;
const config = {projectId, maxEntries: 32, heartbeatTtlMs: 30000, redactPaths: []};
const declaration = {schemaVersion: 'nisi-repository-incident-declaration/v1', declarationId: 'probe.a',
  projectId, rowId: row.rowId, rowFingerprint: row.fingerprint, previewSha256: preview.sha256,
  issuedAt: 100, expiresAt: 1000, createdAt: 100, retentionMs: 10000, consentClass: 'WRITTEN_DECLARATION',
  destination: 'LOCAL_INCIDENT_OBSERVATION_ONLY', rawContentPersisted: false, networkEgress: false, learningInfluence: false};

section('DECLARATION keys');
console.log('declaration keys:', keys(declaration), 'count', keys(declaration).length);

const m = memfs();
const owner = openJournalOwner({path: PATH, fs: m.fs, config, now: 100}).owner;
const access = createRepositoryIncidentAccessV1({getPreview: () => preview});
const permit = access.createPermit({owner, declaration, clock: () => 100});
section('PERMIT result verbatim');
console.log('permit keys:', keys(permit));
dump('permit =', {...permit, permit: permit.permit === null ? null : `<frozen {} keys=${JSON.stringify(keys(permit.permit))}>`});

const stored = access.capture({permit: permit.permit});
section('CAPTURE result (STORED) verbatim minus journal.snapshot.entries');
console.log('capture keys:', keys(stored));
dump('capture =', {...stored, journal: stored.journal ? {...stored.journal, snapshot: stored.journal.snapshot ? {...stored.journal.snapshot, entries: `<${stored.journal.snapshot.entries.length} entries>`} : null} : null});
console.log('capture.journal keys:', keys(stored.journal));
console.log('capture.journal.store keys:', keys(stored.journal.store));
console.log('capture.journal.append keys:', keys(stored.journal.append));
console.log('capture.journal.snapshot keys:', keys(stored.journal.snapshot));

section('STORED JOURNAL ENTRY (snapshot row) verbatim');
const snapRow = stored.journal.snapshot.entries.find(x => x.entry.id === stored.entryId);
console.log('snapshot row keys:', keys(snapRow));
console.log('snapshot row.entry keys:', keys(snapRow.entry));
console.log('snapshot row.entry.payload keys:', keys(snapRow.entry.payload));
dump('snapshot row (payload.row elided to rowId) =', {...snapRow, entry: {...snapRow.entry, payload: {...snapRow.entry.payload, row: `<row rowId=${snapRow.entry.payload.row.rowId}>`}}});
console.log('payload.row deep-equals preview row:', stableStringify(snapRow.entry.payload.row) === stableStringify(row));

section('QUERY AVAILABLE_OBSERVATION verbatim (observation.row elided to rowId)');
const q1 = queryRepositoryIncidentV1({path: PATH, fs: m.fs, config, entryId: stored.entryId, now: 100});
console.log('query keys:', keys(q1));
console.log('query.observation keys:', keys(q1.observation));
dump('query =', {...q1, observation: {...q1.observation, row: `<row rowId=${q1.observation.row.rowId}>`}});
console.log('frozen? query:', Object.isFrozen(q1), 'observation:', Object.isFrozen(q1.observation), 'row:', Object.isFrozen(q1.observation.row), 'row.source:', Object.isFrozen(q1.observation.row.source));
console.log('observation.row deep-equals preview row:', stableStringify(q1.observation.row) === stableStringify(row));

section('QUERY EXPIRED (now = createdAt + ttlMs = 10100)');
dump('query =', queryRepositoryIncidentV1({path: PATH, fs: m.fs, config, entryId: stored.entryId, now: 10100}));

section('QUERY MISSING (unknown ric1 id)');
dump('query =', queryRepositoryIncidentV1({path: PATH, fs: m.fs, config, entryId: 'ric1.' + '0'.repeat(64), now: 100}));

section('QUERY REFUSED INVALID_INPUT (malformed id)');
dump('query =', queryRepositoryIncidentV1({path: PATH, fs: m.fs, config, entryId: 'not-an-id', now: 100}));

section('QUERY REFUSED wrong project (same disk, other projectId)');
dump('query =', queryRepositoryIncidentV1({path: PATH, fs: m.fs, config: {...config, projectId: 'task:' + 'f'.repeat(64)}, entryId: stored.entryId, now: 100}));

section('QUERY REFUSED JOURNAL_UNAVAILABLE (no file)');
dump('query =', queryRepositoryIncidentV1({path: '/j/none.jsonl', fs: m.fs, config, entryId: stored.entryId, now: 100}));

section('REVOCATION: tombstone entry appended, then query');
const opened2 = openJournalOwner({path: PATH, fs: m.fs, config, now: 101});
const e = snapRow.entry;
const tombstone = {...e, id: 'revoke.' + 'a'.repeat(20), state: 'REVOKED', revokes: e.id, retryOf: null, createdAt: 101, ttlMs: 1000000, payload: null};
const rev = recordJournalObservation({owner: opened2.owner, entry: tombstone, now: 101});
console.log('tombstone record status/reason:', rev.status, rev.reason);
const q3 = queryRepositoryIncidentV1({path: PATH, fs: m.fs, config, entryId: stored.entryId, now: 102});
dump('query after revoke =', q3);
const revRow = rev.snapshot.entries.find(x => x.entry.id === stored.entryId);
dump('snapshot row of revoked original (payload elided) =', {...revRow, entry: {...revRow.entry, payload: revRow.entry.payload === null ? null : '<payload present>'}});
const maint = maintainJournalOwner({owner: opened2.owner, now: 103});
console.log('maintain status:', maint.status, 'reason:', maint.reason);
const revRow2 = inspectJournalOwner({owner: opened2.owner}).snapshot.entries.find(x => x.entry.id === stored.entryId);
dump('after maintain: revoked original row (payload elided) =', {...revRow2, entry: {...revRow2.entry, payload: revRow2.entry.payload === null ? null : '<payload present>'}});
dump('query after maintain =', queryRepositoryIncidentV1({path: PATH, fs: m.fs, config, entryId: stored.entryId, now: 104}));

section('PRUNING (maxEntries:1) -> NOT_RETAINED');
{
  const m2 = memfs(); const cfg2 = {...config, maxEntries: 1};
  const o2 = openJournalOwner({path: PATH, fs: m2.fs, config: cfg2, now: 100}).owner;
  const a2 = createRepositoryIncidentAccessV1({getPreview: () => preview});
  const p2 = a2.createPermit({owner: o2, declaration, clock: () => 100});
  const s2 = a2.capture({permit: p2.permit});
  console.log('capture status:', s2.status);
  const ent = s2.journal.snapshot.entries.find(v => v.entry.id === s2.entryId).entry;
  const added = recordJournalObservation({owner: o2, entry: {...ent, id: 'unrelated.second', payload: null}, now: 100});
  console.log('second record status:', added.status);
  const prunedRow = added.snapshot.entries.find(x => x.entry.id === s2.entryId);
  dump('pruned original snapshot row (payload) =', {...prunedRow, entry: {...prunedRow.entry, payload: prunedRow.entry.payload}});
  dump('query pruned =', queryRepositoryIncidentV1({path: PATH, fs: m2.fs, config: cfg2, entryId: s2.entryId, now: 100}));
}

section('REDACTION: redactPaths on payload -> capture then query');
{
  const m3 = memfs(); const cfg3 = {...config, redactPaths: ['payload.row.source.reportSha256']};
  const o3 = openJournalOwner({path: PATH, fs: m3.fs, config: cfg3, now: 100});
  console.log('open status:', o3.status, o3.reason ?? '');
  if (o3.status === 'OPENED') {
    const a3 = createRepositoryIncidentAccessV1({getPreview: () => preview});
    const p3 = a3.createPermit({owner: o3.owner, declaration, clock: () => 100});
    console.log('permit:', p3.status, p3.reason);
    const s3 = a3.capture({permit: p3.permit});
    console.log('capture status/reason:', s3.status, s3.reason, 'journal.status:', s3.journal?.status);
    const ent3 = s3.journal?.snapshot?.entries.find(v => v.entry.id === s3.entryId)?.entry;
    console.log('stored payload.row.source.reportSha256 =', JSON.stringify(ent3?.payload?.row?.source?.reportSha256));
    dump('query redacted =', queryRepositoryIncidentV1({path: PATH, fs: m3.fs, config: cfg3, entryId: s3.entryId, now: 100}));
  }
  const m4 = memfs(); const cfg4 = {...config, redactPaths: ['payload.message']};
  const o4 = openJournalOwner({path: PATH, fs: m4.fs, config: cfg4, now: 100});
  console.log('open (redactPaths=payload.message) status:', o4.status);
  if (o4.status === 'OPENED') {
    const a4 = createRepositoryIncidentAccessV1({getPreview: () => preview});
    const p4 = a4.createPermit({owner: o4.owner, declaration, clock: () => 100});
    const s4 = a4.capture({permit: p4.permit});
    dump('capture with missing redact path =', {...s4, journal: s4.journal ? {...s4.journal, snapshot: '<elided>'} : null});
  }
}

section('WRITE UNCERTAINTY: readback mismatch -> UNCERTAIN, owner COMMIT_UNCERTAIN, then query');
{
  const m5 = memfs();
  const fs5 = {...m5.fs, renameSync(a, b) { m5.fs.renameSync(a, b); m5.seed(b, Buffer.from('damaged')); }};
  const o5 = openJournalOwner({path: PATH, fs: fs5, config, now: 100}).owner;
  const a5 = createRepositoryIncidentAccessV1({getPreview: () => preview});
  const p5 = a5.createPermit({owner: o5, declaration, clock: () => 100});
  const s5 = a5.capture({permit: p5.permit});
  dump('capture =', {...s5, journal: s5.journal ? {...s5.journal, snapshot: s5.journal.snapshot ? {...s5.journal.snapshot, entries: `<${s5.journal.snapshot.entries.length}>`} : null} : null});
  console.log('owner state after:', inspectJournalOwner({owner: o5}).snapshot.state);
  dump('query on damaged disk =', queryRepositoryIncidentV1({path: PATH, fs: m5.fs, config, entryId: s5.entryId, now: 100}));
  console.log('second capture same permit:', JSON.stringify((({status, reason, recordAttempted, consumed}) => ({status, reason, recordAttempted, consumed}))(a5.capture({permit: p5.permit}))));
}

section('STORE_FAILED: openSync EIO');
{
  const m6 = memfs({openSync: () => Object.assign(Error('fail'), {code: 'EIO'})});
  const o6 = openJournalOwner({path: PATH, fs: m6.fs, config, now: 100});
  console.log('open status:', o6.status);
  if (o6.status === 'OPENED') {
    const a6 = createRepositoryIncidentAccessV1({getPreview: () => preview});
    const p6 = a6.createPermit({owner: o6.owner, declaration, clock: () => 100});
    const s6 = a6.capture({permit: p6.permit});
    dump('capture =', {...s6, journal: s6.journal ? {...s6.journal, snapshot: s6.journal.snapshot ? {...s6.journal.snapshot, entries: `<${s6.journal.snapshot.entries.length}>`} : null} : null});
  }
}

section('IDEMPOTENT REPLAY vs CONFLICT');
{
  const m7 = memfs();
  const a = createRepositoryIncidentAccessV1({getPreview: () => preview});
  const oa = openJournalOwner({path: PATH, fs: m7.fs, config, now: 100}).owner;
  const first = a.capture({permit: a.createPermit({owner: oa, declaration, clock: () => 100}).permit});
  console.log('first:', first.status, first.reason);
  const b = createRepositoryIncidentAccessV1({getPreview: () => preview});
  const ob = openJournalOwner({path: PATH, fs: m7.fs, config, now: 100}).owner;
  const same = b.capture({permit: b.createPermit({owner: ob, declaration, clock: () => 100}).permit});
  console.log('exact replay (new access, reopened owner):', same.status, same.reason, 'journal.status:', same.journal.status, 'entryId same:', same.entryId === first.entryId);
  const c = createRepositoryIncidentAccessV1({getPreview: () => preview});
  const oc = openJournalOwner({path: PATH, fs: m7.fs, config, now: 100}).owner;
  const changed = c.capture({permit: c.createPermit({owner: oc, declaration: {...declaration, declarationId: 'probe.changed'}, clock: () => 100}).permit});
  dump('changed declaration (same row) =', {...changed, journal: changed.journal ? {...changed.journal, snapshot: '<elided>'} : null});
  const dup = a.capture({permit: a.createPermit({owner: oa, declaration: {...declaration, declarationId: 'probe.b'}, clock: () => 100}).permit});
  console.log('same access second permit for consumed row:', dup.status, dup.reason, 'consumed:', dup.consumed);
  // same-owner exact replay from a new access, owner already has bytes
  const d = createRepositoryIncidentAccessV1({getPreview: () => preview});
  const sameOwner = d.capture({permit: d.createPermit({owner: oa, declaration, clock: () => 100}).permit});
  console.log('exact replay on ORIGINAL owner (has current bytes):', sameOwner.status, sameOwner.reason, 'journal.status:', sameOwner.journal?.status);
}

section('PERMIT REFUSALS (clock, PASS row, cloned preview, wrong project)');
{
  const m8 = memfs(); const o8 = openJournalOwner({path: PATH, fs: m8.fs, config, now: 100}).owner;
  const a8 = createRepositoryIncidentAccessV1({getPreview: () => preview});
  console.log('NOT_YET_VALID:', JSON.stringify(a8.createPermit({owner: o8, declaration, clock: () => 99})));
  console.log('PERMIT_EXPIRED:', JSON.stringify(a8.createPermit({owner: o8, declaration, clock: () => 1000})));
  console.log('OBSERVATION_EXPIRED:', JSON.stringify(a8.createPermit({owner: o8, declaration: {...declaration, expiresAt: 20000}, clock: () => 10100})));
  console.log('INVALID_CLOCK:', JSON.stringify(a8.createPermit({owner: o8, declaration, clock: () => -0})));
  console.log('PASS row:', JSON.stringify(a8.createPermit({owner: o8, declaration: {...declaration, rowId: rowPass.rowId, rowFingerprint: rowPass.fingerprint}, clock: () => 100})));
  const cloned = structuredClone(preview);
  const a8c = createRepositoryIncidentAccessV1({getPreview: () => cloned});
  console.log('cloned preview:', JSON.stringify(a8c.createPermit({owner: o8, declaration, clock: () => 100})));
  console.log('wrong projectId:', JSON.stringify(a8.createPermit({owner: o8, declaration: {...declaration, projectId: 'task:' + '0'.repeat(64)}, clock: () => 100})));
  console.log('project mismatch owner (journal project != declaration project):');
  const oWrong = openJournalOwner({path: '/j/other.jsonl', fs: m8.fs, config: {...config, projectId: 'task:' + '0'.repeat(64)}, now: 100}).owner;
  const pw = a8.createPermit({owner: oWrong, declaration, clock: () => 100});
  const cw = a8.capture({permit: pw.permit});
  dump('  capture =', {...cw, journal: cw.journal ? {...cw.journal, snapshot: cw.journal.snapshot ? '<snapshot>' : null} : null});
  const sealed = openJournalOwner({path: PATH, fs: m8.fs, config, now: 100});
  console.log('owner state at open:', sealed.snapshot.state);
}

section('ON-DISK JOURNAL LINES (memfs bytes) for the STORED case');
const text = m.bytes(PATH).toString('utf8');
const lines = text.trimEnd().split('\n').map(l => JSON.parse(l));
console.log('line count:', lines.length);
console.log('line[0] (header) =', JSON.stringify(lines[0]));
console.log('line[1] keys =', keys(lines[1]), 'record keys =', keys(lines[1].record));
console.log('line[last] (footer) =', JSON.stringify(lines[lines.length - 1]));
