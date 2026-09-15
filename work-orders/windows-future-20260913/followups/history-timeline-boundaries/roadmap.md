# history-timeline boundary tests — private follow-up

Overall Nisi progress: 30% (3/10). Status: ACCEPTED_TEST_EXTENSION_ONLY.
New checks: 5/5 passed; a relevant deliberate isolated defect was caught.
Exact worker/owner transformations and full outputs: [verification.json](verification.json).
Implementation independent review is still missing; this does not accept the module.
This is additional test code for the existing isolated module, not product integration.

Read [the complete request](worker-request.md). Only the named pack's new
tests/windows-boundaries.test.mjs may be installed after owner review. All existing
sources/tests/package/packets are protected. Read and justify every expected result;
reject imports or effects outside the three declared modules. Run the new file with
node --test --test-timeout=10000 tests/windows-boundaries.test.mjs, then existing checks.
Verify the new oracle catches at least one deliberate relevant defect in an isolated
retained copy, without altering canonical/pack source or weakening assertions.
Retain raw response, source/hash/command outputs and exact corrections. These are Qwen
test drafts, not an independent review of Qwen's implementation. Missing GPT review
still prevents module owner acceptance. No model changes, native execution or publication.
