// Mutation runner over the scratchpad sketch: applies single-line string mutants,
// runs a compact oracle built from REAL producer output, reports killed/survived.
import fs from 'node:fs';
import path from 'node:path';
const R = '/Users/louiscalata/nisi-next-private/';
const HERE = path.dirname(new URL(import.meta.url).pathname);
const {createPagedIncidentHostFixture} = await import(R + 'tests/helpers/incident-review-fixture.mjs');
const {nativeIncidentSourceRefusalV1} = await import(R + 'hosts/repository/native-incident-source-v1.mjs');
const {queryRepositoryIncidentV1} = await import(R + 'history/repository-incident-capture-v1.mjs');
const {openJournalOwner} = await import(R + 'history/journal-owner-v2.mjs');
const {memfs} = await import(R + 'tests/journal-owner-v2.memfs.mjs');

const {host, preview, eligible} = await createPagedIncidentHostFixture();
const row = eligible[0];
const plan = host.nativeIncidentSourcePlan({rowId: row.rowId});
const projectId = 'task:' + row.binding.taskFingerprint;
const config = {projectId, maxEntries: 32, heartbeatTtlMs: 30000, redactPaths: []};
const PATH = '/j/incidents.jsonl';
const m = memfs();
const owner = openJournalOwner({path: PATH, fs: m.fs, config, now: 100}).owner;
const declaration = {schemaVersion: 'nisi-repository-incident-declaration/v1', declarationId: 'mut.a', projectId, rowId: row.rowId, rowFingerprint: row.fingerprint, previewSha256: preview.sha256, issuedAt: 100, expiresAt: 1000, createdAt: 100, retentionMs: 10000, consentClass: 'WRITTEN_DECLARATION', destination: 'LOCAL_INCIDENT_OBSERVATION_ONLY', rawContentPersisted: false, networkEgress: false, learningInfluence: false};
const stored = host.captureIncident({permit: host.createIncidentPermit({owner, declaration, clock: () => 100}).permit});
const q = (over = {}) => queryRepositoryIncidentV1({path: PATH, fs: m.fs, config, entryId: stored.entryId, now: 100, ...over});
const qa = q();
const clone = (v) => JSON.parse(JSON.stringify(v));
const withSel = (mut) => { const p = clone(plan); mut(p.selection); return p; };
const withRow = (mut) => { const qq = clone(qa); mut(qq.observation.row); return qq; };
const deepFrozen = (v) => v === null || typeof v !== 'object' || (Object.isFrozen(v) && Object.values(v).every(deepFrozen));
const m2 = memfs(); { const lines = m.bytes(PATH).toString('utf8').trimEnd().split('\n'); m2.seed(PATH, Buffer.from(lines.slice(0, -1).join('\n') + '\n')); }

