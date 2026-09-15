// READ-ONLY probe: feeds REAL producer output (a genuine queryRepositoryIncidentV1
// result + a genuine host.nativeIncidentSourcePlan envelope for the same row)
// into the scratchpad eligibility sketch, then the lifecycle/forged/hostile cases.
// No writes under the private tree; journal lives in memfs.
const R = '/Users/louiscalata/nisi-next-private/';
const {createPagedIncidentHostFixture} = await import(R + 'tests/helpers/incident-review-fixture.mjs');
const {combinedFixture} = await import(R + 'tests/helpers/repository-run-fixture.mjs');
const {createRepositoryRunBundleV1} = await import(R + 'receipts/repository-run-v1.mjs');
const {createRepositoryIncidentPreviewV1} = await import(R + 'history/repository-incident-candidates-v1.mjs');
const {createNativeIncidentSourcePlanV1, nativeIncidentSourceRefusalV1} = await import(R + 'hosts/repository/native-incident-source-v1.mjs');
const {queryRepositoryIncidentV1} = await import(R + 'history/repository-incident-capture-v1.mjs');
const {openJournalOwner, recordJournalObservation} = await import(R + 'history/journal-owner-v2.mjs');
const {memfs} = await import(R + 'tests/journal-owner-v2.memfs.mjs');
const {decideIncidentEligibilityV1: decide} = await import('./eligibility-sketch.mjs');

const J = (v) => JSON.stringify(v);
const brief = (d) => J({status: d.status, reason: d.reason, checks: d.checks, entryId: d.entryId && d.entryId.slice(0, 12), journalSha256: d.journalSha256 && d.journalSha256.slice(0, 8), sourcePlanDigest: d.sourcePlanDigest && d.sourcePlanDigest.slice(0, 8)});
const show = (l, v) => console.log(l + ' => ' + v);
const deepFrozen = (v) => v === null || typeof v !== 'object' || (Object.isFrozen(v) && Object.values(v).every(deepFrozen));
const PATH = '/j/incidents.jsonl';
const afters = []; const t = {after: (fn) => afters.push(fn)};

