import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

test('baseline package stays private, dependency-free and ESM', async () => {
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(pkg.private, true);
  assert.equal(pkg.type, 'module');
  assert.equal(pkg.license, 'UNLICENSED');
  assert.equal(pkg.dependencies, undefined);
  assert.equal(pkg.devDependencies, undefined);
  assert.deepEqual(Object.keys(pkg.scripts), ['test', 'test:types']);
});

test('baseline frozen workflow declarations are byte-identical to the product copy', async () => {
  const workflow = await readFile(new URL('../types/workflow.d.ts', import.meta.url));
  assert.equal(workflow.length, 7315);
  assert.equal(sha256(workflow), '92d155a41afa9734bdf333419fb8d1bc5c129d4d5724979c8f3dd82a09e7dd18');
});

test('baseline declaration target exists as a module', async () => {
  const target = new URL('../types/native-chat.d.ts', import.meta.url);
  assert.ok((await stat(target)).isFile());
  const source = await readFile(target, 'utf8');
  assert.match(source, /\bexport\b/);
});
