import test from 'node:test';
import assert from 'node:assert/strict';
import { formatNativeProbeSummary } from '../hosts/macos-xpc/native-probe-summary.mjs';

test('baseline formatter export is synchronous text and does not mutate its view', () => {
  const view = Object.freeze({ runId: 'baseline' });
  assert.equal(typeof formatNativeProbeSummary, 'function');
  assert.equal(typeof formatNativeProbeSummary(view), 'string');
  assert.deepEqual(view, { runId: 'baseline' });
});
