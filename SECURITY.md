# Security

## Scope

Nisi v0.2 public security scope covers the run journal and journal store in
`history/`. The v0.1 workflow and its local-chat adapters remain part of the
package but are outside the v0.2 journal-specific evidence record. No model
service, external worker process, package registry, or production deployment
is operated by these journal/store modules.

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
  an operating-system sandbox. Binary hashing and launch also require a stable
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
- Journal hashes detect accidental or unauthorized content changes relative to
  the checked chain; they do not authenticate an author or provide a signature.
  A valid chain does not prove that recorded events happened as described.
- Journal-store durability depends on the filesystem and operating system
  honoring the requested sync and rename behavior. The API reports confirmed
  commit and durability separately; it cannot prove hardware persistence.
- Generic report storage is a trusted callback acknowledgement. Its receipt
  identifies the preliminary report; it does not establish retention or
  durable storage independently of the host.

## Reporting

Open a GitHub issue for public reports. Do not put sensitive exploit details
in a public issue. If GitHub private vulnerability reporting is enabled for
this repository, use that channel; otherwise open a minimal issue asking for a
private contact route. This personal project has no security bounty, promised
response time or service-level agreement.