const oracle = [
  ['T1 baseline ELIGIBLE + constants + frozen', (d) => { const o = d({projectId, query: qa, plan}); return o.status === 'ELIGIBLE' && o.reason === null && Object.values(o.checks).every((c) => c === 'OK') && o.admitted === false && o.authorizing === false && o.learningEnabled === false && deepFrozen(o) && JSON.stringify(Object.keys(o)) === JSON.stringify(['schemaVersion', 'status', 'reason', 'checks', 'entryId', 'journalSha256', 'sourcePlanDigest', 'authorizing', 'admitted', 'learningEnabled']); }],
  ['T3 extra key -> INVALID_INPUT', (d) => d({projectId, query: qa, plan, x: 1}).reason === 'INVALID_INPUT'],
  ['T3 row.sourceTrust other -> INVALID_INPUT', (d) => d({projectId, query: withRow((r) => { r.sourceTrust = 'ATTESTED'; }), plan}).reason === 'INVALID_INPUT'],
  ['T5 JOURNAL_UNAVAILABLE -> UNCERTAIN', (d) => { const o = d({projectId, query: q({config: {...config, projectId: 'task:' + '0'.repeat(64)}}), plan}); return o.status === 'UNCERTAIN' && o.reason === 'JOURNAL_UNAVAILABLE'; }],
  ['T6 JOURNAL_NOT_OPEN -> UNCERTAIN', (d) => { const o = d({projectId, query: q({fs: m2.fs}), plan}); return o.status === 'UNCERTAIN' && o.reason === 'JOURNAL_NOT_OPEN'; }],
  ['T8 query INVALID_INPUT -> INELIGIBLE/INVALID_OBSERVATION', (d) => { const o = d({projectId, query: q({now: -0}), plan}); return o.status === 'INELIGIBLE' && o.reason === 'INVALID_OBSERVATION' && o.checks.observation === 'INVALID_INPUT'; }],
  ['T9 MISSING -> INELIGIBLE/MISSING', (d) => { const o = d({projectId, query: q({path: '/j/none.jsonl'}), plan}); return o.status === 'INELIGIBLE' && o.reason === 'MISSING'; }],
  ['T11 EXPIRED -> INELIGIBLE/EXPIRED', (d) => { const o = d({projectId, query: q({now: 10100}), plan}); return o.status === 'INELIGIBLE' && o.reason === 'EXPIRED'; }],
  ['T13 PROJECT_MISMATCH', (d) => d({projectId: 'task:' + '1'.repeat(64), query: qa, plan}).reason === 'PROJECT_MISMATCH'],
  ['T14 tests-stage observation -> UNSUPPORTED_STAGE', (d) => { const qq = clone(qa); const r = qq.observation.row; r.binding.stage = 'tests'; r.binding.checkIndex = 0; r.source.planFingerprint = null; r.source.groupFingerprint = null; r.subject = {kind: 'MATERIALIZED_TREE', pathSha256: null, contentSha256: null}; r.failureCodes = ['NODE_ASSERTION_94c3a77dc4620ffd']; const o = d({projectId, query: qq, plan: nativeIncidentSourceRefusalV1('UNSUPPORTED_STAGE')}); return o.reason === 'UNSUPPORTED_STAGE' && o.checks.row === 'UNSUPPORTED_STAGE' && o.checks.source === 'NOT_EVALUATED'; }],
  ['T15 quadruple: each cell off alone -> ROW_NOT_FAILURE', (d) => [['classification', 'PASS'], ['reason', 'RECORDED_PASS'], ['rawStatus', 'ERROR'], ['stageStatus', 'PASS'], ['disposition', 'ENGINE_INTERRUPTED']].every(([k, v]) => d({projectId, query: withRow((r) => { r[k] = v; }), plan}).reason === 'ROW_NOT_FAILURE')],
  ['T16 plan refusals verbatim, INVALID_INPUT collapses', (d) => ['INVALID_PREVIEW', 'PREVIEW_MISMATCH', 'ROW_MISSING', 'ROW_NOT_FAILURE', 'UNSUPPORTED_STAGE', 'SOURCE_MISMATCH', 'INVALID_EVIDENCE', 'ARTIFACT_LIMIT', 'HOST_NOT_SETTLED'].every((c) => { const o = d({projectId, query: qa, plan: nativeIncidentSourceRefusalV1(c)}); return o.status === 'INELIGIBLE' && o.reason === c && o.checks.source === c; }) && (() => { const o = d({projectId, query: qa, plan: nativeIncidentSourceRefusalV1('INVALID_INPUT')}); return o.reason === 'INVALID_EVIDENCE' && o.checks.source === 'INVALID_INPUT'; })()],
  ['T17 rowId -> ROW_MISMATCH', (d) => d({projectId, query: qa, plan: withSel((s) => { s.rowId = 'e'.repeat(64); })}).reason === 'ROW_MISMATCH'],
  ['T17 fingerprint -> CONFLICT', (d) => d({projectId, query: qa, plan: withSel((s) => { s.rowFingerprint = 'e'.repeat(64); })}).reason === 'CONFLICT'],
  ['T17 binding.attempt -> CONFLICT', (d) => d({projectId, query: qa, plan: withSel((s) => { s.binding.attempt = 7; })}).reason === 'CONFLICT'],
  ['T17 source.receiptSha256 -> CONFLICT', (d) => d({projectId, query: qa, plan: withSel((s) => { s.source.receiptSha256 = 'e'.repeat(64); })}).reason === 'CONFLICT'],
  ['T17 previewSha256 -> PREVIEW_MISMATCH', (d) => d({projectId, query: qa, plan: withSel((s) => { s.previewSha256 = 'e'.repeat(64); })}).reason === 'PREVIEW_MISMATCH'],
  ['T20 [REDACTED] failure code -> INVALID_INPUT', (d) => d({projectId, query: withRow((r) => { r.failureCodes = ['[REDACTED]']; }), plan}).reason === 'INVALID_INPUT'],
  ['T20 [REDACTED] digest -> INVALID_INPUT', (d) => d({projectId, query: withRow((r) => { r.source.reportSha256 = '[REDACTED]'; }), plan}).reason === 'INVALID_INPUT'],
  ['T4 hostile never throws', (d) => { try { return d(new Proxy({}, {getPrototypeOf() { throw new Error('t'); }})).reason === 'INVALID_INPUT'; } catch { return false; } }],
];

