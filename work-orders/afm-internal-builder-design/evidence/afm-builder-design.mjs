export default {
  learningModel: {
    principle: "No fine-tuning and no model-weight updates. The on-device AFM learns from accepted project history by retrieving a pinned Project Knowledge Base and composing task-specific context packs.",
    mechanism: "Accepted receipts populate the KB; each turn retrieves relevant KB entries plus the current work-order manifest and forms a prompt. The model proposes edits as structured output, but the KB itself remains immutable, hash-pinned, and sourced only from accepted work."
  },
  contextPack: {
    contents: [
      "Pinned KB slices selected by task similarity",
      "Current work-order manifest and item list",
      "Read-only files named by the item",
      "Receipt schema and accept command signatures",
      "Model build identifier and capability grant version"
    ],
    hashing: "The pack is canonicalized (sorted keys, deterministic line endings, UTF-8) and hashed as packHash; the manifest hash and proposal hash are computed over the same canonical form. packHash is recorded in the receipt."
  },
  capabilityLadder: {
    description: "Tool grants are ordered, manifest-pinned, and consent-gated. Each grant is a strict superset of the previous and is disabled by default.",
    rungs: [
      { name: "read", scope: "Read only files listed in the current item", pin: "item.files + manifestHash" },
      { name: "deterministic_test_run", scope: "Run bounded, deterministic tests or checks named in the item", pin: "test command argv + manifestHash" },
      { name: "scoped_staging_write", scope: "Write only to paths inside the item's lane/staging directory", pin: "target path prefix + manifestHash" },
      { name: "staged_swift_compile", scope: "Invoke swiftc/build actions in a sandbox on staged sources, no network", pin: "compiler invocation + source hashes + manifestHash" }
    ]
  },
  receiptIntegration: {
    flow: "The model emits a typed Proposal. The executor applies the proposal only within the granted lane. Real accept commands run and produce exit codes. The receipt captures packHash, manifestHash, modelBuild, proposalHash, toolCalls, and the exit code.",
    acceptance: "Acceptance authority is never held by the model. A proposal is accepted only when oracle/human-signed accept commands exit 0. The receipt is appended to the KB only after acceptance, preventing feedback loops from rejected output."
  },
  guardrails: {
    failureModes: [
      "Model hallucinates files or edits outside the lane",
      "Recursive self-improvement loop from unaccepted receipts",
      "Pack exceeds token budget and drops critical context",
      "Prompt injection through imported KB content",
      "Covert tool-use escalation between grant rungs"
    ],
    mitigations: [
      "Enforce exact item.files and lane path prefix at the executor",
      "Only accepted receipts enter the KB; rejected outputs are discarded",
      "Budget tokens and truncate with an explicit overflow marker",
      "Sanitize and hash-pin all KB entries; load by hash, not path",
      "Grants advance only through explicit consent and manifest update",
      "No network, no code signing, no publication, no git push inside the executor"
    ]
  },
  firstIncrement: {
    scope: "A single read-only advisory item: given a work-order manifest, produce a typed Proposal object (file path + explanation) and run a JS syntax check on the proposal output. No writes, no compilation, no acceptance authority.",
    successSignal: "node --check passes on the generated proposal module and a human/oracle reviews the proposal against the manifest."
  },
  risks: [
    "On-device context window limits may exclude large manifests.",
    "Greedy decoding can repeat patterns from stale KB receipts.",
    "Pinning every grant increases manifest size and maintenance cost.",
    "A compromised or poisoned KB entry could steer proposals until detected.",
    "User expectation of autonomy may outrun the consent-gated design."
  ]
};
