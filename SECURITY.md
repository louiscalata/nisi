# Security

## Scope

Nisi v0.2 added a public command line for fixed workflow and local-model
demonstrations, plus the run journal and journal store in `history/`. The v0.1
workflow and its local-chat adapters remain part of the package. v0.3.0 adds an
optional Jev advisor (`adapters/jev-advisor.mjs`) that sends the task text, and
for the reviewer the candidate's file contents, to TypeSafe's hosted Jev service,
so treat it as a data boundary. It does so only when you pass a `judge`
function or set `TYPESAFE_API_KEY`, in which case the built-in client
(`adapters/jev-client.mjs`) sends one HTTPS request to a fixed TypeSafe endpoint
with that key as a Bearer token. The client refuses redirects, bounds the request
and response, times out, and never puts the key or the response body in an
error or log; the key is read from the environment, never stored by Nisi. The harder-task runner under `benchmarks/harder/` makes live model
calls and exists only in the source checkout. The CLI does
not execute arbitrary repository tasks or manage a model server. The v0.2
journal-specific evidence record does not establish new security properties
for every older API or external model service.

## What this code claims

Each module enforces a specific, written boundary and refuses across it with an
exact named code. `contracts/canonical-json-v1-profile.md` states what the codec
guarantees and, more importantly, what it does not.

The run journal validates its documented entry schema and hash-chain structure;
the store validates serialized journals before writing and refuses malformed or
incomplete journal files when reading. The Workflow Orchestrator validates
scoped task/candidate records, adapter-result schemas and
run/task/attempt/candidate bindings. It derives a completion status
from configured required stages. That status describes those checks; it is not
a security certification or permission to release software.

## What it does not claim

This has not been independently audited. It is not certified, and nothing in it
should be read as a verification, acceptance or correctness authority — the code
is deliberate about saying so in its own output, and this file will not say
otherwise.

Two limits are worth stating plainly because they are easy to misread:

- The codec trusts the host JavaScript realm and its built-ins. Refusing proxy
  inputs is not a sandbox and does not protect against code already running in
  the same realm replacing global `JSON`, string or `Buffer` functions.
- The consent gate proves that a declaration was presented and enforced. It is
  not captured user-interface consent, and a local process cannot witness one.

- File access relies on stable trusted parent directories. Descriptor identity,
  bounded reads and metadata checks reduce replacement races, but do not form
  an operating-system sandbox. Files with multiple hard links are refused. Binary hashing and launch also require a stable
  trusted helper directory. Revocation blocks future admission, not prior use.
- Workflow adapters are trusted code. Logical candidate paths do not grant or
  enforce filesystem permissions. Reviewer IDs are declarations, not proof of
  separate people or models. Read-only workflow mode skips authoring and repair;
  it cannot prevent callbacks or other processes from writing files.
- Model and test evidence can be well formed and still dishonest. The Apple
  helper's egress/persistence flags and a local HTTP endpoint's model/usage
  fields are validated reports, not independently witnessed facts.
- The local-chat client permits loopback HTTP only and refuses redirects. It
  does not authenticate the listening process or control that server's logging,
  forwarding, tools or inference location. The Apple-only file declaration
  never grants permission to send its admitted content to another destination.
- Cancellation stops the engine waiting and rejects late results. It cannot
  undo external effects, preempt synchronous JavaScript or guarantee an
  uncooperative callback stopped. Hosts must implement isolation and cleanup.
- The scoped static checker recognizes configured direct syntax patterns in
  one marked source region. It is not a general purity or dependency analysis.
- Journal hashes check internal consistency and detect damage that has not been
  rehashed. They are unkeyed: a writer can replace entries and recompute the
  fingerprints, chain and footer. `verified: true` is not authentication.
  Detecting malicious replacement requires a trusted digest or authentication
  outside the journal; `expectedPreviousSha256` alone is a sequential stale-write
  guard, not an append-only or project-continuity guarantee. A valid chain does
  not prove that recorded events happened as described.
- Journal redaction applies only at configured paths. Copies of a value at
  other paths remain stored. Neither redaction nor hashing proves that an
  original value cannot be inferred. Hosts must bound input bytes and rotate
  histories; payload retention is not a complete memory or disk quota.
- Journal-store durability depends on the filesystem and operating system
  honoring the requested sync and rename behavior. The API reports confirmed
  commit and durability separately; it cannot prove hardware persistence.
- Generic report storage is a trusted callback acknowledgement. Its receipt
  identifies the preliminary report; it does not establish retention or
  durable storage independently of the host.

## Reporting

Open a GitHub issue for public reports. Do not put sensitive exploit details
in a public issue. Use [GitHub private vulnerability reporting](https://github.com/louiscalata/nisi/security/advisories/new)
when available; otherwise open a minimal issue asking for a
private contact route. This personal project has no security bounty, promised
response time or service-level agreement.
