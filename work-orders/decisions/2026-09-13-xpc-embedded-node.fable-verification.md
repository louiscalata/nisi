# Fable verification — XPC embedded-Node prerequisite (both attempts)

Verifier: Claude Fable 5.1 (co-author; author ≠ reviewer: Astra ran both attempts). Method: 9 independent read-only agents (3 receipt lenses, 3 diagnosis lenses, 2 adversarial skeptics, 1 synthesis) plus my own spot-checks. Recorded 2026-09-13T17:52Z. No launch, no signing, no deletion, no edits outside this file and its log excerpt.

## Verdict
- **Receipts: ACCEPT WITH DEFECTS** (documentation and retention gaps only; no fabrication, no scope deviation).
  - Attempt 1 (`.build/xpc-embedded-node-69qhvao1`): 151/151 evidence hashes reproduce; 18/18 frozen inputs intact; PIDs 9910/9916/9917, wait status 5 = SIGTRAP, 0 bytes, both EOFs; OS crash report agrees on every shared field. `FIXED_EMBEDDED_NODE_START_FAILED` is justified independently of the frozen checker.
  - Attempt 2 (`.build/xpc-embedded-node-9u2lavy_`): 204/204 evidence hashes reproduce; entitlements exactly host/service {app-sandbox}, node {app-sandbox, inherit}; strict deep verify exit 0; 781-byte stdout with all five canaries; protected checker `FIXED_EMBEDDED_NODE_OBSERVED`, errors []; no new crash report; no `node-*` container created.
- **Cause of the attempt-1 SIGTRAP: CONFIRMED, confidence 0.96.** A bare Mach-O signed with app-sandbox and without inherit makes libSystem's initializer ask secinitd for its own container; secinitd derives container identity from the bundle identifier bound in the signature, which a bare binary lacks (`Info.plist=not bound`), so it logged `Unable to get bundle identifier ... no value for kCFBundleIdentifierKey` and `registration request failed: (0x10, 0x0)`, and `_libsecinit_appsandbox.cold.6` executed `brk #1` before main. Refuted alternatives: lipo corruption, invalid signature, ad-hoc/TeamIdentifier, hardened-runtime/JIT, argv/env/cwd, nested Claude seatbelt, Node/V8 crash. The single-variable A/B (attempt 2, inherit only) confirms it: `node[20280]: AppSandbox request` → `AppSandbox request successful`, no bundle-identifier error. Refinement: inherit does not skip the secinitd request; it skips container-identity derivation and creation.

## Defects for the owner's retention pass (files only; no build, sign, launch, rm or entitlement change)
- D1 Attempt-1 "unified-log queries returned []" is a harness bug: `experiment.py:146` passed a UTC-labelled `--start` that `log show` parses as local time (a window 7 h in the future). The real window returns 22–25 records including the secinitd failure. Correct `diagnosticLogs.reason`, `owner-adjudication.json`, roadmap :269-277 and README.
- D2 The causal OS message is not in the tree. Copy `~/Library/Logs/DiagnosticReports/node-2026-09-13-101227.ips` (verbatim, sha256 recorded) and the local-window log excerpt into `69qhvao1/logs/`; replace `exec.exactCause: UNKNOWN` with the asiSignatures text and frame chain; drop "Specific cause of SIGTRAP" from notClaimed.
- D3 The checker-defect enumeration listed two boxed-int fields; `cleanupUncertain` was a third (fix in the rerun harness covers all four; only the enumeration was wrong).
- D4 One pre-freeze build retry overwrote attempt-1 `container-before.json`/`native-context.json` (save() has no attempt suffix); provenance gap only.
- D5 The rerun harness omitted the unified-log capture instead of fixing `--start`; nothing in the tree preserves the secinitd sequence for pid 20280. **Preserved here:** `2026-09-13-xpc-embedded-node.inherit-run-unified-log-20280.txt` (58 lines, sha256 `3fae005fe14cdaf35af092ba38d6ac1aa613e1b84c15f1a4588ee246fd13cf5e`), captured read-only during verification with `log show --start '2026-09-13 10:41:57' --end '2026-09-13 10:41:59' --info --debug`. Copy it into `9u2lavy_/logs/`; add the measured statements "no node-*.ips newer than 10:12:27" and "no ~/Library/Containers/node-* entry".
- D6 `relocation-applied.json` cites a relayed approval rather than a verbatim Louis quote for the script-byte relocation (own-container path literal + digest); the inherit approval time is recorded as ~10:40 PDT while the checkpoint's first createdAt is 10:32:37 PDT. Record both verbatim.
- D7 `nestedSandboxConfoundingExcluded` is an assertion; the measured basis is that host and service each received their own App Sandbox (secinitd lines) under a codex parent (pid 6148). State the basis.
- D8 Disclosed, no change: raw `terminationProven:true` vs checkpoint false; 16 µs duration delta.
- D9 Verifier nit: crash-report codeSigningFlags 0x22000201 lacks the CS_ADHOC bit; ad-hoc is established by `codesign` output, not kernel flags.

