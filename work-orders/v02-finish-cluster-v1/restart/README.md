# C06 — settled-host history and restart inspection

Private Node-only observation seam. Acceptance is governed by the current
owner ledger, not this README or a successful history read.

## Purpose

Record the terminal result of a supplied settled repository-host record in the
existing journal format, then let a fresh process inspect that history. Reading
a historical result must never restart its task or restore execution permission.

The product seam is `recordHostObservationV1({ bundle, settled, now, ttlMs })` in
`history/host-journal-bundle.mjs`. The caller first obtains `bundle` through the
existing `openJournalBundle({ path, fs, config, now })`. The new seam has no
default path and receives no host object capable of running the task again.

## Data path

```text
Explicitly opened, privately issued journal bundle
  + caller-supplied settled host data
  + explicit observation time and lifetime
      → validate own-data fields, primitive outcomes and cross-record identities
      → reject altered public bundle inspection fields
      → construct one terminal, non-authorizing history entry
      → append and persist against the previously accepted disk hash
      → publish the new hash/bytes/entry view only after successful persistence

Store conflict or failure
      → restore the exact pre-append journal, including its time watermark
      → retain the adverse store result; do not repair or retry automatically

Fresh process inspection
      → existing journal readers recover the same historical entry and disk hash
      → no resume, consent restoration, model call or learning promotion
```

The mapping is COMPLETED→SUCCEEDED, CANCELLED/TIMED_OUT→CANCELLED, and the
remaining supported terminal workflow outcomes→FAILED. The entry ID binds run,
repair attempt and the `repository-host` stage. Repeating identical content at
the same observation time is a non-writing DUPLICATE. Reusing that ID with a
different observation time is an ID_CONTENT_MISMATCH conflict.

## Results and limits

Results distinguish OBSERVED, DUPLICATE, CONFLICT, STORE_CONFLICT, STORE_FAILED
and REFUSED. Store evidence retains its actual write, commit and fsync outcome;
schema validity alone is not a power-loss durability claim.

The source record is caller-supplied data. Cross-field coherence is checked, but
the original execution owners are not authenticated or re-run here. Both the
observation and result explicitly say `sourceAuthenticityAttested:false`.
Fingerprints identify supplied evidence; they are not proof that execution
occurred. No generated candidate source or invocation rows are copied into the
new payload. Configured journal retention and redaction remain in force.

The injected filesystem is a trusted dependency, not a security sandbox.
Truncated journals remain sealed, stale writes remain conflicts, and leftover
temporary files are not adopted by readers. Simulated truncation is not a real
process-death test. Runtime termination, native execution, workflow resume,
learning promotion and publication have separate gates.

## Verification

The owner runs the existing graded `test:c06` command plus journal compatibility
tests in a separate copied checkout after inspecting the candidate source. The
integration oracle uses the actual inert repository-host fixture and the two
existing fresh-process readers. Its children are bounded ordinary Node test
processes, not a native Swift execution or model inference.

Current retained owner evidence is under
`.packet-diagnostics/c06-owner-draft-20260920/`: `checks-AMHMeM/checks.json` shows
52/52 C06 checks, 80/80 journal regressions and unchanged C05 111/111; suites
overlap. `nisi-validation-sokSNE/receipt.json` is actual three-file Nisi
syntax/contract evidence. These results predate this documentation-only file
and do not claim independent review, canonical integration or C06 acceptance.

The held packet records the owner-managed four-file integration contract and
the legacy test's explicit dependency/export migration. Independent review and
canonical acceptance are separate evidence requirements. Historical failed
runs remain available; they are not replaced with passing receipts. OpenCode
dispatch, native acceptance and publication remain held.
