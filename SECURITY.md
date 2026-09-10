# Security

## What this code claims

Each module enforces a specific, written boundary and refuses across it with an
exact named code. `contracts/canonical-json-v1-profile.md` states what the codec
guarantees and, more importantly, what it does not.

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

## Reporting

Open a GitHub issue. This is a personal project, so please do not expect a
commercial response time. If you believe an issue should not be public, say so
in the issue without the details and I will follow up.
