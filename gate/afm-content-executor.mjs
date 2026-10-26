// Copyright 2026 Louis Calata
// SPDX-License-Identifier: Apache-2.0

// Executor for consented content: the path the consent gate opens.
//
// A caller hands `execute` an opaque request (any non-empty bytes; only their
// digest is used, folded into the answer) and a task id. The task id selects one
// file from the `items` map fixed at construction. That file, and nothing else,
// is what reaches the model — and only if the grant admits it.
//
// Order matters and is not negotiable: the consent grant admits the item (which
// resolves symlinks, enforces the scope root, the kind, the byte ceiling and
// UTF-8) BEFORE any bytes are handed to a process. A request with no declared
// item, or an item the grant refuses, never reaches the model at all.
//
// The probe binary is hash-pinned and re-verified before every launch, takes no
// argv, receives only a fixed PATH environment and the artifact on stdin. The
// native helper reports digests, counts and a length-capped advisory string.
// Its persistence and network flags are validated self-reports, not independent
// observations. Binary validation/launch requires a stable trusted directory.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { canonicalizeJSONV1 } from '../canonical/canonical-json-v1.mjs';
import { createOwnedChildObserver } from '../hosts/swift-verifier/owned-child.mjs';

const FLAGS = Object.freeze({ authorizing: false, modelExecuted: false,
  promotionGranted: false, certificationGranted: false });
const answer = (ok, code, fields = {}) => Object.freeze({ ...fields, ok, code, ...FLAGS });
const fail = (code, fields = {}) => answer(false, code, fields);
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const isHex64 = v => typeof v === 'string' && /^[0-9a-f]{64}$/.test(v);

const MAX_EVIDENCE_BYTES = 16384;
export const APPLE_CONTENT_PROMPT_VERSION = 'nisi/apple-content-prompt/v1';
const LIMITATION_CODES = Object.freeze(['ADVISORY_READING_NON_AUTHORIZING', 'NO_ACCEPTANCE_OR_CERTIFICATION']);

/** Every refusal this executor can report. A cause outside this set would be an
 *  exception message leaking out where an exact code belongs, so it is mapped to
 *  the generic evidence refusal rather than surfaced. */
const KNOWN_CAUSES = Object.freeze(new Set([
  'REQUEST_BYTES', 'NO_CONTENT_FOR_REQUEST', 'ABORTED', 'SPAWN_ERROR', 'DEADLINE_EXCEEDED',
  'CHILD_SIGNALLED', 'CHILD_EXIT_NONZERO', 'EVIDENCE_OVERFLOW', 'EVIDENCE_REFUSED',
  'BINARY_NOT_REGULAR_FILE', 'BINARY_TOO_LARGE', 'BINARY_DIGEST_MISMATCH',
  'EVIDENCE_BYTES', 'EVIDENCE_SHAPE', 'EVIDENCE_SCHEMA', 'EVIDENCE_STATUS', 'EVIDENCE_CLASS',
  'EVIDENCE_DIGESTS', 'EVIDENCE_ADVISORY', 'EVIDENCE_LIMITATIONS', 'ADVISORY_OVER_CAP',
  'ADVISORY_DIGEST', 'MODEL_DID_NOT_PARTICIPATE', 'MODEL_IDENTITY', 'MODEL_NOT_QUIESCENT',
  'ROUTE_REFUSED', 'BOUNDARY_VIOLATED', 'CONSENT_DIGEST_MISMATCH', 'CONTENT_DIGEST_MISMATCH',
  'CONTENT_BYTES_MISMATCH', 'CONTENT_KIND_MISMATCH',
  'CONTEXT_INVALID', 'PROMPT_DIGEST_MISMATCH',
  'CHILD_OWNER_BUSY', 'CHILD_OWNER_QUARANTINED', 'CHILD_CLOSE_UNKNOWN', 'EXECUTOR_STOPPED',
]));

const EVIDENCE_KEYS = ['schemaVersion', 'status', 'evidenceClass', 'consentDigest', 'contentSha256',
  'contentBytes', 'kind', 'promptSha256', 'advisory', 'advisoryChars', 'advisorySha256',
  'modelParticipation', 'modelIdentityStatus', 'route', 'quiescent', 'contentPersisted',
  'transcriptPersisted', 'networkEgress', 'externalToolsEnabled', 'acceptanceAuthorityGranted',
  'limitationCodes'];

/** Closed reader over the content probe's evidence. Anything outside the declared
 *  shape, or any claimed authority, is refused rather than interpreted. */
