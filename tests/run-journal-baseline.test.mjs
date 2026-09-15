import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as journal from '../history/run-journal-v1.mjs';

test('declared journal exports', () => {
  assert.deepEqual(Object.keys(journal).sort(), ['createRunJournal', 'reopen']);
});

test('source uses no ambient effects and at most the declared deterministic hash import', async () => {
  const src = await readFile(new URL('../history/run-journal-v1.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /\b(?:process|require|fetch|XMLHttpRequest|eval|Function|Date|performance|setTimeout|setInterval)\b|Math\.random|import\s*\(/);
  const imports = [...src.matchAll(/\bfrom\s*['"]([^'"]+)['"]/g)].map(x => x[1]);
  assert.ok(imports.every(x => x === 'node:crypto'));
  assert.doesNotMatch(src, /node:(?:fs|child_process|net|http|https)|randomUUID|randomBytes/);
});
