# Paired-arm operator lifecycle and private CLI inspection

**Status: verified component; private engineering only.** 2026-09-20.
**Acceptance counters: finish 70% (7/10), NX 30% (3/10), v1 0% (0/8).**
These are unchanged major-gate counters, not percentages of code or quality.

## Delivered behavior

The executable CLI now supports:

```sh
node /Users/louiscalata/nisi/bin/nisi.mjs inspect-arm-trial /absolute/private/trial-directory
```

This is read-only. It captures the main history and sidecar through the existing
inspector and emits bounded aggregate states, never raw rows, identifiers,
prompts, candidate code or paths. OBSERVED exits 0, INCOMPLETE exits 1, and
REFUSED exits 2. OBSERVED describes cross-linked stored evidence; it does not
claim that the tasks succeeded or remote execution stopped.

`createPairedArmCommandOwnerV1` supplies the in-process operator lifecycle:
install exact SIGINT/SIGTERM listeners, run the original durable owner once,
send stops only to that owner, wait for its original work/storage closure,
inspect retained evidence, and remove only owned listeners. Stops during
synchronous setup are latched and delivered when the original run is available.
It never replaces a runner, forwards signals, exits the process or resumes a run.

Historical `retentionAcknowledged`, current `inspectionObserved`, and overall
`recorded` are separate fields. Failed retention cannot be repaired by a later
successful file inspection. Unknown signal cleanup prevents `recorded:true`.

> [!CAUTION]
> **The execution bootstrap is still incomplete.** The lifecycle API requires a
> trusted host to supply actual approval, current admission observations and fresh
> execution owners. This change does not add a shell command that constructs those
> capabilities or runs live providers. The private archive intentionally includes
> the read-only command's closure, not the in-process execution owner.

## Verification retained

| Evidence | Actual result | Scope |
|---|---|---|
| `checks-CfudCS/checks.json` | 364/364 tests; zero failures, skips, cancellations or TODOs | Selected owner, signal, CLI, history, package and finish-inventory regressions |
| Two physical signal tests within that total | SIGINT and SIGTERM each cancel exactly one original synthetic request; child exits normally | Local child processes, no real model request |
| Input bindings | 154 inputs unchanged before/after, including 13 changed source/test/package files | Current relative-import and package closure, not every repository file |
| Nisi validation in that directory | VALIDATED; contract PASS; syntax PASS for 13 files | No inference or behavioral scratch-test mode |
| `checks-CfudCS/package-receipt.json` | PASS_SCOPED; 87 exact archive entries; 123 fixed checks | Private offline archive and isolated installed CLI; native NOT_RUN |
| `mutations-yuTKCc/receipt.json` | Four deliberate faults caught; unchanged control 32/32 | Test-only in-memory substitutions, canonical source unchanged |

The 87 archive entries are 76 modules, 10 assets and package.json. The separate
29-entry library archive contract is unchanged. Installed-command checks cover
complete, header-only, empty, partial, corrupt and missing histories, malformed
arguments, bounded redaction, exact dependency closure and read-only effects.

The package receipt was copied byte-for-byte from
`.build/private-cli-package-b8cCay/receipt.json`.

- Archive SHA-256: `4cd3f3df081c027d80a231a05142ff8c1be87edd4825d81204cac5c37df6e847`.
- Package receipt SHA-256: `2d29c4ab4597d035dbdc945a822787175868a77e3118e89a8c578a17e1b769c1`.
- Normalized Nisi input SHA-256: `f7097d6f7f3cf0d23744af404f74157d142508e5c0e3fa300269e4591508ccfc`.
- `checks-CfudCS/checks.json` lists every verified file and its before/after hash.

### Deliberate-fault results

| In-memory fault | Passing / failing test points | Result |
|---|---:|---|
| Silently ignore an unknown projected row state | 31 / 1 | Caught by assertion |
| Ignore current inspection observation when reporting recorded | 31 / 1 | Caught by assertion |
| Drop a stop received during setup | 28 / 4 | Caught by assertions |
| Ignore uncertain listener removal | 30 / 2 | Caught by assertions |
| Unchanged control after faults | 32 / 0 | PASS |

`mutation-loader.mjs` uses Node24 test-only module hooks. It is not a product
dependency and is not included in the private CLI package. These tests do not
establish Node22 compatibility.

## Review and repairs

Independent Daybreak-requested source review found two initial P2 defects:
unknown row states could be silently skipped, and `recorded` could contradict
a refused current inspection. Both were corrected, covered by regression tests,
and exercised by the deliberate faults above. Final exact-source review reported
scoped PASS with no remaining P1/P2 in its reviewed boundary. The review ran no
tests; owner-run evidence above is separate. Actual served identity and usage
metadata were not provided and remain UNKNOWN.

Luna-requested drafts were proposals, not accepted verbatim. Owner integration
preserved existing help/warnings that an initial draft removed, corrected two
test expectations, replaced a readiness polling loop with an event-driven
promise, and fixed the synthetic Response fixture. Final independent harness
re-audit found no remaining concrete cleanup, framing, ownership or hang concern.
Its exact reviewed hashes are:

- `tests/paired-arm-command-signals.test.mjs`:
  `260dec1d8b23b6f5c4b5fb8e9ca45b73f2bfc652980ca0e1e240b573d759fb1b`.
- `tests/helpers/paired-arm-command-child.mjs`:
  `10183217990447d88af55e1844f913bced281df02d88849306b818ed67138306`.

Drafts remain under `luna-draft/` and `luna-signals/`, explicitly unaccepted.
The first consolidated-driver attempt refused a package-root trailing-slash
mismatch before tests. The driver now compares normalized absolute paths; the
successful result above is the later run. No failed product result was relabeled.

One non-blocking source-review observation remains: an injected non-final pure
projection may use a null reason. It cannot upgrade status or exit code; the
actual kernel supplies bounded reasons. Arbitrary injected IO, signal and
inspection methods are trusted host seams, not a sandbox.

## Remaining requirements and current collaborators

- Build and verify the trusted real-provider/admission bootstrap before exposing
  an executable paired-run command; preserve original owners and all holds.
- C08 still needs actual OpenCode tool-call evidence. Historical request
  `cc169ba7f93c40bd9fe7b4286732107d` is not settled by an idle inventory.
- C09 still needs its approved isolated Node22 same-archive rehearsal.
- C10, native acceptance, matched evaluations and remaining NX gates remain open.
- Fable's usage-cap pause handoff remains in force. No Claude inference was
  claimed for this component. Jev rotation remains unconfirmed; no old-key call.
- At 17:20:37Z the shared router reported no active run; local inventory reported
  Qwen3.8-27b loaded with inference NOT_TESTED. No load, eviction or swap occurred.
- No Spark execution tool was exposed in this session's tool inventory. This is
  not a claim about every installed external CLI or account entitlement.

> [!WARNING]
> **Component verification is not release approval or a benefit benchmark.** No
> global install, native application test, real model inference, public upload,
> package publication, authorization change or token-saving claim is supported
> by this work. Keep all source and design private under the existing gates.

The sidecar prerequisite is retained in private commit
`486999682d2bf34cf0004d5d830c0ccf700b88c0`. The roadmap and System Equation are
updated locally without staging unrelated pre-existing document work. Raw logs
retain their exact original bytes, including whitespace in assertion output.
