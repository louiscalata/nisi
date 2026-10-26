# C07 source-contract gap and minimal owner amendment

Status: private design note only. No canonical source, test, package, native
executor, provider, or dispatch state is changed by this note.

## Finding

The original issued check already contains the required executor identity, but
the current native-incident source-plan projection drops it.

- `hosts/repository/native-incident-source-v1.mjs:40-45` locates the original
  issued Swift check through `context.plans`, `issuedSwiftChecksV1(plan)`, and
  the selected `check`.
- `hosts/repository/native-incident-source-v1.mjs:45-51` binds the source row
  to `check.expected.binding` and `check.expected.fingerprint`.
- `hosts/repository/native-incident-source-v1.mjs:62-64` verifies the fixed
  checker profile, and `:69-75` emits the public/private source projection.
  That projection currently retains only the fixed checker `profile`; it does
  not retain `check.expected.profile.executableSha256` or its complete
  execution-profile identity.
- `hosts/swift-verifier/check-plan-v1.mjs:20-25` accepts the original
  `executionProfile`; `:46-50` creates each issued expectation/request with
  the complete profile, including `sourceSha256`, `buildSha256`,
  `executableSha256`, environment, platform, architecture, timeout, and output
  cap.
- `receipts/repository-execution-v1.mjs:66-81` binds that complete profile into
  the issued expectation and its fingerprint. `:94-126` authenticates the
  receipt against the original expectation before returning normalized data.
- `hosts/swift-verifier/executor.mjs:91-102` reopens the issued check through
  `issuedSwiftChecksV1(input.plan)`, requires the plan's execution profile to
  equal the executor's host-selected profile, and then uses the issued
  `check.expected`/`check.request` at `:95-98`. Thus the existing issued plan
  can support a positive offline binding fixture; the missing information is
  projection, not a missing executor identity.

## Minimal owner-authorized amendment

Amend only the source-plan projection, without changing issuance, execution,
authority, or raw-content policy:

1. In `createNativeIncidentSourcePlanV1`, derive immutable values directly
   from the already-issued `check.expected.profile`:

   - `executionProfileSha256 = sha256Text('nisi/execution-profile/v1\\0' + stableStringify(check.expected.profile))`
   - `executableSha256 = check.expected.profile.executableSha256`

   The existing receipt module uses this same domain in its private `digest`
   helper. The amendment must verify the complete profile's own fields and
   preserve the original expectation identity; it must not accept either hash
   from `row`, `preview`, or a caller grant.

2. Add exactly those two digest/identity fields to both the frozen `selection`
   and the private source-input body. Do not expose executable paths, argv,
   environment contents, artifact bytes, stdout, or raw observations. Include
   them in `sourcePlanDigest` so a copied or reassembled projection cannot
   retain authority.

3. Extend the C07 grant grammar with
   `executionProfileSha256` and require both grant hashes to equal the issued
   selection at admission. The grant remains data naming/correlation only;
   `executionGranted`, `authorizing`, `executionVerified`, learning, and
   persistence remain false. The later fresh expectation must still be the
   original issued object accepted by `readExecutionReceipt`; no hash-only
   expected object is sufficient.

4. Remove the current refusal-only gap only after this source amendment is
   present. A valid synthetic fixture can then use the original issued check,
   its existing `entry()` receipt, and a grant copied from the projected
   issued profile. It must remain labelled caller-supplied with
   `nativeRerun: NOT_RUN` and `nativeExecutionAttested: false`; this does not
   establish native/live acceptance.

## Planned bounded readset and tests

Owner approval should limit the next change to:

- `hosts/repository/native-incident-source-v1.mjs` — projection amendment
  above; no new issuer, scheduler, executor, or persistence API.
- The private C07 admission module in the isolated draft, then its staged
  equivalent only after source-contract review.
- `work-orders/v02-finish-cluster-v1/native-incident/admission-integration.test.mjs`
  — real issued-plan positive fixture, exact profile/executable grant binding,
  mismatched profile/executable/profile-digest refusal, cloned plan/hash-bag
  refusal, complete report preparation/source/outcome normalization, and
  proxy/accessor/hidden-key regressions.
- The isolated C07 `DESIGN.md` and source-contract evidence only. No package
  closure, CLI, native runner, or packet/ledger change is in scope.

Required positive assertion: the original `check.expected` and its receipt
bind to `MATCHED` with both authority flags false and `nativeRerun: NOT_RUN`.
Required negative assertions: changing either issued profile digest, changing
the executable hash, substituting a different issued check, or rebuilding the
public source projection refuses with a named identity reason before any
reviewer, retry, persistence, or promotion action.

## Risks and limits

- The two new fields change the source-plan selection and digest schema; all
  source-plan fixture snapshots and C07 expected-key assertions must advance
  together. Legacy source plans must not be silently upgraded.
- The executable hash is an identity observation, not proof that a pathname was
  not replaced between observations. The existing executor's pre/post build
  observations and reservation/quarantine behavior remain separate.
- `readExecutionReceipt` authenticates issuance identity, not native execution.
  Synthetic `entry()` data is still caller-supplied fixture evidence and must
  remain `NOT_RUN`/unattested.
- The amendment must not copy the complete execution profile into a public
  report if that would expose command/environment details. Digest plus
  executable hash are the minimum fields needed by the admission grant; the
  full profile remains behind the already-issued expectation/source accessor.
- This does not authorize native reruns, create a scheduler or permission
  gate, add journal writes, or close product/live/Windows acceptance.