function readEvidence(raw, admitted) {
  if (!Buffer.isBuffer(raw) || raw.length < 2 || raw.length > MAX_EVIDENCE_BYTES) throw new Error('EVIDENCE_BYTES');
  let value;
  // The restricted codec rejects malformed UTF-8, duplicate keys and malformed
  // Unicode before the schema reader sees an unambiguous JSON value.
  try { value = JSON.parse(canonicalizeJSONV1(raw).canonical); } catch { throw new Error('EVIDENCE_REFUSED'); }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('EVIDENCE_SHAPE');
  if (Object.keys(value).sort().join('|') !== [...EVIDENCE_KEYS].sort().join('|')) throw new Error('EVIDENCE_SCHEMA');
  if (value.schemaVersion !== 1 || value.status !== 'PASS') throw new Error('EVIDENCE_STATUS');
  if (value.evidenceClass !== 'CONSENTED_CONTENT_ADVISORY_READING') throw new Error('EVIDENCE_CLASS');
  if (value.modelParticipation !== 'PARTICIPATED') throw new Error('MODEL_DID_NOT_PARTICIPATE');
  if (value.modelIdentityStatus !== 'MODEL_ID_NOT_EXPOSED_BY_API') throw new Error('MODEL_IDENTITY');
  if (value.route !== 'system-on-device-requested') throw new Error('ROUTE_REFUSED');
  if (value.quiescent !== true) throw new Error('MODEL_NOT_QUIESCENT');
  // The boundary facts the grant asserts must come back false, every time.
  for (const key of ['contentPersisted', 'transcriptPersisted', 'networkEgress',
                     'externalToolsEnabled', 'acceptanceAuthorityGranted']) {
    if (value[key] !== false) throw new Error('BOUNDARY_VIOLATED');
  }
  // The probe must have read exactly the item the grant admitted, under exactly
  // the grant that admitted it.
  if (value.consentDigest !== admitted.consentDigest) throw new Error('CONSENT_DIGEST_MISMATCH');
  if (value.contentSha256 !== admitted.contentSha256) throw new Error('CONTENT_DIGEST_MISMATCH');
  if (value.contentBytes !== admitted.contentBytes) throw new Error('CONTENT_BYTES_MISMATCH');
  if (value.kind !== admitted.kind) throw new Error('CONTENT_KIND_MISMATCH');
  if (!isHex64(value.promptSha256) || !isHex64(value.advisorySha256)) throw new Error('EVIDENCE_DIGESTS');
  // Foundation's UTF-8 String decoder consumes an initial BOM, like TextDecoder.
  const text = new TextDecoder('utf-8', { fatal: true }).decode(admitted.bytes);
  const expectedPrompt = Buffer.from(`File kind: ${admitted.kind}\n\n${text}`, 'utf8');
  if (value.promptSha256 !== sha(expectedPrompt)) throw new Error('PROMPT_DIGEST_MISMATCH');
  if (typeof value.advisory !== 'string') throw new Error('EVIDENCE_ADVISORY');
  if (value.advisory.length !== value.advisoryChars) throw new Error('EVIDENCE_ADVISORY');
  if (value.advisoryChars > admitted.maxAdvisoryChars) throw new Error('ADVISORY_OVER_CAP');
  if (sha(Buffer.from(value.advisory, 'utf8')) !== value.advisorySha256) throw new Error('ADVISORY_DIGEST');
  if (!Array.isArray(value.limitationCodes) || value.limitationCodes.length !== LIMITATION_CODES.length ||
      value.limitationCodes.some((code, index) => code !== LIMITATION_CODES[index])) throw new Error('EVIDENCE_LIMITATIONS');
  return Object.freeze({ ...value, limitationCodes: Object.freeze([...value.limitationCodes]) });
}

function verifyBinary(binary, binarySHA256) {
  const stat = fs.lstatSync(binary);
  if (!stat.isFile()) throw new Error('BINARY_NOT_REGULAR_FILE');
  if (stat.size > 64 * 1024 * 1024) throw new Error('BINARY_TOO_LARGE');
  if (sha(fs.readFileSync(binary)) !== binarySHA256) throw new Error('BINARY_DIGEST_MISMATCH');
}


/** Binds a consent grant, a hash-pinned probe, and the per-request content map.
 *  `items` maps a task id to the one file that request is about. A request with
 *  no entry is refused before the grant is even consulted. */
