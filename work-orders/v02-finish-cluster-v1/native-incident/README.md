# C07 · Native incident evidence binding

> **Private engineering — Node-only evidence contract.**
> `MATCHED` describes caller-supplied records. It does not attest that a native
> process ran, grant permission, or complete NX-05.

## Purpose

Keep an original failed native-artifact check separate from a later observation,
and reject a comparison if its source, request, executable or evidence changed.
This layer does not run Swift, call a model, write files or publish anything.

## Contract

1. `createNativeIncidentSourcePlanV1` retains its existing public v1 shape and
   digest domains. `readNativeIncidentExecutionIdentityV1({plan})` exposes a
   separately held, frozen identity only for the original issued object.
2. `admitNativeIncidentRerunV1({plan, grant, host, now})` checks the exact source,
   profile, executable, bounded validity window and caller-reported idle host.
   Returned admission and nested handle share one private consumption latch.
3. `bindNativeIncidentRerunV1({admission, fresh, now})` consumes that admission,
   checks the original expectation/request and bounded raw stream hashes, and
   compares normalized outcome IDs and statuses. Original/fresh digests remain
   distinct; explanatory text remains represented in transcript hashes.

The grant and host observations are caller-supplied data, **not authentication**.
Copies or serialized handles cannot recreate private issuance. `authorizing`,
`executionVerified`, `learningEligible` and persistence flags remain false.
`nativeRerun` remains `NOT_RUN`; `nativeExecutionAttested` remains false.

## Outcomes

| Result | Meaning |
|---|---|
| `MATCHED` | Bound caller-supplied failure outcomes match the historical ones. |
| `DIVERGED` | Bound terminal outcomes differ. |
| `INTERRUPTED` | Cancellation was reported; no successful rerun credit. |
| `INCONCLUSIVE` | Drain or terminal evidence is not confirmed. |
| `ERROR` | Process/error evidence or a missing report prevents comparison. |
| `REFUSED` | Schema, issuance, identity, time, consumption or consistency failed. |

## Verification and remaining work

`npm run test:c07 --prefix work-orders/v02-finish-cluster-v1` runs the admission
oracle, its imported source-identity oracle, and existing source regressions.
All native observations in that command are synthetic caller-supplied fixtures.
The retained candidate has 54 passing graded tests and six discriminating
mutants; the two source-identity tests overlap that count and are not additive.
Those candidate checks are not canonical acceptance by themselves.

The candidate source retains its original isolated-draft provenance header;
the acceptance ledger and exact source hashes determine its integration state.
C04–C06 historical receipts must remain immutable. The sole superseded file is
their `native-incident-source-v1.mjs` dependency, with both old and new hashes
retained. Full C07 evidence must pass before each exact live dependency
transition; all remaining predecessor checks still run.

Still required for the complete v0.2 goal: actual authorized native execution
and capture, native acceptance, remaining finish packets, and the separate
release gates. No test in this directory removes those requirements.
