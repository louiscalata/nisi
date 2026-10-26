// PRIVATE internal lifecycle primitive. launch/validate are trusted host code;
// this module grants no command authority. Product wrapper fixes the executable.
import { cloneFreeze } from '../../workflow/contracts.mjs';
import { hashBytes } from './protocol.mjs';

const fail = code => { throw Object.assign(new Error(code), { code }); };
const integer = (v, min, max) => Number.isSafeInteger(v) && v >= min && v <= max;
export function createOwnedChildObserver({ launch, timeoutMs, closeGraceMs = 500, maximumOutputBytes = 16_384,
  now = () => Math.floor(performance.now()), stderrPolicy = 'reject', expectedExitCode = 0 }) {
  if (typeof launch !== 'function' || typeof now !== 'function' || !integer(timeoutMs, 1, 120_000) ||
      !['reject','ignore'].includes(stderrPolicy) ||
      !integer(expectedExitCode, 0, 255) ||
      !integer(closeGraceMs, 1, 2000) || !integer(maximumOutputBytes, 1, 1_048_576)) fail('CHILD_OWNER_CONFIG');
  let state = 'IDLE';
  let sequence = 0;
  const late = [];
  const status = () => state;
  async function run({ input, signal, validate }) {
    if (state !== 'IDLE') fail(state === 'QUARANTINED' ? 'CHILD_OWNER_QUARANTINED' : 'CHILD_OWNER_BUSY');
    if (!Buffer.isBuffer(input) || input.length > 1_052_676 || typeof validate !== 'function' ||
        (signal !== undefined && !(signal instanceof AbortSignal))) fail('CHILD_OWNER_INPUT');
    const capturedInput = Buffer.from(input);
    const operation = ++sequence;
    state = 'BUSY';
    return new Promise(resolve => {
      let child = null, started = false, exited = false, closeObserved = false, launchCalled = false;
      let closedCode = null, closedSignal = null, firstCause = null, errorCode = null;
      let cancelRequested = false, deadlineExceeded = false, done = false, timer = null, grace = null;
      let killRequested = false, killReturned = null, killAtMs = null, previous = null, began = null;
      const streams = { stdout: { chunks: [], captured: 0, observed: 0 }, stderr: { chunks: [], captured: 0, observed: 0 } };
      const clock = () => {
        const value = now();
        if (!integer(value, 0, Number.MAX_SAFE_INTEGER) || (previous !== null && value < previous)) throw new Error();
        previous = value; return value;
      };
      const elapsed = () => began === null || previous === null ? 0 : previous - began;
      const remember = (code, kind = 'error') => {
        if (firstCause === null) { firstCause = code; if (kind === 'error') errorCode = code; }
      };
      const kill = () => {
        // Never signal after observed exit/close, even while pipes remain open.
        if (!child || !started || exited || closeObserved || killRequested ||
            child.exitCode !== null || child.signalCode !== null) return;
        killRequested = true; killAtMs = elapsed();
        try { killReturned = child.kill('SIGKILL') === true; }
        catch { killReturned = false; }
      };
      const guard = () => {
        if (signal?.aborted) { cancelRequested = true; remember('ABORTED', 'interruption'); }
        try {
          clock();
          if (began !== null && elapsed() >= timeoutMs) {
            deadlineExceeded = true; cancelRequested = true; remember('DEADLINE_EXCEEDED', 'interruption');
          }
        } catch { remember('CHILD_CLOCK_INVALID'); }
      };
      const stop = (code, kind) => {
        if (done) return;
        remember(code, kind);
        try { clock(); } catch { remember('CHILD_CLOCK_INVALID'); }
        kill();
        if (!done && grace === null) grace = setTimeout(() => finish(), closeGraceMs);
      };
      const onAbort = () => { cancelRequested = true; stop('ABORTED', 'interruption'); };
      const capture = name => chunk => {
        if (done) return; // attached consumer still drains; receipt stays immutable
        if (!Buffer.isBuffer(chunk)) { stop('CHILD_OUTPUT_TYPE'); return; }
        const stream = streams[name];
        if (!Number.isSafeInteger(stream.observed + chunk.length)) { stop('CHILD_OUTPUT_COUNT'); return; }
        stream.observed += chunk.length;
        const count = Math.min(chunk.length, maximumOutputBytes - stream.captured);
        if (count > 0) { stream.chunks.push(Buffer.from(chunk.subarray(0, count))); stream.captured += count; }
        if (stream.observed > maximumOutputBytes) stop('CHILD_OUTPUT_LIMIT');
      };
      const finish = () => {
        if (done) return;
        guard();
        if (!firstCause && !closeObserved) remember('CHILD_CLOSE_UNKNOWN', 'interruption');
        const stdout = Buffer.concat(streams.stdout.chunks), stderr = Buffer.concat(streams.stderr.chunks);
        let validated = null;
        if (!firstCause) {
          // Exact constructor-bound exit policy, not an allowlist of successes.
          // Default remains zero; fixed negative fixtures explicitly require 70.
          if (!started || closedCode !== expectedExitCode || closedSignal !== null) remember('CHILD_TERMINATION_INCONCLUSIVE', 'interruption');
          else if (stderr.length > 0) remember('CHILD_STDERR_UNEXPECTED');
          else {
            try { validated = cloneFreeze(validate(stdout)); }
            catch (error) { remember(typeof error?.code === 'string' && /^[A-Z][A-Z0-9_]{0,95}$/u.test(error.code)
              ? error.code : 'CHILD_RESPONSE_INVALID'); }
          }
        }
        // Validation may synchronously abort or take us past the deadline.
        // This check, freeze and publication contain no awaits/event-loop gap.
        guard();
        const output = name => ({ capturedBytes: streams[name].captured, observedBytes: streams[name].observed,
          sha256: hashBytes(name === 'stdout' ? stdout : stderr), truncated: streams[name].observed > streams[name].captured });
        const reusable = closeObserved || !launchCalled;
        state = reusable ? 'IDLE' : 'QUARANTINED';
        const prepared = cloneFreeze({ schemaVersion: 1,
          process: { started, closed: started && closeObserved,
            drain: !started ? 'NOT_APPLICABLE' : closeObserved ? 'CONFIRMED' : 'UNKNOWN',
            exitCode: started && closeObserved ? closedCode : null, signal: started && closeObserved ? closedSignal : null,
            errorCode, cancelRequested, deadlineExceeded, durationMs: started ? elapsed() : 0 },
          outputs: { stdout: output('stdout'), stderr: output('stderr') },
          stdoutHex: stdout.toString('hex'), stderrHex: stderr.toString('hex'),
          cause: firstCause, validated: firstCause === null ? validated : null,
          lifecycle: { operation, launchCalled, closeObserved, exited, killRequested, killReturned, killAtMs,
            ownerState: state, directChildOnly: true }, authorizing: false });
        // All potentially larger materialization is complete. Clean up listeners
        // before the final sample; only small immutable metadata copies follow it.
        clearTimeout(timer); clearTimeout(grace);
        try { signal?.removeEventListener('abort', onAbort); } catch {}
        guard();
        const result = Object.freeze({ ...prepared, cause: firstCause,
          validated: firstCause === null ? prepared.validated : null,
          process: Object.freeze({ ...prepared.process, errorCode, cancelRequested, deadlineExceeded,
            durationMs: started ? elapsed() : 0 }) });
        done = true;
        resolve(result);
      };
      try {
        began = clock(); guard();
        if (firstCause) { finish(); return; }
        signal?.addEventListener('abort', onAbort, { once: true });
        guard();
        if (firstCause) { finish(); return; }
        timer = setTimeout(() => { deadlineExceeded = true; cancelRequested = true;
          stop('DEADLINE_EXCEEDED', 'interruption'); }, timeoutMs);
        launchCalled = true;
        child = launch();
        child.on('error', () => stop('CHILD_PROCESS_ERROR'));
        child.on('exit', () => { exited = true; });
        child.on('close', (code, terminationSignal) => {
          if (done) return; // late closure never silently clears quarantine
          closeObserved = true;
          if ((code === null || integer(code, 0, 4_294_967_295)) &&
              (terminationSignal === null || /^SIG[A-Z0-9]{1,16}$/u.test(terminationSignal)) &&
              ((code === null) !== (terminationSignal === null))) {
            closedCode = code; closedSignal = terminationSignal;
          } else remember('CHILD_CLOSE_INVALID');
          finish();
        });
        child.stdout.on('data', capture('stdout'));
        // Explicitly ignored stderr is consumed without retention or an output
        // claim. The Swift verifier keeps the default rejecting policy.
        child.stderr.on('data', stderrPolicy === 'ignore' ? () => {} : capture('stderr'));
        child.stdout.on('error', () => stop('CHILD_STDOUT_ERROR'));
        child.stderr.on('error', () => stop('CHILD_STDERR_ERROR'));
        child.stdin.on('error', () => stop('CHILD_STDIN_ERROR'));
        child.on('spawn', () => {
          if (done) {
            // A delayed spawn cannot restore capacity, but must still be contained.
            // Do not alter the already issued observation or its unknown status.
            let attempted = false, returned = null;
            if (!exited && !closeObserved && child.exitCode === null && child.signalCode === null) {
              attempted = true;
              try { returned = child.kill('SIGKILL') === true; } catch { returned = false; }
            }
            late.push(Object.freeze({ operation, event: 'LATE_SPAWN', killAttempted: attempted, killReturned: returned }));
            if (late.length > 16) late.shift();
            return;
          }
          started = true; guard();
          if (firstCause) { kill(); return; }
          try { child.stdin.end(capturedInput); } catch { stop('CHILD_STDIN_ERROR'); }
        });
        guard();
        if (firstCause) stop(firstCause, errorCode ? 'error' : 'interruption');
      } catch {
        remember('CHILD_LAUNCH_ERROR');
        if (child) stop('CHILD_LAUNCH_ERROR'); else finish();
      }
    });
  }
  return Object.freeze({ run, status, lateObservations: () => Object.freeze([...late]) });
}
