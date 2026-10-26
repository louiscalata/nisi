---
packet: nisi-cli-argument-contract
project_root: ~/nisi
created_by: codex
created: 2026-09-19T16:45:00-07:00
write_owner: opencode
status: blocked
---

# Pure private Nisi CLI argument contract

## Context

Nisi is private and uses Node ESM with Node >=22. The existing repository demo
is explicitly fixture-only; the wrapper must not normalize or authorize demo
arguments. Root has decided the contract below. Only this new pure parser module
is delegated. It has no dependencies, filesystem effects, network, process
handling, dispatch or model code. `node --check` works here; `git diff --check`
passed before authoring. Behavioral acceptance is separately owned by Codex after
source inspection; a syntax receipt is not full CLI acceptance.

## Constraints

- Only create `cli/arguments.mjs`. Do not edit anything else, including existing
  source, tests, package.json, roadmap, packet, configuration or Git index.
- No dependencies, imports, I/O, globals mutation, installs, commits or publication.
- Do not invoke model tools, shell, compilers or acceptance commands yourself.
- No automatic runtime execution, permission changes or scope expansion.

## Items

### P1 — Define the pure parser
- **files**: cli/arguments.mjs
- **do**: Export function parseNisiArguments(args). Accept only a dense ordinary Array with 0 through 128 elements, every own indexed element an enumerable data property containing a string; reject sparse/accessor/non-string arrays and extra own properties. Each string UTF-16 length must be <=8192 and their total length <=65536. Never invoke indexed getters. Invalid input throws Error with message and code both NISI_CLI_ARGUMENTS. Empty args returns frozen {command:'help',args:Object.freeze([])}. Single help, --help or -h returns the same help result. Single version, --version or -v returns frozen {command:'version',args:Object.freeze([])}. Single doctor returns frozen {command:'doctor',args:Object.freeze([])}. Trailing args after help/version/doctor are invalid. If first string is demo, return frozen {command:'demo',args:Object.freeze(copyOfRemainingStrings)} with no transformations; any remaining flags, duplicates, -- separator and empty strings are preserved for the existing demo parser. Unknown commands throw the same fixed error without echoing any input. Copy through validated data descriptors, not user-overridable array methods; use Object.getOwnPropertyDescriptors and indexed loops. No Proxy-hostile isolation claim. All return objects and nested argument arrays must be frozen. A caller mutating its input afterward must not change the returned snapshot. No other exports are necessary.
- **accept**: node --check cli/arguments.mjs

## Packet acceptance
git diff --check
