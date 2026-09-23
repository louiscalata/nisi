# Changelog

Changes to the public Nisi package are recorded here. This file describes the
public source tree and does not include private experiments.

## 0.2.0-rc.2

- Reject a retained run-journal entry on reopen when its recorded fingerprint
  differs from the validated, redacted entry. This prevents a crafted, rehashed
  journal from reversing duplicate and conflict classification for that ID.

## 0.2.0-rc.1

- Add the append-only run journal with entry validation, configured payload
  redaction, expiry/revocation handling, canonical serialization and verified
  reopen reporting.
- Add a journal store that validates serialized data and uses a same-directory
  temporary file, synchronization, read-back and rename; commit and durability
  are reported separately. On Windows, request directory synchronization through
  a write-access handle; an unsuccessful sync still reports non-durable.
- Retain Nisi v0.1 workflow and local-chat APIs as the existing package
  compatibility surface.
- Limit package exports to declared runtime modules. Undocumented deep imports
  of package internals that resolved through the previous wildcard may stop
  resolving; no recovery worker is shipped.
- Restrict GitHub Actions workflow token permissions to repository contents
  read-only and pin checkout/setup-node to reviewed commit SHAs.

See [the v0.2 verification record](docs/verification-v0.2.md) for the narrow
verification scope and its limits. This release candidate does not claim full
platform support, live provider behavior, performance gains, or production
readiness.
