# Bootstrap evidence audit — read-only

Date: 2026-09-20
Scope: `checks-CZ4NtT`, `mutations-iBt2Jg`, the retained raw logs, and the
final Daybreak review. No tests, native build, provider, inference, network, or
canonical writes were performed by this audit.

## Checks packet

`checks-CZ4NtT/checks.json` reports:

- scope `PRIVATE_FIXED_FIXTURE_PAIRED_ARM_BOOTSTRAP`
- Node `v24.18.0`
- `passed: true`, `unchanged: true`, `releaseAccepted: false`
- 172 before entries and 172 after entries
- Nisi input/status `VALIDATED`, contract `PASS`, syntax `PASS`, exit 0
- test command exit 0, 573/573 passed, zero failed/skipped/cancelled/todo
- construction mode `FOUR_FRESH_SETS_WITHOUT_EXECUTION`
- synthetic mode `FIRST_ARM_ONLY_THEN_UNKNOWN_BUDGET_STOP`
- inference `NOT_RUN`, native `NOT_RUN`

The recorded Nisi input hash is `e86685a5ac3f4f70a2cdcc41746e528ebba3ccb71e6ce655d6d1e7c726adcd18`.
Recomputing SHA-256 after parsing the JSON and serializing it compactly with
`JSON.stringify(input)` produced the same hash. The
raw `nisi-input.json` file hash is different (`2b71db6454af2c8d9c5b4357d7e09847e5493bbde0945821869be3ce4db84157`)
because it is pretty-printed with a final newline; that is not a discrepancy.

I independently recomputed every one of the 172 current working-tree file
hashes against `checks-CZ4NtT.after`: 0 mismatches.

Packet hashes:

```text
9be1a9ac7ca8f5de99150091469f652f5db125700f3064a745af7223a89db766  checks-CZ4NtT/checks.json
2b71db6454af2c8d9c5b4357d7e09847e5493bbde0945821869be3ce4db84157  checks-CZ4NtT/nisi-input.json
```

The retained log hashes are the values recorded in `checks.json`; stderr was
empty for the inventory, Nisi, and test commands. This evidence proves the
fixed-fixture/synthetic acceptance scope only; it does not prove provider
delivery, native build, authentication, actual served-model execution, or
measured usage.

## Mutation receipt

`mutations-iBt2Jg/receipt.json` reports `passed: true`, `unchanged: true`, and
`releaseAccepted: false` for `PRIVATE_BOOTSTRAP_FOUR_FAULTS`. This is an
expected-fault mutation receipt, not an ordinary all-green run:

| run | result | controls |
|---|---:|---:|
| `control-before` | 38/38 passed, exit 0 | control |
| `rollback` | 36/38 passed, exit 1 | detected mutant |
| `construction` | 30/38 passed, exit 1 | detected mutant |
| `revocation` | 35/38 passed, exit 1 | detected mutant |
| `environment` | 36/38 passed, exit 1 | detected mutant |
| `control-after` | 38/38 passed, exit 0 | control |

Thus there are four actual mutant failures, both 38/38 controls pass, all six
run outcomes meet their expected conditions, and source hashes are unchanged. The mutation
receipt hash is:

```text
2c70c0202370ca6d13c3ed1b6fc8fc82933f7622d8f184e44f18f3cbfb658e36  mutations-iBt2Jg/receipt.json
```

The earlier `mutations-HBFce0` packet is intentionally excluded: it has failed
controls and lacks the accepted oracle harness, so it is not evidence for this
audit.

## Daybreak final-hash consistency

The final Daybreak review lists these nine hashes, and each matches the
corresponding current file and the `checks-CZ4NtT`/`mutations-iBt2Jg` records:

```text
e8d52c134a53f53dab756adef35a0c8da7b456055c25893abc7c5989be7b0008  hosts/repository/reviewed-paired-arm-bootstrap-v1.mjs
c062ed8c639892c623c87c780be6f6b9df6767c6d9c2b1dcbb59c811209f7026  hosts/repository/paired-trial-projection-v2.mjs
0e02eedd8ab34a3e10ee61c8294542a8c18d15ebae09a0fa79e170dea18f511d  hosts/repository/reviewed-live-model-v4.mjs
ff89ba12db37f86e5066b83f112f5fc6718b68a52a5d9b620f6b926399e21c14  tests/helpers/paired-arm-bootstrap-construction-child.mjs
ac60621447957494734639db8b5e7273828ef6dcf4297c394fed3e8c515baa18  tests/helpers/paired-arm-bootstrap-constructor-child.mjs
c2faaf7d0f37d5a566194cbe474fca62ee8db4088198ef8998e3cb2b09f596f2  tests/helpers/paired-arm-bootstrap-fixture.mjs
697af8057a7798a1879fd1fc15d1b8bcb54b07f08efb08752836131ba95a5403  tests/paired-arm-bootstrap-constructor-fault.test.mjs
f2b3615e2a108713d774514c94ef4c652c8cc7c370e3d4a8771fd60e06f31508  tests/paired-arm-bootstrap-preflight.test.mjs
44064d5f02e05abef98e11436a5d507046112c81fa3b919d95e6f95ea75ecf99  tests/reviewed-paired-arm-bootstrap-v1.test.mjs
```

## Scoped conclusion

The retained evidence is internally consistent for the private fixed-fixture
and inert/synthetic contracts: current inputs match the recorded 172-file
hash set, the full checks packet is 573/573 green, both mutation controls are
38/38, and the four induced mutants fail as expected. The receipt and Daybreak
review explicitly retain `releaseAccepted: false`, `inference: NOT_RUN`, and
`native: NOT_RUN`; no actual served-model or usage claim is justified.

The evidence does not independently establish live provider execution, native
build execution, authentication, remote-stop proof, or release/publication
authority.
