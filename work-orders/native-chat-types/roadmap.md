# Native-chat declarations — private work-order status

**Product progress: 30% — 3/10 major milestones accepted.** This isolated draft
does not own the product denominator. The single canonical product roadmap is
[Nisi roadmap](../../roadmap.md).

Purpose (U02-03 / DX-01): TypeScript declarations for the two untyped native-chat
adapters (`adapters/native-chat-v1.mjs`, `adapters/native-chat-protocol-v1.mjs`
have no `types/*.d.ts` and are not in `package.json` exports/files). The target
`types/native-chat.d.ts` declares the public surface of `adapters/native-chat-v1.mjs`
in the style of `types/local-chat.d.ts`, against a frozen copy of
`types/workflow.d.ts` (sha256 92d155a4…). The oracle is a strict compile-only
consumer (`tests/consumer/native-chat.mts`) with positive uses and
`@ts-expect-error` negatives; no runtime behavior is claimed.

- [x] Author the contract, the frozen fixture and the consumer oracle (Claude, co-author, 2026-09-13).
- [x] Execute one bounded draft attempt (2026-09-13 11:25 PDT): `packet-run-pc`, PC worker Qwen3-Coder-Next, job mac-20260913-112459-41d75a93d4878a58873c0e054335b5c9, 52.2 s, first draft compiled (accept exit 0, no repair); receipt DONE; jobs retained in `.packets/nisi-native-chat-types.pc-jobs/`.
- [x] Owner review (Astra, 2026-09-13): CHANGES MADE; corrected declaration drift, verified both suites and all ten negative controls, and accepted the isolated declarations for Louis's integration decision. See owner review below.
- [x] Integrate separately: `types/native-chat.d.ts`, both native-chat typed aliases in `package.json`, matching files/contract allowlists, and `tests/private-consumer/native-chat.mts`; rerun `test:types` and `check:private-package` (2026-09-13). `tests/private-consumer/native-chat-runtime.test.mjs` is a new synthetic test, not sourced from the work order.

Only `types/native-chat.d.ts` is an executor edit target. Declarations are a
developer-experience contract, not an execution, isolation, security or release gate.

## Owner review — Astra

2026-09-13: **CHANGES MADE; accept the corrected isolated declarations.**
Louis must decide whether to integrate them. Runtime modules and product package
metadata were read only; no integration or package rehearsal was performed.

### Drift findings and corrections

Locations below refer to the final declaration file and the unchanged runtime.

- `types/native-chat.d.ts:43` through its six optional options now explicitly
  include `undefined`. Under `exactOptionalPropertyTypes`, the initial declarations
  rejected explicit undefined although `adapters/native-chat-v1.mjs:46` through
  `:57` accepts it and applies defaults. All six required options still match
  configuration validation at runtime `:36` through `:45`.
- `types/native-chat.d.ts:20`, `:106`, `:112` and `:117`: owner/control/adapter
  methods are now readonly function properties. The initial method syntax
  allowed reassignment, but the owner and adapter are frozen at runtime
  `adapters/native-chat-v1.mjs:13` and `:217`.
- `types/native-chat.d.ts:30`: both nested header fields are now readonly,
  as the packet's all-properties-readonly requirement specifies. Runtime
  `adapters/native-chat-v1.mjs:184` and `:185` supplies the same names and literal
  values. This is a declaration-contract correction, not a claim that the
  runtime freezes the request headers.
- `types/native-chat.d.ts:100`: a validated receipt's result fingerprint is now
  `string`, rather than `string | null`. Runtime `adapters/native-chat-v1.mjs:199`
  copies the validated result's candidate fingerprint; the successful draft,
  repair, NO_CHANGE and review paths at `:94` through `:113`, after binding
  validation at `:66` through `:77`, all supply a string.
- `types/native-chat.d.ts:113` and `:117`: native repair resolves only REPAIRED
  or NO_CHANGE (runtime `adapters/native-chat-v1.mjs:105` through `:113`), and
  native review resolves only PASS or FAIL (runtime `:100`). The initial shared
  result types also admitted NOT_RUN/UNAVAILABLE and, for repair, FAIL. Native
  failures reject after recording an unavailable receipt (`:204` through `:208`),
  so the native method overrides now narrow those result statuses.
- Kept the owner brand as a type-only nominal constraint, documenting that no
  symbol is exposed at runtime. The actual identity test is the WeakMap at
  `adapters/native-chat-v1.mjs:7`, `:21` and `:55`.

No missing runtime receipt, lifecycle, request, usage or reported-stat field
was found. Runtime-to-AST key-set checks matched: validated receipt 29 fields,
unavailable receipt 25, request 5, owner lifecycle 6, receipt lifecycle 3,
usage and usageSource 3 each, reportedStats 6 when its optional field is present.
The stats shape and literals match `adapters/native-chat-protocol-v1.mjs:34`
through `:51`. Owner-state and transport-settlement unions match runtime
`adapters/native-chat-v1.mjs:15` and `:161`. UNAVAILABLE requires string code
and null usage; RESPONSE_VALIDATED has no code property. All 86 declaration
property signatures are readonly and there are no `any` keywords.

### Independent verification and provenance

