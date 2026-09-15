# Reference authoring and review

Both local design/implementation attempts failed after finish:length, 7,999 reasoning tokens in their final response and no source writes. Protected files remained unchanged. The final permitted rerun therefore installs an explicit owner-reviewed reference.

Luna drafted the reference as plain TXT; Astra read it and corrected payload path traversal, signed payload integers, retry error semantics, retained null payload reopening, array symbols/prototypes, malformed Unicode keys, array-index traversal, return freezing and canonical parsing. The redundant hand-written duplicate-key scanner was removed: exact canonical byte comparison already rejects duplicate keys. No canonical source edit was made by Astra/Luna.

Reference validation redirected only the module import in memory to a data URL; original test files were not written or weakened. Results: 18/18 protected contract tests and 7/7 supplemental owner probes. These are reference results, not actual src/packet acceptance. Logs and exact hashes are retained in reference-validation.json.

Final source installation remains OpenCode's sole write operation and must be followed by wrapper acceptance, owner source/diff review and actual-source checks. No claim of independent OpenCode implementation authorship or measured token savings is made.