## Recommendation to Louis (one approval expected)
1. ACCEPT the prerequisite as measured: the fixed embedded-Node XPC path is observed working under node entitlements exactly {app-sandbox, inherit}, host/service app-sandbox only. Inherit is Apple's documented helper shape and a narrowing (the child is confined to the service's existing sandbox).
2. APPROVE the no-launch evidence-retention pass above (Astra, files only).
3. Authorize nothing else: no third launch, no generated-code execution, no complete-isolation acceptance, no commit. One item for the later isolation review, not this prerequisite: node[20280] performed a mach-lookup of `com.apple.SystemConfiguration.DNSConfiguration` at 10:41:58.473 (the loopback listen itself was EPERM).

## Not claimed
Generated-code suitability, complete isolation, permanent service termination, absence of escaped/reparented descendants, or any v0.2 milestone closure. Product-progress line and checkboxes unchanged by this record.

## Retention pass — Astra

Louis, 2026-09-13 ~11:10 PDT, in the Claude session, verbatim:
> "Approve both, have Astra run the retention pass"

Recorded `ACCEPTED_AS_MEASURED_2026-09-13` for the September 13 `FIXED_EMBEDDED_NODE_OBSERVED` prerequisite: Node entitlements exactly {app-sandbox, inherit}, host/service app-sandbox only. The same quote approves the files-only retention/documentation pass. It grants no other action. Generated-code isolation acceptance remains open.

**Retention outcome:** documentation corrections and evidence copies completed; the requested fresh first-attempt local-window unified-log excerpt is blocked. The exact authorized command returned exit 64, `log: Cannot run while sandboxed`. Its empty stdout is not event-absence evidence. The command, stdout, stderr, exit code and timestamp are retained. No sandbox escalation or alternate execution route was attempted. The first-attempt secinitd text/basis is explicitly attributed to Fable's earlier verification; the copied OS crash report directly verifies its asiSignatures and initializer frame chain.

- D1: superseded the wrong-window `[]` interpretation in the first checkpoint, immutable owner-adjudication/README sidecars and roadmap; disclosed the fresh capture blocker.
- D2: copied the OS crash report verbatim into the first attempt's logs; added the exact asiSignatures text, secinitd text with Fable provenance and full crash-order frame chain. The effective notClaimed list drops “Specific cause of SIGTRAP”; the original list and UNKNOWN text remain with supersededBy pointers.
- D3: enumerated waitObserved, drainObserved, cleanupUncertain and coreDumped, preserving raw values and noting the rerun's existing four-field normalization. No checker/source execution or modification.
- D4: recorded the pre-freeze build retry's overwritten container-before.json/native-context.json as a known provenance gap because save() has no attempt suffix. No reconstruction.
- D5: copied Fable's 58-line pid-20280 excerpt with its verified full hash. Successful read-only current listings found only node-2026-09-13-101227.ips and no ~/Library/Containers/node-* entry; command/time/scope are recorded. These are current observations, not historical-absence proof.
- D6: preserved Louis’s inherit quote “Approve the inherit entitlement, have Astra rerun it” (~10:40 PDT per Claude’s session log), the first archived createdAt 2026-09-13T17:32:37.898145+00:00, and Claude’s relocation relay “YES. The relocation is a mechanical consequence of that approval, not a scope change.” The approximate time discrepancy remains explicit. Added the new acceptance quote verbatim.
- D7: replaced bare sandbox-confounding assertions with the host/service secinitd App Sandbox basis and retained Codex ancestry, separating first parent 6148 from rerun parent 18588. First-attempt secinitd findings remain Fable-attributed because fresh capture is blocked.

The canonical roadmap has the dated “Accepted as measured by Louis” paragraph and exact U02-08 blocker wording “Prerequisite accepted as measured; generated-code isolation acceptance remains open (separate decision)”. The brief Status line is ACCEPTED_AS_MEASURED_2026-09-13. The later isolation-review item is retained: node[20280]'s mach-lookup / mach connection activation of com.apple.SystemConfiguration.DNSConfiguration at 10:41:58.473; loopback listen itself was EPERM.

