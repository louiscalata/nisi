Private bounded follow-up to your exact-source FAIL review in this same task. Tools disabled, no publication or external tools; review only the supplied excerpt. Return PASS or at most three concrete findings.

Adjudication: the original frozen contract EXPLICITLY prescribed REFUSED INTERNAL_ERROR after unknown/throwing record outcomes, while retaining recordAttempted/consumed true. Therefore the previous review overstated this as a literal contract violation. We nevertheless accept UNCERTAIN as a safer contract revision: after entering record, an unclassifiable dependency result cannot prove whether storage occurred. Do NOT refund consumption or imply rollback. Do NOT return malformed journal values; journal:null. No new injectable production dependency or retry. Actual journal owner normally returns closed frozen records and catches filesystem failures; the unexpected cases below were injected only via a relocated test dependency.

Revised contract: known journal outcomes keep exact mapping and original immutable journal result. STORE_FAILED with snapshot.state OPEN or SEALED maps STORE_FAILED; with COMMIT_UNCERTAIN maps UNCERTAIN. Unknown/missing snapshot state, null/unknown record results or throws AFTER admission => UNCERTAIN INTERNAL_ERROR, journal:null, consumed/recordAttempted true. Internal exception BEFORE record => REFUSED INTERNAL_ERROR. recordAttempted is set with consumed BEFORE calling record, so no additional admitted flag needed. No optional chaining that silently maps missing snapshot to definite failure.

Exact helper revision SHA256 e74aa40389a1c132ec535c77a90b0e56a61b91aa20126b48546b5942091d5418; unchanged host SHA256 6b53aa8d6d88039c7905baebc2621402ad7cce4ecc23d5fa5574e4b32d881079. Main30 tests pass. Five independent dependency-substitution tests failed as ERR_ASSERTION on old helper e72b514e... then pass on corrected source: throw/null/unknown/missing snapshot/missing state; they assert flags, journal:null, no exception leak, ALREADY_CAPTURED on retry and one record call. These results are Codex-observed; you did not execute them. Full regression/mutant and real-disk acceptance still pending. Review the resolution, not unrelated hypothetical trust boundaries.

Current entire helper construction/capture excerpt:
```js
  if (!hex(taskFingerprint) || !hex(baselineFingerprint)) fail('REPOSITORY_HISTORY_CONFIG');
  let published = false, rejected = false, collected = null, cached = null, busy = false, consumed = false;
  function publish(result) {
    if (published || rejected) fail('REPOSITORY_HISTORY_ALREADY_PUBLISHED');
    collected = result; published = true;
  }
  function reject() { if (!published) rejected = true; }
  function preview() {
    if (!published) return previewResult(rejected ? 'SETTLEMENT_REJECTED' : 'NO_SETTLED_RESULT');
    return cached ??= project(collected, taskFingerprint, baselineFingerprint);
  }
  function capture(input) {
    let sourceDigest = null, declarationDigest = null, recordAttempted = false;
    const output = (status, reason, journal = null) => Object.freeze({
      schemaVersion:'nisi-repository-history-capture/v1', status, reason, recordAttempted,
      consumed, sourceDigest, declarationDigest, journal, authorizing:false});
    if (!published) return output('REFUSED', rejected ? 'SETTLEMENT_REJECTED' : 'NO_SETTLED_RESULT');
    if (consumed) return output('REFUSED', 'ALREADY_CAPTURED');
    if (busy) return output('REFUSED', 'BUSY');
    let req, d;
    try {
      exact(input, ['owner','declaration','clock'], 'INVALID_INPUT');
      req = {owner:input.owner, clock:input.clock};
      if (typeof req.clock !== 'function') fail('INVALID_INPUT');
      d = declarationOf(input.declaration);
    } catch { return output('REFUSED', 'INVALID_INPUT'); }
    const p = preview();
    if (p.status !== 'PREVIEW') return output('REFUSED', p.reason);
    sourceDigest = p.sha256;
    if (d.sourceDigest !== sourceDigest) return output('REFUSED', 'SOURCE_DIGEST_MISMATCH');
    declarationDigest = hash(DECLARATION_DOMAIN, d);
    const inspected = inspectJournalOwner({owner:req.owner});
    if (inspected.status !== 'SNAPSHOT') return output('REFUSED', 'INVALID_OWNER');
    if (inspected.snapshot.state === 'SEALED') return output('REFUSED', 'OWNER_SEALED');
    if (inspected.snapshot.state === 'COMMIT_UNCERTAIN') return output('REFUSED', 'COMMIT_UNCERTAIN');
    busy = true;
    try {
      const initial = readClock(req.clock, d);
      if (initial.reason) return output('REFUSED', initial.reason);
      const body = p.preview;
      const entry = {id:'rh1.' + sha256Text('nisi/repository-history-id/v1\0' + sourceDigest),
        projectId:d.projectId, runId:body.runId, attempt:body.attempt,
        candidateId:body.candidatePresent ? 'cand:' + body.candidateFingerprint : 'none:' + body.runId,
        stage:'REPOSITORY_SETTLEMENT', receiptId:null, createdAt:d.createdAt, ttlMs:d.retentionMs,
        state:body.outcome === 'CANCELLED' ? 'CANCELLED' : body.outcome === 'COMPLETED' && body.hostState === 'SETTLED' ? 'SUCCEEDED' : 'FAILED',
        heartbeatAt:null, retryOf:null, revokes:null,
        payload:{preview:body, sourceDigest, declarationDigest}};
      const final = readClock(req.clock, d, initial.now);
      if (final.reason) return output('REFUSED', final.reason);
      // One record attempt, including refusal/failure. No callback can refund it.
      consumed = true; recordAttempted = true;
      const journal = recordJournalObservation({owner:req.owner, entry, now:final.now});
      let status;
      switch (journal.status) {
        case 'RECORDED': status = 'STORED'; break;
        case 'DUPLICATE': status = 'DUPLICATE'; break;
        case 'CONFLICT': case 'STORE_CONFLICT': status = 'CONFLICT'; break;
        case 'REFUSED': status = 'REFUSED'; break;
        case 'STORE_FAILED':
          if (!['OPEN','SEALED','COMMIT_UNCERTAIN'].includes(journal.snapshot?.state))
            return output('UNCERTAIN', 'INTERNAL_ERROR');
          status = journal.snapshot.state === 'COMMIT_UNCERTAIN' ? 'UNCERTAIN' : 'STORE_FAILED'; break;
        default: return output('UNCERTAIN', 'INTERNAL_ERROR');
      }
      return output(status, journal.reason, journal);
    } catch {
      // Entry into the record dependency is irreversible from this host's view.
      // Unexpected output cannot establish whether storage occurred; do not retry.
      return output(recordAttempted ? 'UNCERTAIN' : 'REFUSED', 'INTERNAL_ERROR');
    }
    finally { busy = false; }
  }
  return Object.freeze({publish, reject, preview, capture});
}

```
