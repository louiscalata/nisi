---
packet: nisi-track1-repository-fixture-runner
project_root: /Users/louiscalata/nisi-next-private/work-orders/parallel-seven-tracks-v1/track1
created_by: opencode
created: 2026-09-14T15:30:00-07:00
write_owner: opencode
status: done
---

# Nisi — Track 1 fixture-only repository acceptance runner

## Context

Claude's adversarial review of the oracle
(`repository-fixture-runner.test.mjs`, appended to `track1/README.md`)
rejected the first draft with 9 findings (parse defect 0 + defects 1-8).
OpenCode repaired every finding in the oracle, then implemented the runner
`repository-fixture-runner.mjs` against the reviewed oracle: a deterministic,
model-free fixture-only acceptance run over the reviewed repository host with
inert static/tests owners and an inert author/reviewer set.

## Required behaviour

1. Exact source manifest (five pinned fixture sources via the product fixture
   module); source-pin drift refuses before any run (`SOURCE_DRIFT`).
2. Failing baseline then repaired candidate; engine report shows
   `repairAttempts >= 1`, `workflowOutcome: 'COMPLETED'`, final candidate
   fingerprint equal to the repaired preparation's `candidateFingerprint`.
3. Settled host precedes receipt; `settledBeforeReceipt: true` only on a
   SETTLED collection; adverse paths (`CANCELLED`, `PROFILE_REQUIRED`,
   `UNCONFIRMED`, `SOURCE_DRIFT`) are frozen adverse results, never success.
4. Argument-shape errors throw `RUNNER_ARGS` before any side effect.
5. No review summaries by default; never contacts a model endpoint (static
   import allowlist + runtime side-effect guard).
6. Owned temp root under the caller-supplied parentRoot, `nisi-fixture-`
   prefix, removed on success AND failure (`cleaned: true`); on refusal
   before root creation: `ownedRoot: null`, `cleaned: true`.

## Constraints

- Write ONLY: `repository-fixture-runner.mjs`,
  `repository-fixture-runner.test.mjs`, `README.md`, `package.json`,
  `.packets/`.
- Never edit product files (`hosts/`, `tests/`, `workflow/`, `receipts/`,
  `examples/`).
- No dependencies, installs, network or model calls.
- Do not alter the acceptance commands to obtain DONE.

## Items

### P1 — Implement the fixture-only acceptance runner against the reviewed oracle
- **files**: repository-fixture-runner.mjs
- **do**: implement `runRepositoryFixtureAcceptanceV1` +
  `REPOSITORY_FIXTURE_RUNNER_PROFILE` per the Required behaviour above,
  passing the reviewed oracle 10/10.
- **accept**: npm test

## Packet acceptance
npm test