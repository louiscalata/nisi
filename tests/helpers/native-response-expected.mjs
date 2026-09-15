// Owner-authored exact fixture intent; the executor must not edit this file.
export const baseline = () => ({
  model_instance_id: 'synthetic.instance',
  output: [{ type: 'message', content: '{"ready":true}' }],
  stats: {
    input_tokens: 10,
    total_output_tokens: 5,
    reasoning_output_tokens: 0,
    tokens_per_second: 10,
    time_to_first_token_seconds: 0.1,
  },
});
const text = mutate => {
  const value = baseline();
  if (mutate) mutate(value);
  return JSON.stringify(value);
};
const row = (id, responseText, expectEnvelopeAccepted = false) => ({ id, responseText, expectEnvelopeAccepted });
export const expectedCases = [
  row('baseline-single-message', text(), true),
  row('wrong-instance', text(value => { value.model_instance_id = 'different.instance'; })),
  row('response-id-forbidden', text(value => { value.response_id = 'stored.response'; })),
  row('empty-outer', ''),
  row('duplicate-outer-key', text().replace('{"model_instance_id":', '{"model_instance_id":"synthetic.instance","model_instance_id":')),
  row('malformed-outer', '{'),
  row('unknown-envelope-field', text(value => { value.finish_reason = 'stop'; })),
  row('multiple-messages', text(value => { value.output.push({ type: 'message', content: '{"ready":true}' }); })),
  row('reasoning-item', text(value => { value.output = [{ type: 'reasoning', content: 'synthetic reasoning' }]; })),
  row('tool-call-item', text(value => { value.output = [{ type: 'tool_call' }]; })),
  row('invalid-tool-call-item', text(value => { value.output = [{ type: 'invalid_tool_call' }]; })),
  row('bad-performance-stats', text(value => { value.stats.tokens_per_second = -1; })),
  row('unknown-stats-field', text(value => { value.stats.total_tokens = 15; })),
  row('output-cap-equality', text(value => { value.stats.total_output_tokens = 128; })),
  row('output-over-cap', text(value => { value.stats.total_output_tokens = 129; })),
  row('fractional-token-count', text(value => { value.stats.input_tokens = 10.5; })),
  row('negative-token-count', text(value => { value.stats.input_tokens = -1; })),
  row('overflow-token-count', text(value => { value.stats.input_tokens = 9007199254740992; })),
  row('reasoning-tokens-nonzero', text(value => { value.stats.reasoning_output_tokens = 1; })),
  row('message-missing-content', text(value => { value.output = [{ type: 'message' }]; })),
];
