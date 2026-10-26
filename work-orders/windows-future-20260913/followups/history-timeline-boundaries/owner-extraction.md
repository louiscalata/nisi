# Owner extraction and assertion review

The worker outer `output` is noncompliant: it is fenced and contains literal
escape text outside JSON strings. It was not parsed or represented as a valid
artifact envelope. A bounded scan found exactly one complete JSON string paired
with the exact path `tests/windows-boundaries.test.mjs`; strict JSON decoding of
that string produced 4,135 bytes, 115 newline characters, no terminal LF, and
SHA-256 `dac942115b19eab97eb542ec2e662b54de8c953507a3d3d18331774683be817d`.
The original bytes remain retained losslessly in `draft-1.json` as that JSON
string. No generated text was evaluated during extraction.

Every worker assertion was reviewed against `worker-request.md` before running:

- The 200-row case follows the inclusive cap, stable original-index tie-break,
  one attempt group, sequences 1 through 200, and 100 null durations.
- Length-128 strings are valid inclusive bounds and must be copied unchanged.
- `Number.MAX_SAFE_INTEGER` is the inclusive maximum for attempt and createdAt.
- Duration is finite nonnegative number, not safe-integer capped, so
  `Number.MAX_VALUE` and `1.5` must be copied and neither is unknown.
- The explicit B, C, A order follows attempt ascending, then createdAt ascending;
  its two groups and statuses must follow that sorted order without inference.

Owner additions only filled contract assertions omitted by the draft:
`authorizing:false` in groups 2-5, exact status preservation in groups 2, 4,
and 5, and both group-5 `unknownDurations` values. `apply_patch` also supplied a
terminal LF. There were no rewrites, removals, source changes, or existing-test
changes. The installed file is 125 lines and SHA-256
`2c22e9093c2d55fad816748a3332a19c488b6b7ff5d2181fea2186518ca2e8da`.

Exact original-to-installed transformation:

```diff
+  assert.strictEqual(result.authorizing, false); // groups 2, 3, 4, and 5
+  assert.strictEqual(result.events[0].status, 'INCONCLUSIVE');
+  assert.deepStrictEqual(result.events.map(event => event.status), ['PASS', 'FAIL']);
+  assert.deepStrictEqual(result.events.map(event => event.status), ['FAIL', 'INCONCLUSIVE', 'PASS']);
+  assert.strictEqual(result.attempts[0].unknownDurations, 0);
+  assert.strictEqual(result.attempts[1].unknownDurations, 1);
```

The installed file additionally ends with one LF; the decoded worker source did
not. The repeated `authorizing` summary above represents four inserted lines.
