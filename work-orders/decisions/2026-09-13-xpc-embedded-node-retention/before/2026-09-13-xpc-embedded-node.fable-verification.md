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