**Validation:** all 357 preexisting files across the two evidence trees matched their before SHA-256 hashes; all modes/flags matched. Both checkpoints preserve every original value after removing only the newly added corrections/supersededBy blocks; all supersession pointers and original targets resolve. All original false runtime flags, roadmap checkbox lines and the exact 30% (3/10) product-progress line are unchanged. The brief's content apart from its Status line is unchanged. The source/copy comparisons passed for both evidence files.

**Review:** Claude Fable 5.1's original verification above was read in full first. Astra integrated the retention changes. A read-only evidence reviewer and Luna reviewed correction coverage; Daybreak Blue reviewed the final correction content and checkpoint preservation, finding no blocking factual/provenance defect. No Spark reviewer was available/invoked. These reviews establish the retention/documentation boundary only.

**Not done:** no third fixture launch, build command, signing, entitlement change, generated-candidate execution, isolation acceptance, commit, push or deletion. No edits to work-orders/native-canary-adjudicator or work-orders/run-journal. Other workspace runs are concurrent; the explicit file manifest makes no claim about their changes. Initial read-only git-status queries invoked the macOS developer-tool shim and emitted cache/FS-event permission diagnostics; no build command was run, and Git was not used again.

**Before/after SHA-256 for modified files** (full-file hashes; historical originals are also retained in the before/ directory):

| File | Before SHA-256 | After SHA-256 |
|---|---|---|
| `docs/verification/2026-09-13/u02-xpc-embedded-node-checkpoint.json` | `67eee39307cf31cf5cb190108e06d5915ebf66feacf84540b1f40a154d1723d5` | `747185185b5c08b1746bcd2af76091b7ef932282173805436dd5b554478c88e7` |
| `docs/verification/2026-09-13/u02-xpc-embedded-node-inherit-checkpoint.json` | `9d6f973fd921a335340f0519d838277d04b28a15ca505768ece659b49471ced3` | `bb249661d70e95a9cf93ead8605c088c2811ece6a0f5003a5d4b7bc5b0254838` |
| `roadmap.md` | `a2e1c201521e8d2d60fa17ee4da5e543cd9c9d9d80777a9925afc6b05426bd22` | `440b0b17aa034a66ca32dc234d06372ca69d3809f47707d117ec838990cb6780` |
| `work-orders/decisions/2026-09-13-xpc-embedded-node.md` | `ffbfa23cc9cbc39e7cc4f5e797042ead882f2d9c0d838d9874e5f592d39ba2f0` | `31be2767cb80efdbc8e0f8321000cf665e54fbb92abdf35bb894432e4d5024f4` |
| `work-orders/decisions/2026-09-13-xpc-embedded-node.fable-verification.md` | `2af3d2ef8030a2ece7fd1d8826a13a7465ebc3db3bf9a03e21f44728f67f8e4b` | Recorded after this append in the detached `2026-09-13-xpc-embedded-node-retention/manifest.json` to avoid a self-referential digest. |

**New files** (before: absent; after SHA-256 below). No original frozen receipt or evidence manifest was rewritten.

