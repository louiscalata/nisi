// A real Apple Foundation Models executor for the bounded dispatcher.
//
// This is the piece that actually reaches the model. It spawns the reviewed
// `Veritas AFM Functional Probe` binary once per packet, hash-pinned before
// every launch, and hands the result to the probe evidence reader that already
// exists — the closed reader with its own mutation-tested refusals — rather than
// interpreting the bytes here.
//
// What it proves: that the model genuinely participated, up to four times
// concurrently, under one admitted run. What it deliberately does NOT do: send
// packet-specific or caller-supplied content to the model. The probe runs one
// fixed, reviewed experiment; the packet is bound to the observed receipt on
// this side. Sending arbitrary content is a consent boundary the design document
// gates separately, and nothing here crosses it.
//
// No argv, no environment passthrough, no model or endpoint override, no
// transcript. A hash is not an approval: the caller must already have approval
// for this exact binary.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { validateAFMProbeEvidence } from './scheduled-afm-probe.mjs';

const FLAGS = Object.freeze({ authorizing: false, modelExecuted: false,
  promotionGranted: false, certificationGranted: false });
const answer = (ok, code, fields = {}) => Object.freeze({ ...fields, ok, code, ...FLAGS });
const fail = (code, fields = {}) => answer(false, code, fields);
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const isHex64 = v => typeof v === 'string' && /^[0-9a-f]{64}$/.test(v);

/** Evidence lines are bounded; the reader itself refuses anything past 16 KiB. */
const MAX_EVIDENCE_BYTES = 16384;

function verifyBinary(binary, binarySHA256) {
  const stat = fs.lstatSync(binary);
  if (!stat.isFile()) throw new Error('BINARY_NOT_REGULAR_FILE');
  if (stat.size > 64 * 1024 * 1024) throw new Error('BINARY_TOO_LARGE');
  const observed = sha(fs.readFileSync(binary));
  if (observed !== binarySHA256) throw new Error('BINARY_DIGEST_MISMATCH');
  return observed;
}

/** Runs the reviewed probe once and returns its raw evidence line. */
function runProbe(binary, timeoutMs, signal) {
  return new Promise(resolve => {
    let child = null, timer = null, settled = false, out = Buffer.alloc(0), overflow = false;
    const finish = value => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      resolve(value);
    };
    const kill = () => { if (child && child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); };
    const onAbort = () => { kill(); finish({ code: 'ABORTED' }); };
    try {
      child = spawn(binary, [], {
        cwd: path.dirname(binary),
        env: { PATH: '/usr/bin:/bin' },      // no environment passthrough
        stdio: ['ignore', 'pipe', 'ignore'], // no stdin, stderr discarded
      });
    } catch { return finish({ code: 'SPAWN_ERROR' }); }
    timer = setTimeout(() => { kill(); finish({ code: 'DEADLINE_EXCEEDED' }); }, timeoutMs);
    signal?.addEventListener('abort', onAbort, { once: true });
    child.on('error', () => { kill(); finish({ code: 'SPAWN_ERROR' }); });
    child.stdout.on('data', chunk => {
      if (out.length + chunk.length > MAX_EVIDENCE_BYTES) { overflow = true; kill(); return; }
      out = Buffer.concat([out, chunk]);
    });
    child.once('close', (exitCode, sig) => {
      if (overflow) return finish({ code: 'EVIDENCE_OVERFLOW' });
      if (sig) return finish({ code: 'CHILD_SIGNALLED' });
      if (exitCode !== 0) return finish({ code: 'CHILD_EXIT_NONZERO' });
      finish({ code: 'OK', raw: out });
    });
  });
}

/** Binds one reviewed, hash-pinned probe binary as a dispatcher executor.
 *  The returned `execute` matches the shape the dispatcher's closed reader
 *  accepts: {ok, code, payloadSha256} and nothing else. */
export function createAFMExecutor(options) {
  try {
    const config = options && typeof options === 'object' && !Array.isArray(options) ? options : null;
    if (!config) return fail('CONFIGURATION_REFUSED');
    const allowed = ['binary', 'binarySHA256', 'timeoutMs'];
    if (!Object.keys(config).every(k => allowed.includes(k))) return fail('CONFIGURATION_REFUSED');
    const { binary, binarySHA256, timeoutMs = 45000 } = config;
    if (typeof binary !== 'string' || !path.isAbsolute(binary)) return fail('BINARY_ARGUMENTS');
    if (!isHex64(binarySHA256)) return fail('BINARY_ARGUMENTS');
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 50 || timeoutMs > 120000) return fail('DEADLINE_ARGUMENT');
    if (process.platform !== 'darwin' || process.arch !== 'arm64') return fail('PLATFORM');
    verifyBinary(binary, binarySHA256);   // refuses here if the binary is not the reviewed one

    // The dispatcher's closed reader accepts exactly {ok, code, payloadSha256},
    // so a refusal cause cannot ride back inside the returned value. Burying it
    // in the digest would make it unrecoverable, which is the opposite of an
    // exact refusal code, so causes are recorded here in arrival order and read
    // through `refusals()`.
    const refusals = [];
    const execute = async (packet, context = {}) => {
      const refuse = (cause, taskId) => {
        refusals.push(Object.freeze({ taskId: taskId ?? null, cause }));
        return Object.freeze({ ok: false, code: 'AFM_PACKET_UNAVAILABLE',
          payloadSha256: sha(Buffer.from(`veritas/afm-packet-refusal/v1\0${cause}`, 'utf8')) });
      };
      try {
        if (!Buffer.isBuffer(packet) || packet.length === 0) return refuse('PACKET_BYTES', context.taskId);
        // Re-verified before every launch: a binary swapped between packets is refused.
        verifyBinary(binary, binarySHA256);
        const run = await runProbe(binary, timeoutMs, context.signal);
        if (run.code !== 'OK') return refuse(run.code, context.taskId);
        // The existing probe evidence reader owns interpretation. It throws on
        // any unknown field, weakened check, forged receipt digest or claimed
        // authority, so nothing here re-decides what the evidence means.
        const evidence = validateAFMProbeEvidence(run.raw);
        if (evidence.modelParticipation !== 'PARTICIPATED') return refuse('MODEL_DID_NOT_PARTICIPATE', context.taskId);
        if (evidence.quiescent !== true) return refuse('MODEL_NOT_QUIESCENT', context.taskId);
        // Bind this packet to the participation actually observed for it.
        const payloadSha256 = sha(Buffer.from(
          `veritas/afm-packet-observation/v1\0${sha(packet)}\0${evidence.advisoryReceiptDigest}`, 'utf8'));
        return Object.freeze({ ok: true, code: 'AFM_PACKET_ANSWERED', payloadSha256 });
      } catch {
        return refuse('EVIDENCE_REFUSED', context.taskId);
      }
    };

    /** Refusal causes in arrival order. Read-only; never a verdict. */
    const readRefusals = () => Object.freeze(refusals.map(r => Object.freeze({ ...r })));

    return answer(true, 'READY_PRIVATE_AFM_EXECUTOR_ONLY', {
      execute, binarySHA256, refusals: readRefusals });
  } catch (error) {
    const code = error instanceof Error && typeof error.message === 'string'
      && ['BINARY_NOT_REGULAR_FILE', 'BINARY_TOO_LARGE', 'BINARY_DIGEST_MISMATCH'].includes(error.message)
      ? error.message : 'CONSTRUCTION_ERROR';
    return fail(code);
  }
}
