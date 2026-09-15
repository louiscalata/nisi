# Owner extraction and oracle review

`draft-1.json` is valid outer JSON, but its `output` value is a Markdown-fenced JSON object, not the requested strict whole-response JSON. The fence contains one unambiguous `path`/`content` pair. Its decoded content was preserved byte-for-byte as `initial-windows-boundaries.test.mjs` before owner changes; this is a unique extraction, not a compliant worker response.

For indices 0 through 199, residues modulo three occur 67 times for residue 0, 67 times for residue 1, and 66 times for residue 2. Because the fixture cycles both availability and location by that residue, the exact expected axes are 67/67/66 and each axis must conserve to total 200.

Owner-only additions to the pack test:

- explicit conservation assertions for both count axes;
- `authorizing === false` assertions in the 128-character and independent-axis cases;
- expansion of post-return mutation coverage from three rows to the requested maximum 200 rows;
- independent deep snapshots instead of self-referential expected values;
- input non-mutation and top-level/row alias assertions;
- mutations at the first, middle, and last rows before the retained push/reverse mutations.

No production source or pre-existing test was changed. The worker-authored tests are supplemental boundary evidence, not independent review or acceptance of the source implementation.
