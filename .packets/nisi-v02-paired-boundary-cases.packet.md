---
packet: nisi-v02-paired-boundary-cases
project_root: ~/nisi
created_by: codex
created: 2026-09-19T18:09:00-07:00
write_owner: opencode
status: blocked
---

# Synthetic resource-boundary fixtures for private paired-result analysis

## Context

This is private Nisi v0.2 engineering. One mechanical data-file task, not an
invitation to inspect the repository. The TypeScript consumer command below
passed on this host during authoring. The target file is absent. Root owns
all other files and will inspect this data source before importing it and
running semantic tests. The packet acceptance proves syntax/type baseline only,
not correctness, benchmarking, inference quality, release or product acceptance.

## Constraints

- Write only evaluation/fixtures/paired-v2-boundaries.mjs.
- No imports, functions, getters, computed properties, spread, calls, loops,
  executable logic or side effects in that file: export literal data only.
- No credentials, network, installs, commits, model routing, other files or commands.
- Do not edit this packet, roadmap, package metadata, tests or configuration.
- Do not execute generated code. Wrapper-owned checks are syntax/type checks only.
- Data is SYNTHETIC. It contains no real run/provider/personal information.

## Items

### P1 — Create the explicit token-boundary fixture matrix
- **files**: evaluation/fixtures/paired-v2-boundaries.mjs
- **do**: Create a comment identifying synthetic data and exactly one export, `export const PAIRED_V2_BOUNDARIES = [...]`. Each row has exact keys id, off, on, expected. off/on are two-element arrays for case.one/case.two; each element is null or literal {input,output}. expected has exact keys completeCaseCount, offUnknownCount, onUnknownCount, offOverflowCount, onOverflowCount, offAggregateOverflow, onAggregateOverflow. Write exactly these six rows, in order: (1) known: off [{input:80,output:20},{input:80,output:20}], on [{input:40,output:10},{input:40,output:10}], expected 2,0,0,0,0,false,false; (2) unknown-left: off [null,{input:80,output:20}], on [{input:40,output:10},{input:40,output:10}], expected 1,1,0,0,0,false,false; (3) all-unknown: off [null,null], on [null,null], expected 0,2,2,0,0,false,false; (4) row-overflow: off [{input:9007199254740991,output:1},{input:0,output:0}], on [{input:0,output:0},{input:0,output:0}], expected 1,0,0,1,0,false,false; (5) aggregate-overflow: off [{input:9007199254740990,output:0},{input:2,output:0}], on [{input:0,output:0},{input:0,output:0}], expected 2,0,0,0,0,true,false; (6) mixed-unknown-overflow: off [null,{input:9007199254740991,output:1}], on [{input:9007199254740991,output:1},null], expected 0,1,1,1,1,false,false. Integers must remain exact literals; no Number.MAX_SAFE_INTEGER or arithmetic expressions. The expected positional values listed here map to the expected keys in their listed order, not to an array. Do not add extra cases or helper logic. Use readable formatting and final newline.
- **accept**: node --check evaluation/fixtures/paired-v2-boundaries.mjs

## Packet acceptance
npm run test:types