| New file | After SHA-256 | Capture / purpose |
|---|---|---|
| `.build/xpc-embedded-node-69qhvao1/README.corrections.md` | `a92b95b84266a388e720de296e2e7502baf48262ee900b12dc47fee38d1f6b98` | New correction addendum; original retained evidence file unchanged. |
| `.build/xpc-embedded-node-69qhvao1/logs/retention-unified-log-local-window.stderr` | `3d1bfc20628becabc4bda68e57c58ad567d3a8aa0c8aa281f68b58bb28a3d0e5` | Exact authorized local-window log show attempt and its read-only capture metadata; exit 64 BLOCKED_SANDBOX, no excerpt. |
| `.build/xpc-embedded-node-69qhvao1/logs/node-2026-09-13-101227.ips` | `c0516e6c752d39a7c0cdb5956afef7b18e7e36c8d900911ebedc59a8416305bb` | Verbatim cp -n from ~/Library/Logs/DiagnosticReports; SHA-256 + cmp verified. |
| `.build/xpc-embedded-node-69qhvao1/logs/retention-unified-log-local-window.capture.json` | `252a841c2a5159f2817b04ab73ca724b3221a40397238d2f8f421ed95b8c26f9` | Exact authorized local-window log show attempt and its read-only capture metadata; exit 64 BLOCKED_SANDBOX, no excerpt. |
| `.build/xpc-embedded-node-69qhvao1/logs/retention-unified-log-local-window.stdout` | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` | Exact authorized local-window log show attempt and its read-only capture metadata; exit 64 BLOCKED_SANDBOX, no excerpt. |
| `.build/xpc-embedded-node-69qhvao1/logs/retention-unified-log-local-window.started-at.txt` | `70f7d6e9c6a8f3cf3a07f218a921ec224d89547422c9022939f9c999f22a04f9` | Exact authorized local-window log show attempt and its read-only capture metadata; exit 64 BLOCKED_SANDBOX, no excerpt. |
| `.build/xpc-embedded-node-69qhvao1/logs/retention-unified-log-local-window.exit-code.txt` | `913f5d1da2feaf4deeccc9e55cbb350a20f12b3f507e87be85dbb77fdd3cb9bc` | Exact authorized local-window log show attempt and its read-only capture metadata; exit 64 BLOCKED_SANDBOX, no excerpt. |
| `.build/xpc-embedded-node-69qhvao1/owner-adjudication.corrections.json` | `f149496b59c8c5e4869ae549e7ae4ff6420d580a0cd303c1c840d7ae0d353299` | New correction addendum; original retained evidence file unchanged. |
| `.build/xpc-embedded-node-9u2lavy_/README.corrections.md` | `d792984f3db5b5b3844f50b8fb7b8b192a3860ceda6d467fc899b13b4a51bcf4` | New correction addendum; original retained evidence file unchanged. |
| `.build/xpc-embedded-node-9u2lavy_/logs/retention-filesystem-measurement.started-at.txt` | `22f67c4978e5cfa673de2b5a640af8007d3d59b95851d46ee4dd37c4a9d2ba81` | Current read-only find listings, exit codes/stderr, timestamp and interpreted measurement receipt. |
| `.build/xpc-embedded-node-9u2lavy_/logs/retention-node-containers.stderr` | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` | Current read-only find listings, exit codes/stderr, timestamp and interpreted measurement receipt. |
| `.build/xpc-embedded-node-9u2lavy_/logs/retention-node-containers.stdout` | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` | Current read-only find listings, exit codes/stderr, timestamp and interpreted measurement receipt. |
| `.build/xpc-embedded-node-9u2lavy_/logs/retention-node-containers.exit-code.txt` | `9a271f2a916b0b6ee6cecb2426f0b3206ef074578be55d9bc94f6f3fe3ab86aa` | Current read-only find listings, exit codes/stderr, timestamp and interpreted measurement receipt. |
| `.build/xpc-embedded-node-9u2lavy_/logs/retention-node-crash-reports.exit-code.txt` | `9a271f2a916b0b6ee6cecb2426f0b3206ef074578be55d9bc94f6f3fe3ab86aa` | Current read-only find listings, exit codes/stderr, timestamp and interpreted measurement receipt. |
| `.build/xpc-embedded-node-9u2lavy_/logs/retention-filesystem-measurement.json` | `bedab84252ddd6d898245f12edea11814b44a7eb40ae452cd0bb809d52856909` | Current read-only find listings, exit codes/stderr, timestamp and interpreted measurement receipt. |
| `.build/xpc-embedded-node-9u2lavy_/logs/retention-node-crash-reports.stderr` | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` | Current read-only find listings, exit codes/stderr, timestamp and interpreted measurement receipt. |
| `.build/xpc-embedded-node-9u2lavy_/logs/inherit-run-unified-log-20280.txt` | `3fae005fe14cdaf35af092ba38d6ac1aa613e1b84c15f1a4588ee246fd13cf5e` | Verbatim cp -n from Claude's preserved decision excerpt; expected full hash + cmp + 58 lines verified. |
| `.build/xpc-embedded-node-9u2lavy_/logs/retention-node-crash-reports.stdout` | `2d3b0392b74e0b2cedaf5b692b00001dfeca03d5fdfbe2a8a0adc6d00029ae77` | Current read-only find listings, exit codes/stderr, timestamp and interpreted measurement receipt. |
| `work-orders/decisions/2026-09-13-xpc-embedded-node-retention/preexisting-evidence-verification.txt` | `03e4cdb5091dcc0452970fcb9fdb716632500d7515f81c745e0a6b9478f455b8` | New explicit-scope retention audit inventory/check record. |
| `work-orders/decisions/2026-09-13-xpc-embedded-node-retention/preexisting-evidence-modes-flags.txt` | `05ac3fc27ce574f2f6443b5a9a00269ebe6e8160301684eeb93ad88f1140405b` | New explicit-scope retention audit inventory/check record. |
| `work-orders/decisions/2026-09-13-xpc-embedded-node-retention/preexisting-evidence.sha256` | `09dc782cf5f396d3f09ed72773f15ca478b95d2216a235500a69c836beb0410d` | New explicit-scope retention audit inventory/check record. |
| `work-orders/decisions/2026-09-13-xpc-embedded-node-retention/preexisting-evidence-modes-flags-after.txt` | `05ac3fc27ce574f2f6443b5a9a00269ebe6e8160301684eeb93ad88f1140405b` | New explicit-scope retention audit inventory/check record. |
| `work-orders/decisions/2026-09-13-xpc-embedded-node-retention/preexisting-evidence-verification.exit-code.txt` | `9a271f2a916b0b6ee6cecb2426f0b3206ef074578be55d9bc94f6f3fe3ab86aa` | New explicit-scope retention audit inventory/check record. |
| `work-orders/decisions/2026-09-13-xpc-embedded-node-retention/changed-files-before.sha256` | `e90c48152e886c68c82389f20935684fd1113430f4657e8ed46880ef954f3726` | New explicit-scope retention audit inventory/check record. |
| `work-orders/decisions/2026-09-13-xpc-embedded-node-retention/validation.json` | `3738563d00cedfb43f910a19f45816cc23afe45261c1ac7199a93f266533e6fa` | Recorded file/hash/metadata/document-invariant checks, not runtime tests. |
| `work-orders/decisions/2026-09-13-xpc-embedded-node-retention/before/u02-xpc-embedded-node-checkpoint.json` | `67eee39307cf31cf5cb190108e06d5915ebf66feacf84540b1f40a154d1723d5` | Verbatim before snapshot of one explicitly authorized mutable document/checkpoint. |
| `work-orders/decisions/2026-09-13-xpc-embedded-node-retention/before/2026-09-13-xpc-embedded-node.fable-verification.md` | `2af3d2ef8030a2ece7fd1d8826a13a7465ebc3db3bf9a03e21f44728f67f8e4b` | Verbatim before snapshot of one explicitly authorized mutable document/checkpoint. |
| `work-orders/decisions/2026-09-13-xpc-embedded-node-retention/before/u02-xpc-embedded-node-inherit-checkpoint.json` | `9d6f973fd921a335340f0519d838277d04b28a15ca505768ece659b49471ced3` | Verbatim before snapshot of one explicitly authorized mutable document/checkpoint. |
| `work-orders/decisions/2026-09-13-xpc-embedded-node-retention/before/2026-09-13-xpc-embedded-node.md` | `ffbfa23cc9cbc39e7cc4f5e797042ead882f2d9c0d838d9874e5f592d39ba2f0` | Verbatim before snapshot of one explicitly authorized mutable document/checkpoint. |
| `work-orders/decisions/2026-09-13-xpc-embedded-node-retention/before/roadmap.md` | `a2e1c201521e8d2d60fa17ee4da5e543cd9c9d9d80777a9925afc6b05426bd22` | Verbatim before snapshot of one explicitly authorized mutable document/checkpoint. |
| `work-orders/decisions/2026-09-13-xpc-embedded-node-retention/retention-corrections.json` | `13fd194985e0acdac65a512241126d041fb53e7a890617cadfb4c4550a4aeb8d` | New standalone corrections/acceptance record mirrored additively in both checkpoints. |