try {
  console.log('=== REAL PRODUCERS: paged host fixture (13 static FAIL rows, settled) ===');
  const {host, preview, eligible} = await createPagedIncidentHostFixture();
  const row = eligible[0], row2 = eligible[1];
  const plan = host.nativeIncidentSourcePlan({rowId: row.rowId});
  show('plan.status/reason', J([plan.status, plan.reason]));
  const projectId = 'task:' + row.binding.taskFingerprint;
  const config = {projectId, maxEntries: 32, heartbeatTtlMs: 30000, redactPaths: []};
  const decl = (r, id) => ({schemaVersion: 'nisi-repository-incident-declaration/v1', declarationId: id, projectId,
    rowId: r.rowId, rowFingerprint: r.fingerprint, previewSha256: preview.sha256, issuedAt: 100, expiresAt: 1000,
    createdAt: 100, retentionMs: 10000, consentClass: 'WRITTEN_DECLARATION', destination: 'LOCAL_INCIDENT_OBSERVATION_ONLY',
    rawContentPersisted: false, networkEgress: false, learningInfluence: false});
  const m = memfs();
  const owner = openJournalOwner({path: PATH, fs: m.fs, config, now: 100}).owner;
  const permit = host.createIncidentPermit({owner, declaration: decl(row, 'probe.elig.a'), clock: () => 100});
  const stored = host.captureIncident({permit: permit.permit});
  show('capture.status/entryId', J([stored.status, stored.entryId.slice(0, 16)]));
  const q = (over = {}) => queryRepositoryIncidentV1({path: PATH, fs: m.fs, config, entryId: stored.entryId, now: 100, ...over});
  const qa = q();
  show('query.status', qa.status);
  show('query.journalSha256 present', String(qa.journalSha256 !== null));

  console.log('\n=== T1 baseline: real query + real plan ===');
  const d1 = decide({projectId, query: qa, plan});
  show('decision', brief(d1));
  show('Object.keys(decision)', J(Object.keys(d1)));
  show('deepFrozen', String(deepFrozen(d1)));
  show('entryId echoed === query.entryId', String(d1.entryId === qa.entryId));
  show('journalSha256 echoed === query.journalSha256', String(d1.journalSha256 === qa.journalSha256));
  show('sourcePlanDigest echoed === plan.sourcePlanDigest', String(d1.sourcePlanDigest === plan.sourcePlanDigest));
  show('T2 determinism: second call deepEqual', String(J(decide({projectId, query: qa, plan})) === J(d1)));
  show('T19 key-order independence (observation keys are cloneFreeze-sorted)', J(Object.keys(qa.observation).slice(0, 4)));

  console.log('\n=== lifecycle via REAL query results ===');
  show('T11 EXPIRED (now=10100)', brief(decide({projectId, query: q({now: 10100}), plan})));
  show('T9a MISSING (unknown id, file exists)', brief(decide({projectId, query: q({entryId: 'ric1.' + 'f'.repeat(64)}), plan})));
  show('T9b MISSING (no file)', brief(decide({projectId, query: q({path: '/j/none.jsonl'}), plan})));
  show('T5 JOURNAL_UNAVAILABLE (wrong projectId at query)', brief(decide({projectId, query: q({config: {...config, projectId: 'task:' + '0'.repeat(64)}}), plan})));
  show('T8 query REFUSED/INVALID_INPUT (bad now)', brief(decide({projectId, query: q({now: -0}), plan})));
  // revoke via tombstone
  {
    const o2 = openJournalOwner({path: PATH, fs: m.fs, config, now: 101});
    const e = o2.snapshot.entries.find((x) => x.entry.id === stored.entryId).entry;
    const tomb = {...e, id: 'revoke.' + 'a'.repeat(20), state: 'REVOKED', revokes: e.id, retryOf: null, createdAt: 101, ttlMs: 1000000, payload: null};
    const rev = recordJournalObservation({owner: o2.owner, entry: tomb, now: 101});
    show('tombstone record', J([rev.status, rev.reason]));
    show('T10 REVOKED', brief(decide({projectId, query: q({now: 102}), plan})));
  }
  // truncated footer => JOURNAL_NOT_OPEN
  {
    const lines = m.bytes(PATH).toString('utf8').trimEnd().split('\n');
    const m2 = memfs(); m2.seed(PATH, Buffer.from(lines.slice(0, -1).join('\n') + '\n'));
    show('T6 JOURNAL_NOT_OPEN (truncated footer)', brief(decide({projectId, query: q({fs: m2.fs, now: 102}), plan})));
  }
  // NOT_RETAINED via maxEntries:1 and a second capture
  {
    const m3 = memfs(); const cfg = {...config, maxEntries: 1};
    const o = openJournalOwner({path: PATH, fs: m3.fs, config: cfg, now: 100}).owner;
    const p1 = host.createIncidentPermit({owner: o, declaration: decl(row2, 'probe.elig.b'), clock: () => 100});
    const s1 = host.captureIncident({permit: p1.permit});
    show('second-row capture', J([s1.status, s1.reason]));
    const o2 = openJournalOwner({path: PATH, fs: m3.fs, config: cfg, now: 101}).owner;
    const {createRepositoryIncidentAccessV1} = await import(R + 'history/repository-incident-capture-v1.mjs');
    const access = createRepositoryIncidentAccessV1({getPreview: () => preview});
    const p2 = access.createPermit({owner: o2, declaration: decl(eligible[2], 'probe.elig.c'), clock: () => 101});
    const s2 = access.capture({permit: p2.permit});
    show('third-row capture (prunes the first)', J([s2.status, s2.reason]));
    const qn = queryRepositoryIncidentV1({path: PATH, fs: m3.fs, config: cfg, entryId: s1.entryId, now: 102});
    show('query status', qn.status);
    const plan2 = host.nativeIncidentSourcePlan({rowId: row2.rowId});
    show('T12 NOT_RETAINED', brief(decide({projectId, query: qn, plan: plan2})));
  }
  // redaction => query REFUSED/INVALID_OBSERVATION
  {
    const m4 = memfs(); const cfg = {...config, redactPaths: ['payload.row.source.reportSha256']};
    const o = openJournalOwner({path: PATH, fs: m4.fs, config: cfg, now: 100}).owner;
    const {createRepositoryIncidentAccessV1} = await import(R + 'history/repository-incident-capture-v1.mjs');
    const access = createRepositoryIncidentAccessV1({getPreview: () => preview});
    const p = access.createPermit({owner: o, declaration: decl(row, 'probe.elig.d'), clock: () => 100});
    const s = access.capture({permit: p.permit});
    const qr = queryRepositoryIncidentV1({path: PATH, fs: m4.fs, config: cfg, entryId: s.entryId, now: 100});
    show('redacted capture/query', J([s.status, qr.status, qr.reason, 'journalSha256 null? ' + (qr.journalSha256 === null), 'entryId null? ' + (qr.entryId === null)]));
    show('T7 INVALID_OBSERVATION (redacted on disk)', brief(decide({projectId, query: qr, plan})));
  }

  console.log('\n=== T13 project isolation at the decision boundary ===');
  show('projectId differs from row.binding.taskFingerprint', brief(decide({projectId: 'task:' + '1'.repeat(64), query: qa, plan})));

  console.log('\n=== T16 plan refusals (real refusal envelopes) ===');
  for (const code of ['INVALID_INPUT', 'INVALID_PREVIEW', 'PREVIEW_MISMATCH', 'ROW_MISSING', 'ROW_NOT_FAILURE', 'UNSUPPORTED_STAGE', 'SOURCE_MISMATCH', 'INVALID_EVIDENCE', 'ARTIFACT_LIMIT', 'HOST_NOT_SETTLED']) {
    const d = decide({projectId, query: qa, plan: nativeIncidentSourceRefusalV1(code)});
    show('plan REFUSED/' + code, J([d.status, d.reason, d.checks.source, d.sourcePlanDigest]));
  }
  show('real refusal from host for an unknown rowId', brief(decide({projectId, query: qa, plan: host.nativeIncidentSourcePlan({rowId: '0'.repeat(64)})})));

  console.log('\n=== T17 identity join (forged from the real envelopes) ===');
  const clone = (v) => JSON.parse(JSON.stringify(v));
  const withSel = (mut) => { const p = clone(plan); mut(p.selection); return p; };
  show('rowId differs', brief(decide({projectId, query: qa, plan: withSel((s) => { s.rowId = 'e'.repeat(64); })})));
  show('rowFingerprint differs', brief(decide({projectId, query: qa, plan: withSel((s) => { s.rowFingerprint = 'e'.repeat(64); })})));
  show('binding.attempt differs', brief(decide({projectId, query: qa, plan: withSel((s) => { s.binding.attempt = 7; })})));
  show('source.receiptSha256 differs', brief(decide({projectId, query: qa, plan: withSel((s) => { s.source.receiptSha256 = 'e'.repeat(64); })})));
  show('previewSha256 differs', brief(decide({projectId, query: qa, plan: withSel((s) => { s.previewSha256 = 'e'.repeat(64); })})));
  show('plan for eligible[1] against observation of eligible[0]', brief(decide({projectId, query: qa, plan: host.nativeIncidentSourcePlan({rowId: row2.rowId})})));

  console.log('\n=== T14/T15 row mapping ===');
  const fx = await combinedFixture(t, {});
  const bundle = createRepositoryRunBundleV1(fx.context), pv = createRepositoryIncidentPreviewV1({bundle, context: fx.context});
  const tRow = pv.rows.find((r) => r.binding.stage === 'tests' && r.classification === 'FAILURE_CANDIDATE');
  const tPlan = createNativeIncidentSourcePlanV1({bundle, context: fx.context, preview: pv, rowId: tRow.rowId});
  const tProject = 'task:' + tRow.binding.taskFingerprint;
  const qForged = (r, p) => ({...clone(qa), entryId: 'ric1.' + 'a'.repeat(64), observation: {...clone(qa.observation), previewSha256: p.sha256, row: clone(r)}});
  show('tests-stage FAILURE_CANDIDATE observation + plan ' + tPlan.reason, brief(decide({projectId: tProject, query: qForged(tRow, pv), plan: tPlan})));
  const passRow = pv.rows.find((r) => r.binding.stage === 'staticChecks' && r.classification === 'PASS');
  const passPlan = createNativeIncidentSourcePlanV1({bundle, context: fx.context, preview: pv, rowId: passRow.rowId});
  show('static PASS row (forged as stored) + real plan ' + passPlan.reason, brief(decide({projectId: tProject, query: qForged(passRow, pv), plan: passPlan})));
  // forged PASS row with a forged SOURCE_BOUND plan whose selection matches it: row cell must still refuse
  const forgedPlan = clone(plan); forgedPlan.selection.rowId = passRow.rowId; forgedPlan.selection.rowFingerprint = passRow.fingerprint; forgedPlan.selection.binding = clone(passRow.binding); forgedPlan.selection.source = clone(passRow.source); forgedPlan.selection.previewSha256 = pv.sha256; forgedPlan.selection.profile.rulesFingerprint = passRow.source.rulesetSha256;
  show('static PASS row + forged matching SOURCE_BOUND plan', brief(decide({projectId: tProject, query: qForged(passRow, pv), plan: forgedPlan})));

  console.log('\n=== T3/T4/T20 shape and hostile inputs ===');
  const inv = (label, v) => { let d; let threw = false; try { d = decide(v); } catch (e) { threw = true; } show(label, threw ? 'THREW' : J([d.status, d.reason, Object.values(d.checks).every((c) => c === 'NOT_EVALUATED'), d.entryId, d.journalSha256, d.sourcePlanDigest])); };
  inv('undefined', undefined); inv('null', null); inv('{}', {});
  inv('extra key', {projectId, query: qa, plan, x: 1});
  inv('missing plan', {projectId, query: qa});
  inv('symbol key', {projectId, query: qa, plan, [Symbol('s')]: 1});
  inv('getter projectId', Object.defineProperty({query: qa, plan}, 'projectId', {get: () => projectId, enumerable: true}));
  inv('class instance', Object.assign(Object.create({}), {projectId, query: qa, plan}));
  inv('projectId not task:', {projectId: 'proj', query: qa, plan});
  inv('query.sourceTrust other', {projectId, query: {...clone(qa), sourceTrust: 'ATTESTED'}, plan});
  inv('observation flag true', {projectId, query: {...clone(qa), observation: {...clone(qa.observation), executionAttested: true}}, plan});
  inv('row flag true', {projectId, query: {...clone(qa), observation: {...clone(qa.observation), row: {...clone(qa.observation.row), learningEligible: true}}}, plan});
  inv('T20 [REDACTED] in row.source.reportSha256 (forged AVAILABLE)', {projectId, query: {...clone(qa), observation: {...clone(qa.observation), row: {...clone(qa.observation.row), source: {...clone(qa.observation.row.source), reportSha256: '[REDACTED]'}}}}, plan});
  inv('[REDACTED] in failureCodes', {projectId, query: {...clone(qa), observation: {...clone(qa.observation), row: {...clone(qa.observation.row), failureCodes: ['[REDACTED]']}}}, plan});
  inv('plan.executionVerified true', {projectId, query: qa, plan: {...clone(plan), executionVerified: true}});
  inv('plan.requiresSeparateAdmission false', {projectId, query: qa, plan: {...clone(plan), requiresSeparateAdmission: false}});
  inv('plan SOURCE_BOUND selection null', {projectId, query: qa, plan: {...clone(plan), selection: null}});
  inv('plan REFUSED with selection', {projectId, query: qa, plan: {...clone(plan), status: 'REFUSED', reason: 'ROW_MISSING'}});
  inv('profile.modelParticipationRequired true', {projectId, query: qa, plan: withSel((s) => { s.profile.modelParticipationRequired = true; })});
  inv('profile.rulesFingerprint != source.rulesetSha256', {projectId, query: qa, plan: withSel((s) => { s.profile.rulesFingerprint = 'e'.repeat(64); })});
  inv('artifactByteLength 1 MiB + 1', {projectId, query: qa, plan: withSel((s) => { s.artifactByteLength = 1048577; })});
  inv('selection.binding.stage tests', {projectId, query: qa, plan: withSel((s) => { s.binding.stage = 'tests'; })});
  inv('query REFUSED with observation present', {projectId, query: {...clone(qa), status: 'REFUSED', reason: 'JOURNAL_UNAVAILABLE'}, plan});
  inv('query unknown status', {projectId, query: {...clone(qa), status: 'PENDING'}, plan});
  inv('query REFUSED unknown reason', {projectId, query: {...clone(qa), status: 'REFUSED', reason: 'PROJECT_MISMATCH', observation: null}, plan});
  inv('plan REFUSED unknown reason', {projectId, query: qa, plan: {...clone(plan), status: 'REFUSED', reason: 'BOGUS', selection: null, sourcePlanDigest: null}});
  inv('failureCodes unsorted', {projectId, query: {...clone(qa), observation: {...clone(qa.observation), row: {...clone(qa.observation.row), failureCodes: ['DET-003-REQUIRED-SECTIONS', 'DET-001-NONEMPTY']}}}, plan});
  const revokedProxy = (() => { const p = Proxy.revocable({}, {}); p.revoke(); return p.proxy; })();
  inv('revoked proxy', revokedProxy);
  inv('throwing getPrototypeOf trap', new Proxy({}, {getPrototypeOf() { throw new Error('trap'); }}));
  inv('throwing ownKeys inside query', {projectId, query: new Proxy({}, {ownKeys() { throw new TypeError('x'); }}), plan});
  inv('throwing index on failureCodes', {projectId, query: {...clone(qa), observation: {...clone(qa.observation), row: {...clone(qa.observation.row), failureCodes: Object.defineProperty([1], '0', {get() { throw new Error('i'); }, enumerable: true})}}}, plan});
  show('failureCodes with all four static codes (valid)', brief(decide({projectId, query: {...clone(qa), observation: {...clone(qa.observation), row: {...clone(qa.observation.row), failureCodes: ['DET-001-NONEMPTY', 'DET-002-UTF8', 'DET-003-JSON-STRUCTURE', 'DET-003-REQUIRED-SECTIONS']}}}, plan})));
} finally { for (const f of afters) await f(); }
