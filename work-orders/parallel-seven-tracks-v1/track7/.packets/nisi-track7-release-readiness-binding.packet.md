---
packet: nisi-track7-release-readiness-binding
project_root: /Users/louiscalata/nisi-next-private/work-orders/parallel-seven-tracks-v1/track7
created_by: claude
created: 2026-09-14T06:05:00-07:00
write_owner: opencode
status: done
---

# Nisi — Track 7 release-readiness validator: bind every platform to evidence

## Context

OpenCode is a co-author on this work order (Louis, 2026-09-14): you own the
validator, its schema and the retained current manifest together. Node 24,
ESM, no dependencies. `npm test` (the author's 2 tests) must keep passing
after you update its fixture shape (see item P2). `npm run test:hardening`
(Claude's independent oracle, 10 tests) fails 5 of 10 against the draft;
those 5 define the change. Read the hardening test in full first: its
fixture shows the required input shape.

The defect (from the Codex handoff): a platform entry is `{id, status}` with a
bare string, so `{id:'windows', status:'PASS_SCOPED'}` passes the matrix with
no evidence behind it. Release readiness must not be self-declared.

Required behaviour:
1. **Platform entries bind a receipt file.** Each of the four platform entries
   is `{ id, receipt: { path, sha256 } }` — same file-binding rules as the
   artifact and product report (`file()` helper: relative, no `..`, no
   symlinks anywhere on the path, inside root, regular file, digest match).
   The platform's status is the RECEIPT's own `status` field, mapped exactly
   as the product-report vocabulary is: a pass state (`PASS`, `PASS_SCOPED`,
   `READY`, `VERIFIED`) → `'PASS'`; `FAIL`, `NOT_RUN`, `INCONCLUSIVE`,
   `ERROR`, `REQUIRES_AUTHORITY` → that exact string; anything else (missing,
   non-string, unknown word) → `'ERROR'`. A receipt that fails the file
   binding reports the binding outcome instead: digest mismatch →
   `'INCONCLUSIVE'`, missing file → `'NOT_RUN'`, escape/symlink/malformed →
   `'ERROR'`. Each platform result carries `receiptId: <the declared path>`
   so a reader can see what it was judged on. A platform entry that has a
   bare `status` and no `receipt` (the old shape) is reported `'ERROR'` with
   reason `'UNBOUND_PLATFORM'` and the whole result is not ready.
2. **Approvals are exact.** `approvals` must have EXACTLY the six keys
   legal, disclosure, release, signing, notarization, publication, each a
   plain object; an extra key or a missing key → top-level
   `{ status:'ERROR', reason:'INVALID_APPROVALS', publishingAllowed:false, authorizing:false }`.
   Every approval still reports `REQUIRES_AUTHORITY` regardless of content
   (never infer clearance).
3. Everything else stays: exact platform matrix rule and reason, artifact and
   product-report binding and the product-report semantics (`PASS_SCOPED`,
   `ready:true`, `authorizing:false`), placeholder digests → `ERROR` /
   `INVALID_FILE_BINDING`, frozen non-authorizing result with
   `publishingAllowed:false` always, pure and read-only.

## Constraints

- Write ONLY: `check-release-readiness.mjs`, `release-readiness-schema.json`
  (platform items become `{id, receipt:{path,sha256}}`, `additionalProperties:false`,
  approvals `additionalProperties:false` with the six required keys),
  `check-release-readiness.test.mjs` (update its fixture to the bound shape so
  its two tests keep their assertions), and `current-readiness.json` (convert
  the four platform entries to the bound shape pointing at
  `evidence/<id>.json` paths that do not yet exist, keeping the
  `REQUIRES_CURRENT_PIN` placeholders on artifact/productReport so the
  retained manifest stays honestly NOT ready — the last hardening test checks
  exactly that).
- Read-only: `package.json`, `check-release-readiness.hardening.test.mjs`,
  `.packets/`.
- No dependencies, installs, network or model calls.
- Do not run commands, tests or nested packets yourself. The installed wrapper
  runs the inspected acceptance checks and writes the execution receipt.
- Do not alter the hardening test or the acceptance commands to obtain DONE.

## Items

### P1 — Bind platforms to receipts, make approvals exact, keep the author's tests and the retained manifest honest
- **files**: check-release-readiness.mjs, release-readiness-schema.json, check-release-readiness.test.mjs, current-readiness.json
- **do**: Implement behaviours 1–3 in the validator, mirror the input shape in the schema, update the author test fixture to the bound platform shape (its assertions unchanged), and convert current-readiness.json's four platform entries to the bound shape (evidence/<id>.json paths that do not yet exist; artifact/productReport placeholders kept). Both suites must be green afterwards.
- **accept**: npm run test:hardening

## Packet acceptance
npm test