const src = fs.readFileSync(path.join(HERE, 'eligibility-sketch.mjs'), 'utf8');
const mutants = [
  ['M1 source gate disabled', "if (plan.status !== 'SOURCE_BOUND')", "if (false && plan.status !== 'SOURCE_BOUND')"],
  ['M2 fingerprint compare dropped', 'sel.rowFingerprint !== row.fingerprint ||', 'false ||'],
  ['M3 JOURNAL_* mapped INELIGIBLE', "return out('UNCERTAIN', query.reason); }", "return out('INELIGIBLE', query.reason); }"],
  ['M4 lifecycle mapped UNCERTAIN', "checks.observation = query.status; return out('INELIGIBLE', query.status);", "checks.observation = query.status; return out('UNCERTAIN', query.status);"],
  ['M5 project check dropped', "if ('task:' + row.binding.taskFingerprint !== projectId)", 'if (false)'],
  ['M6 stage gate dropped', "if (row.binding.stage !== 'staticChecks') { checks.row", "if (false) { checks.row"],
  ['M7a classification cond dropped', "row.classification !== 'FAILURE_CANDIDATE' ||", 'false ||'],
  ['M7b rawStatus cond dropped', "row.rawStatus !== 'FAIL' ||", 'false ||'],
  ['M7c disposition cond dropped', "|| row.disposition !== 'RESULT_RECORDED')", '|| false)'],
  ['M8 admitted derived from status', 'admitted: false, learningEnabled: false', "admitted: status === 'ELIGIBLE', learningEnabled: false"],
  ['M9 checks not frozen', 'checks: Object.freeze(cells)', 'checks: cells'],
  ['M10 record length check weakened', 'if (own.length !== keys.length) invalid();', 'if (own.length < keys.length) invalid();'],
  ['M11 query refusal mapped UNCERTAIN', "checks.observation = query.reason; return out('INELIGIBLE', 'INVALID_OBSERVATION');", "checks.observation = query.reason; return out('UNCERTAIN', 'INVALID_OBSERVATION');"],
  ['M12 plan INVALID_INPUT passthrough', "plan.reason === 'INVALID_INPUT' ? 'INVALID_EVIDENCE' : plan.reason", 'plan.reason'],
  ['M13 preview compare dropped', 'if (sel.previewSha256 !== obs.previewSha256)', 'if (false)'],
  ['M14 binding compare dropped', 'BINDING_KEYS.some((k) => sel.binding[k] !== row.binding[k]) ||', 'false ||'],
  ['M14b source compare dropped', '|| SOURCE_KEYS.some((k) => sel.source[k] !== row.source[k])', '|| false'],
  ['M15 failure-code vocabulary dropped', "if (b.stage === 'staticChecks' ? !STATIC_CODES.has(c) : !NODE_CODE.test(c)) invalid();", 'if (false) invalid();'],
  ['M16 row.sourceTrust literal dropped', "if (r.sourceTrust !== 'TRUSTED_HOST_STATEMENTS_NOT_ATTESTED') invalid();", ''],
  ['M17 JOURNAL_NOT_OPEN not uncertain', "(query.reason === 'JOURNAL_UNAVAILABLE' || query.reason === 'JOURNAL_NOT_OPEN')", "(query.reason === 'JOURNAL_UNAVAILABLE')"],
  ['M18 rowId compare dropped', 'if (sel.rowId !== row.rowId)', 'if (false)'],
  ['M19 [REDACTED]-style hex check weakened', 'else if (!isHex(s[k])) invalid();', 'else if (typeof s[k] !== "string") invalid();'],
  ['M20 try/catch removed (throws on hostile)', 'catch {\n    return result', 'catch (e) { if (!(e instanceof Invalid)) throw e;\n    return result'],
];
let survived = 0;
for (const [name, from, to] of mutants) {
  if (!src.includes(from)) { console.log('MUTANT NOT APPLICABLE:', name); survived++; continue; }
  const file = path.join(HERE, 'mutant-tmp.mjs');
  fs.writeFileSync(file, src.replace(from, to));
  const {decideIncidentEligibilityV1: d} = await import(file + '?v=' + Math.random());
  const killers = [];
  for (const [t, fn] of oracle) { let ok; try { ok = fn(d); } catch { ok = false; } if (!ok) killers.push(t); }
  console.log((killers.length ? 'KILLED  ' : 'SURVIVED') + ' ' + name + (killers.length ? '  by: ' + killers.join(' | ') : ''));
  if (!killers.length) survived++;
  fs.unlinkSync(file);
}
const {decideIncidentEligibilityV1: base} = await import(path.join(HERE, 'eligibility-sketch.mjs'));
const baseFails = oracle.filter(([, fn]) => { try { return !fn(base); } catch { return true; } }).map(([t]) => t);
console.log('baseline oracle: ' + (oracle.length - baseFails.length) + '/' + oracle.length + ' pass' + (baseFails.length ? '  FAILING: ' + baseFails.join(' | ') : ''));
console.log('survivors: ' + survived);
