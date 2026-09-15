# Private Nisi CLI history approval integration

Coauthor a bounded implementation contract; tools disabled and no publication.
Return a concrete API/state design and at most five important failure cases. Do
not generate unrelated architecture, claim authenticated consent, or execute code.

Current source-grounded facts: examples/repository-live-model.mjs is the real
private user-invoked CLI. parseLiveDemoArguments(args) validates either legacy or
V3 explicit per-role loopback model selection and --approved-reviewed-fixture.
It must stay backward-compatible. runPrivateLiveDemo creates an owned .build
run directory, builds the fixed Swift kernel, constructs the actual reviewed
repository host, runs it, then calls collectLiveHostEvidenceV1(host,report,retain).
The collector retains engine-report.json, awaits host.settled with at most30sec
observation, retains host-result.json and returns {hostResult,errors}. Later the
CLI writes the live-model receipt and final summary. Execution remains a pinned
source-reviewed A/B fixture, not general generated code. This turn will not run
models or launch Swift; test transports/owners and actual temporary storage only.

The actual host now has historyPreview() and captureHistory({owner,declaration,clock}).
Preview is available only after host settlement and returns {schemaVersion,status,
reason,preview,sha256,authorizing:false}. Its fixed metadata body preserves run,
task/baseline/candidate identity (null candidate allowed), workflow/host outcomes,
stage counts, hashed diagnostics and false authenticity/execution/learning flags.
No raw source/path or error strings. capture binds exact preview digest and a
separate written declaration; validates clock twice, consumes before record,
never retries. Unexpected post-record result => UNCERTAIN INTERNAL_ERROR,
recordAttempted/consumed true, journal:null. Existing owner has explicit storage
open,record,inspect,maintenance; no authentication. Source APIs must not be weakened.

Proposed concrete change: optional --review-history flag handled in a new wrapper
argument parser before unchanged parseLiveDemoArguments. Default behavior identical.
Flag only enables interactive review; it does NOT approve storage. A fixed local
terminal shows escaped metadata + full digest, exact additional journal destination
inside the already-owned run directory, retention period (fixed14days initially),
no learning/publication and explicit warning that this demo ALREADY retains its
existing raw run evidence; this separate choice governs only additional metadata
journal storage. Type STORE plus full digest to approve. No TTY, stdin EOF, signal,
timeout, decline/malformed answer => no open/create/write of metadata journal.
The journal handle is opened only AFTER positive answer, using trusted Node fs;
declaration ID minted per review, project ID derived from task fingerprint,
current trusted wall clock, expiry1minute,14day retention. No arbitrary paths or
auto-sweeper, model calls, shell commands, security grants, self-improvement or
consent inference from execution flag. Existing report/receipt truth unchanged.

Need reusable small host-facing review function with injected trusted prompt
and open-owner callbacks for portable tests, called by actual CLI, not unused.
No new generic host lifetime wrapper. Root will supply real terminal adapter
and actual storage opener; add no callback after final admission validation.
Before/after asynchronous approval, preserve cancellation and deadline checks.
Validate/copy preview before prompting so typed answer binds exactly what was
shown; recheck host preview digest before owner opening/capture. Include an
explicit result in final CLI summary only when review was requested, to preserve
legacy summary shape. Keep intended write results if cancellation happens after
record admission. Consider bounded prompt cleanup and unrelated signal listeners.

Please critique this proposal and give the smallest effective implementation
contract/state machine, including whether to use an approval callback or parse
terminal text directly in orchestration. A UI confirmation is a trusted host
declaration, not authenticated identity. Hashes are not anonymization. Do not
propose weakening one-attempt consumption or storing raw preview/answers before
approval. Keep existing data/provenance/authorization boundaries visible.
