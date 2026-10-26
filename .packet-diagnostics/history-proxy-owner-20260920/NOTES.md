# History-owner proxy-boundary proposal

This directory is an isolated proposal only. The patch is not applied to the
canonical checkout and no tests were executed.

Affected production boundary:

- `history/journal-owner-v2.mjs` — `envelope()` is the closed input boundary
  used by `openJournalOwner`, `inspectJournalOwner`, `recordJournalObservation`,
  `maintainJournalOwner`, and the internal store-response validation. The patch
  rejects ordinary and revoked Proxy values before prototype/own-key/descriptor
  reflection while preserving existing `INVALID_INPUT`/`PLAIN_DATA` outcomes.
- `plainCopy()` is the nested-data boundary used by journal configuration,
  serialized recovery, entries, staged records, and frozen snapshots. The patch
  rejects a Proxy before `Object.getPrototypeOf`, `Reflect.ownKeys`, or
  descriptor access, including nested entry/config values.

The appended regression uses the existing `tests/journal-maintenance-v1.test.mjs`
helpers and exported call paths. It covers top-level request, config, nested
entry, ordinary Proxy, revoked Proxy, and zero trap invocation. It does not
replace the existing malformed/accessor/replay/conflict/uncertain-write tests.

Likely verification pins affected after application:

- the `node:util` import and the exact source digest for
  `history/journal-owner-v2.mjs`;
- the test-file digest and targeted journal-maintenance test count;
- any private CLI/package source manifest that includes the history-owner file;
- the existing C04–C09 source/acceptance manifests if this file is integrated.

No runtime, provider, authentication, native UI, package installation,
publication, or acceptance authority is introduced. `node:util` is a Node
runtime dependency already available to the supported Node lane; the patch does
not alter the writer schema, journal schema, project/config binding, or durable
store protocol.
