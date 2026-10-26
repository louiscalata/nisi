# Private contract and test adjudication

Opus 5 returned a real tool-disabled contract critique: 120.069 seconds and
reported USD0.2613795 including Haiku auxiliary usage. Fable's recorded same-task
credit failure was not retried. This is collaboration evidence, not test proof.

1. Its state/time/response ambiguities were independently flagged by Daybreak and
   clarified by Codex BEFORE the oracle was written. Monotonic equality is allowed;
   expiry is inclusive; unavailable clocks permanently invalidate a live permit.
2. A post-consumption revoke does NOT retract an admitted write. Keep that boundary
   explicit; the capture result retains recordAttempted and the actual journal
   outcome. REVOKED means future admission disabled, not historical erasure.
3. Additional owner inspection at capture is not an authority mechanism or lock.
   The selected contract intentionally consumes on ANY actual record invocation,
   including project mismatch or an owner that became unavailable. A new permit
   may use the same still-current declaration after explicit host reconciliation;
   neither creation nor capture retries automatically.
4. The supposed frozen-payload blocker is not real: run-journal-v1 accepts plain
   payload objects. Build fresh entry/payload containers with historyCapture,
   preserve nested frozen values and let the owner clone/redact. Do NOT change
   recordJournalObservation's exact envelope or mutate the projector result.

Luna confirmed the clone-and-redact route. Its adjacent warning that the older
importer's projector refusal leaked raw source was not substantiated: that
projector's REFUSED value is only status/reason/authorizing, not a full ENTRY.
No older-importer vulnerability or fix is claimed from that suggestion.

Daybreak wrote 31 independent test groups. Before the red run, Codex corrected its
imports to the canonical owner (the historical work-order has a DIFFERENT private
WeakMap), selected the canonical fixture/helper copies, and removed the fixture's
default payload.secret redaction which does not exist in projected XPC data.
The explicit existing-field provenance-redaction test remains in the oracle.
These corrections prevent false failures, not weaken behavior under test.

Native adapter audit: PipelineIncidentAdapterV1 currently requires deterministic
assist/needsAttention failure, modelParticipation.notRun and the exact limitation
DETERMINISTIC_GATE_FAILED_MODEL_SKIPPED. Its canonical capture envelope explicitly
has unsupported actor/protected authority and is transient. accessPolicyDigest is
not proof of consent. The new Node permit does NOT write the native ledger, grant
model-learning influence or override these requirements. Native schema/bridge,
authenticated consent and retention/revocation sweeps remain separate roadmap work.

Opus exact-source review returned PASS/no findings at source SHA256
75bd25105ab600559fc37ddb561104b9a778b95132068bf17462540da2d0333e:
49.659 seconds, reported USD0.192895 including Haiku auxiliary usage. That is NOT
acceptance of later changes or proof no defects exist. Daybreak then added six
independent boundary checks: five passed and one FAILED because a clock callback
that explicitly revoked then threw was mislabeled INVALID_CLOCK. No write occurred.
The retained adjudication-red.txt proves the failure. Codex fixed the catch-path
precedence to return PERMIT_REVOKED when revocation already occurred. Preserve the
old implementation-draft.mjs as pre-fix evidence; only canonical source is accepted.

Final source SHA96c2bb7d7503b6fc92237e0b250d83b66257cd3d76695d2f89c3afb99e52b08d
received Daybreak's separate static review with no outstanding concrete finding.
Codex executed37/37 tests and seven deliberate faults: source binding(1 fail),
second clock(3), consumption ordering(1), revocation recheck(3), uncertainty(1),
false consent attestation(1), catch-path regression(1). Each ran all37 with finite
exit1 and no skipped/cancelled/todo tests. Canonical npm check1368/1368 and234 pins
pass in `.build/history-capture-verification-LWb99c/verification.json`.
Real filesystem verification uses SYNTHETIC source and a TEST-WRITTEN declaration,
not new native execution or authenticated UI consent. The observed store reports
file+directory fsync and readback true; fresh-process reopen matches both digests.
This is not power-loss certification. Receipt:
`.build/history-permit-real-store-9GFtBT/verification.json`.