- Before and after changes: `npm test` 3/3 and `npm run test:types` exit 0.
- Removed each of the ten consumer `@ts-expect-error` directives individually,
  before and after the declaration changes. Each run exited 2 with exactly one
  diagnostic at the intended next line: 74 TS2322, 76 TS2322, 78 TS2741,
  80 TS2339, 82 TS2339, 84 TS2339, 86 TS2741, 88 TS2339, 90 TS18047, 92 TS2322.
  Restored the consumer's original bytes after every run using a finally block;
  final compile exit 0 and the SHA256 below proves byte equality.
- In-memory compiler probes now reject all eight method reassignment attempts
  and both header assignments with TS2540; explicit undefined options and
  narrowed native result shapes compile. Additional runtime probes used only
  injected synthetic Response objects, covering draft, both repair outcomes,
  both review outcomes and unavailable receipts. No network/model call occurred.
- Initial declarations equal the single fenced worker result exactly after
  restoring the file's final newline. Worker result reports 52.2 seconds,
  acceptance exit 0, and no repair is retained. The job prompt contains no test
  source after its oracle heading. The packet says created 11:55 PDT, while
  the receipt says finished 11:25:54 PDT; those timestamps are inconsistent.
  The receipt contains no packet hash, so historical expected-hash binding is
  not independently demonstrated by these retained files. Current bytes and
  current tests were verified directly; no packet/receipt was regenerated.

### SHA256

- Declarations before (also extracted worker draft): `b473c4542c677cd300dc65647e87fc341a96a2a1915b83f8141822ac40333332`
- Declarations after: `4513f9e6e75f94b34f6216fae05a5f22e2c7c7baf8aa7dfd51f43fedcfbfbf51`
- Frozen workflow, unchanged and matching the required hash: `92d155a41afa9734bdf333419fb8d1bc5c129d4d5724979c8f3dd82a09e7dd18`
- Consumer before/after restoration: `8c5a6bec3593f2a20903bda436e592d2b40766e72f21fb411e0af7304ce1b1aa`
- Baseline tests, unchanged: `cdaddfbe564cfa7ccb4fe7f76fff87f1dfcf43895d3952f862f7a3b106ba2198`
- Packet, unchanged: `abb159785f58cd88dc55f48d7443c89e352fab33cc2b146c41c6257420c3131b`
- Runtime adapter, unchanged: `45f8149f2f526cab75ba5758aed8b05aeea136fa4cb107a8a45196045ce205bd`
- Runtime protocol, unchanged: `44468cb8b6ebc97e1821405a5add4916a97bf82b0ffeaa2076f85e79e12255f3`

### Later integration steps — not executed

1. After Louis's decision, copy the reviewed declaration to the product's
   `types/native-chat.d.ts` and verify its accepted SHA256 at the target.
2. Add `package.json` export `./adapters/native-chat` with
   `types: ./types/native-chat.d.ts` and
   `default: ./adapters/native-chat-v1.mjs`. Add the corresponding direct-path
   alias `./adapters/native-chat-v1.mjs` with the same targets, consistent with
   the product's existing typed adapter aliases.
3. Add these exact files entries: `adapters/native-chat-v1.mjs`,
   `adapters/native-chat-protocol-v1.mjs`, and `types/native-chat.d.ts`.
   The protocol file is an internal runtime dependency, not another public
   typed export. Existing local-chat and workflow dependencies are already listed.
4. Update the matching runtime/type/export allowlists in
   `scripts/private-package-contract.mjs`; `check:private-package` asserts exact
   equality with those lists, so editing package.json alone is insufficient.
5. Add an installed-package consumer for the native-chat export and a synthetic
   runtime import check, updating the rehearsal's explicit consumer/negative/
   test counts to the actual reviewed fixtures. Run product `npm run test:types`,
   the relevant native-chat runtime tests, then `npm run check:private-package`.
   Inspect the resulting archive inventory and receipt before claiming integration.

Permanent edits: `types/native-chat.d.ts` and this roadmap only. The consumer
was temporarily modified as explicitly requested and restored byte-for-byte.
Packet evidence, frozen workflow, product tree and run-journal were not edited.

## Product integration — Astra, 2026-09-13

Louis authorized integration in the Claude session at approximately 12:00 PDT: "Go for it". Astra remained the sole product writer.

The accepted declaration was copied byte-for-byte to `types/native-chat.d.ts`, SHA256 before/after `4513f9e6e75f94b34f6216fae05a5f22e2c7c7baf8aa7dfd51f43fedcfbfbf51`. Both short and direct runtime paths have typed exports, with the protocol retained as a runtime dependency. The compile oracle changes only imports to `nisi/adapters/native-chat` and `nisi/workflow`; all ten negative controls are unchanged. Product TypeScript passes six consumers. The inspected private archive contains 27 files and passes 39/39 negative controls plus 8/8 runtime checks, including a new synthetic alias/lifecycle case. The full product check currently has one pending inventory-cardinality assertion (24 versus required 27); see canonical roadmap/evidence. No full U02-03 or native-app acceptance is claimed.

[Canonical integration evidence](../../docs/verification/2026-09-13/five-work-order-integration/receipt.json) records exact source/test hashes, checks and limits. The original work-order source, assertions, handoff and receipts remain unchanged. Claude Fable 5.1 post-integration review remains pending.
