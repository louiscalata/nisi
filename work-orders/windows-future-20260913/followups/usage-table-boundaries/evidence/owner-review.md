# Owner review of Qwen boundary-test draft

The retained `draft-1.json` outer receipt is valid JSON, but its `output` string
is not valid JSON because literal `\n` tokens appear outside the nested content
string. It is not called a compliant returned artifact. The single declared
path and quoted content value were uniquely recoverable. The exact decoded code
was installed first and retained byte-for-byte as
`evidence/initial-windows-boundaries.test.mjs`, SHA256
`23c8fed06bb1466cfe2bc0c60d0fbbe12ef25c0090d64d02b5947bd984f0b179`.

The five expected-result groups are mathematically consistent with the packet:

- a finite duration may exceed MAX_SAFE, but its aggregate is null;
- 1.25 + 2.5 = 3.75;
- MAX_SAFE input plus one output makes only the derived total overflow;
- a null input makes input and derived-total aggregates unknown without erasing
  independently known output, reasoning or duration columns;
- 200 rows is the inclusive cap, with totals 200, 400, 200, 600 and 100.

Owner strengthening added only `authorizing:false` assertions to groups 2-5 and
input/copy isolation assertions to the 200-row group. No expected arithmetic,
test name, worker-authored row or production file was changed.

These are Qwen-authored tests reviewed and executed by the Mac owner. They are
not an independent review of the Qwen-authored implementation and do not resolve
the missing GPT-OSS Windows review.
