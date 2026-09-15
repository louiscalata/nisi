// CLI selection only; no model execution or fixture build.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { expectedCases, baseArgv } from './helpers/v3-cli-expected.mjs';
import { parseLiveDemoArguments, runPrivateLiveDemo } from '../examples/repository-live-model.mjs';
import { withPreflightGuards } from './helpers/live-cli-side-effect-guard.mjs';
const cases = JSON.parse(fs.readFileSync(new URL('./fixtures/v3-cli-cases.json', import.meta.url)));
test('OpenCode V3 data matches every prescribed argument and expected outcome', () => assert.deepEqual(cases, expectedCases));
for (const row of cases) test(`actual V3 CLI parser: ${row.id}`, () => {
  if (row.acceptV3) {
    const selected = parseLiveDemoArguments(row.argv);
    assert.ok(Object.isFrozen(selected)); assert.ok(Object.isFrozen(selected.author));
    assert.ok(['NATIVE_API', 'CHAT_COMPLETIONS'].includes(selected.author.api));
    assert.ok(['NATIVE_API', 'CHAT_COMPLETIONS'].includes(selected.reviewer.api));
    assert.notEqual(selected.author.model, selected.reviewer.model);
  } else assert.throws(() => parseLiveDemoArguments(row.argv));
});
test('invalid V3 options refuse before compiler, fixture reads, materialization or network', async () => {
  await withPreflightGuards(async ({ reads }) => {
    for (const row of cases.filter(r => !r.acceptV3)) await assert.rejects(runPrivateLiveDemo(row.argv));
    assert.deepEqual(reads, []);
  });
});
test('V3 must not leak per-role options into the legacy route or accept same native instance', () => {
  const legacy = ['--approved-reviewed-fixture', '--endpoint', 'http://127.0.0.1:1234/v1/chat/completions', '--author-model', 'a', '--reviewer-model', 'b'];
  for (const flag of ['--author-endpoint','--reviewer-instance','--author-profile','--reviewer-reasoning'])
    assert.throws(() => parseLiveDemoArguments([...legacy, flag, 'extra']));
  const argv = baseArgv(); argv.splice(argv.indexOf('--reviewer-output-mode'), 2);
  argv[argv.indexOf('--reviewer-api') + 1] = 'NATIVE_API'; argv[argv.indexOf('--reviewer-endpoint') + 1] = 'http://127.0.0.1:1234/api/v1/chat';
  argv.push('--reviewer-instance', 'synthetic.instance', '--reviewer-profile', 'nisi-native-chat-content-v1', '--reviewer-reasoning', 'off');
  assert.throws(() => parseLiveDemoArguments(argv));
});