The detached manifest.json is created after this append. It records this record's final before/after hashes and every other explicitly written path; its own final digest is reported in Astra's final response, outside the file it hashes.

**Louis must decide:** the separate later generated-code isolation review, including DNSConfiguration lookup and unresolved service/descendant boundaries. The prerequisite acceptance is already recorded and does not need repeating. Finishing the missing log capture requires an execution context allowed to read unified logs; the present authorization already covers that read-only capture, and no new fixture launch is needed.


## Retention addendum — Claude (2026-09-13T18:25Z)
Astra's retention pass could not capture the first-attempt unified-log excerpt (`log show` refuses to run under Codex's sandbox, exit 64). Captured read-only from Claude's shell with the exact requested command (local-time window 2026-09-13 10:12:26–10:12:28, predicate node/ProbeService/ProbeHost/secinitd/ReportCrashService, --info --debug, compact style) and filed as `/Users/louiscalata/nisi-next-private/.build/xpc-embedded-node-69qhvao1/logs/retention-unified-log-local-window.claude.txt` (sha256 `a133ac0c6428d294ac86b743115b0bab8e0f0c1d3fed2ebe68c20f5bf05fe48b`). It contains the secinitd registration failure for node[9917] that the harness's UTC-labelled window missed. No frozen file was modified; this is an additive evidence file.