export function createAFMContentExecutor(options) {
  try {
    const config = options && typeof options === 'object' && !Array.isArray(options) ? options : null;
    if (!config) return fail('CONFIGURATION_REFUSED');
    const allowed = ['binary', 'binarySHA256', 'grant', 'items', 'timeoutMs'];
    if (!Object.keys(config).every(k => allowed.includes(k))) return fail('CONFIGURATION_REFUSED');
    const { binary, binarySHA256, grant, items, timeoutMs = 60000 } = config;
    if (typeof binary !== 'string' || !path.isAbsolute(binary) || !isHex64(binarySHA256)) return fail('BINARY_ARGUMENTS');
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 50 || timeoutMs > 120000) return fail('DEADLINE_ARGUMENT');
    if (!grant || typeof grant.admitContent !== 'function') return fail('CONSENT_REQUIRED');
    if (items === null || typeof items !== 'object' || Array.isArray(items)) return fail('ITEMS_REFUSED');
    let fixedItems;
    try {
      const keys = Reflect.ownKeys(items);
      if (keys.length === 0) return fail('ITEMS_REFUSED');
      fixedItems = Object.freeze(Object.fromEntries(keys.map(id => {
      if (typeof id !== 'string') throw new Error('ITEMS_REFUSED');
      const item = items[id];
      if (!item || typeof item !== 'object' || Array.isArray(item) ||
          Reflect.ownKeys(item).length !== 2 || !Object.hasOwn(item, 'filePath') || !Object.hasOwn(item, 'kind') ||
          typeof item.filePath !== 'string' || typeof item.kind !== 'string') throw new Error('ITEMS_REFUSED');
      return [id, Object.freeze({ filePath: item.filePath, kind: item.kind })];
    }))); } catch { return fail('ITEMS_REFUSED'); }
    verifyBinary(binary, binarySHA256);

    const refusals = [];
    const readings = [];
    const observations = [];
    let stopped = false, activeController = null;
    const owner = createOwnedChildObserver({timeoutMs,maximumOutputBytes:MAX_EVIDENCE_BYTES,stderrPolicy:'ignore',
      launch:()=>spawn(binary,[],{cwd:path.dirname(binary),env:{PATH:'/usr/bin:/bin'},shell:false,stdio:['pipe','pipe','pipe']})});
    const state = () => stopped ? (owner.status()==='BUSY'?'STOPPED_DRAINING':owner.status()==='QUARANTINED'?'STOPPED_QUARANTINED':'STOPPED') : owner.status();
    const refuse = (rawCause, taskId) => {
      // A grant's own refusal keeps its code, prefixed so its origin is legible.
      const cause = KNOWN_CAUSES.has(rawCause) || rawCause.startsWith('CONSENT_') ? rawCause : 'EVIDENCE_REFUSED';
      refusals.push(Object.freeze({ taskId: typeof taskId === 'string' ? taskId : null, cause }));
      return Object.freeze({ ok: false, code: 'AFM_PACKET_UNAVAILABLE',
        payloadSha256: sha(Buffer.from(`nisi/content-refusal/v1\0${cause}`, 'utf8')) });
    };

    const execute = async (packet, context = {}) => {
      let taskId = null;
      let upstream = null, forwardAbort = null, controller = null;
      try {
        if (!context || typeof context !== 'object' || Array.isArray(context)) return refuse('CONTEXT_INVALID', taskId);
        taskId = context.taskId ?? null;
        const signal = context.signal;
        if (signal !== undefined && !(signal instanceof AbortSignal)) return refuse('CONTEXT_INVALID', taskId);
        if (signal?.aborted) return refuse('ABORTED', taskId);
        if (stopped) return refuse('EXECUTOR_STOPPED', taskId);
        if (owner.status() !== 'IDLE') return refuse(`CHILD_OWNER_${owner.status()}`, taskId);
        if (!Buffer.isBuffer(packet) || packet.length === 0) return refuse('REQUEST_BYTES', taskId);
        if (packet.buffer instanceof SharedArrayBuffer) return refuse('REQUEST_BYTES', taskId);
        const requestSha256 = sha(packet);
        if (typeof taskId !== 'string' || !Object.hasOwn(fixedItems, taskId)) return refuse('NO_CONTENT_FOR_REQUEST', taskId);

        // The gate runs first. Nothing is spawned, and no bytes leave this
        // process, unless the grant admits this exact item right now.
        const admitted = grant.admitContent(fixedItems[taskId]);
        if (!admitted.ok) return refuse(`CONSENT_${admitted.code}`, taskId);

        verifyBinary(binary, binarySHA256);
        const header = JSON.stringify({
          consentDigest: admitted.consentDigest,
          contentSha256: admitted.contentSha256,
          contentBytes: admitted.contentBytes,
          maxAdvisoryChars: admitted.maxAdvisoryChars,
          kind: admitted.kind,
        });
        const input = Buffer.concat([Buffer.from(header + '\n', 'utf8'), admitted.bytes]);
        controller = new AbortController(); activeController = controller;
        upstream = signal; forwardAbort = () => controller.abort();
        upstream?.addEventListener('abort', forwardAbort, {once:true});
        if (upstream?.aborted || stopped) controller.abort();
        const observation = await owner.run({input,signal:controller.signal,validate:raw=>{
          try {return {evidence:readEvidence(raw,admitted)};}
          catch(error){if(KNOWN_CAUSES.has(error?.message))error.code=error.message;throw error;}
        }});
        observations.push(observation);
        if (observations.length > 64) observations.shift();
        if (observation.cause !== null) {
          const map={CHILD_OUTPUT_LIMIT:'EVIDENCE_OVERFLOW',CHILD_PROCESS_ERROR:'SPAWN_ERROR',CHILD_LAUNCH_ERROR:'SPAWN_ERROR',CHILD_STDIN_ERROR:'SPAWN_ERROR',CHILD_STDOUT_ERROR:'SPAWN_ERROR',CHILD_STDERR_ERROR:'SPAWN_ERROR'};
          const cause=observation.cause==='CHILD_TERMINATION_INCONCLUSIVE'
            ? observation.process.signal ? 'CHILD_SIGNALLED' : observation.process.closed ? 'CHILD_EXIT_NONZERO' : 'CHILD_CLOSE_UNKNOWN'
            : map[observation.cause] ?? observation.cause;
          return refuse(cause,taskId);
        }
        if (controller.signal.aborted || stopped) return refuse(stopped?'EXECUTOR_STOPPED':'ABORTED',taskId);
        const raw=Buffer.from(observation.stdoutHex,'hex');
        const evidence = observation.validated.evidence;
        const executionSha256 = sha(Buffer.from(`nisi/content-execution/v1\0${APPLE_CONTENT_PROMPT_VERSION}\0` +
          `${sha(Buffer.from(taskId, 'utf8'))}\0${binarySHA256}\0${requestSha256}\0${canonicalizeJSONV1(raw).sha256}`, 'utf8'));
        readings.push(Object.freeze({
          taskId,
          contentSha256: evidence.contentSha256,
          advisory: evidence.advisory,
          advisoryChars: evidence.advisoryChars,
          promptSha256: evidence.promptSha256,
          promptVersion: APPLE_CONTENT_PROMPT_VERSION,
          binarySHA256,
          executionSha256,
          evidence,
        }));
        const payloadSha256 = sha(Buffer.from(
          `nisi/content-observation/v1\0${requestSha256}\0${evidence.consentDigest}\0` +
          `${evidence.contentSha256}\0${evidence.advisorySha256}`, 'utf8'));
        return Object.freeze({ ok: true, code: 'AFM_PACKET_ANSWERED', payloadSha256 });
      } catch (error) {
        const cause = error instanceof Error && typeof error.message === 'string' ? error.message : 'EVIDENCE_REFUSED';
        return refuse(cause, taskId);   // refuse() maps anything undeclared to EVIDENCE_REFUSED
      } finally {
        try { upstream?.removeEventListener('abort',forwardAbort); } catch {}
        if(controller && activeController===controller) activeController=null;
      }
    };

    return answer(true, 'READY_PRIVATE_AFM_CONTENT_EXECUTOR_ONLY', {
      execute,
      binarySHA256,
      status:state,
      stop:()=>{stopped=true;activeController?.abort();},
      observations:()=>Object.freeze([...observations]),
      refusals: () => Object.freeze(refusals.map(r => Object.freeze({ ...r }))),
      readings: () => Object.freeze(readings.map(r => Object.freeze({ ...r }))),
    });
  } catch (error) {
    const known = ['BINARY_NOT_REGULAR_FILE', 'BINARY_TOO_LARGE', 'BINARY_DIGEST_MISMATCH', 'ITEMS_REFUSED'];
    const code = error instanceof Error && known.includes(error.message) ? error.message : 'CONSTRUCTION_ERROR';
    return fail(code);
  }
}
