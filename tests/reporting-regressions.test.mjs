import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {canonicalJson,sha256Canonical} from '../scripts/common.mjs';

test('structural reporting preserves own prototype-named fields and distinct hashes', () => {
  const source = '{"__proto__":{"a":1},"nested":[{"__proto__":2}],"z":0}';
  const input = JSON.parse(source);
  assert.equal(canonicalJson(input), source);
  assert.notEqual(sha256Canonical(input), sha256Canonical({nested:[{}],z:0}));
  assert.equal(Object.getPrototypeOf(input), Object.prototype);
  assert.equal(canonicalJson({z:2,a:[null,true,{y:'x'}]}), '{"a":[null,true,{"y":"x"}],"z":2}');
});

test('purity CLI fails explicitly when its model executable does not exist', t => {
  const root=fileURLToPath(new URL('../',import.meta.url));
  const fixture=mkdtempSync(path.join(tmpdir(),'nisi-purity-test-'));
  t.after(()=>rmSync(fixture,{recursive:true,force:true}));
  const r=spawnSync(process.execPath,['scripts/ab-purity.mjs','contracts/structural-fixtures.json',path.join(fixture,'missing-model')],{cwd:root,encoding:'utf8',timeout:15000,maxBuffer:1048576});
  assert.equal(r.error,undefined);
  assert.equal(r.status,2);
  const report=JSON.parse(r.stdout);
  assert.equal(report.status,'INCOMPLETE');
  assert.equal(report.accuracy,null);
  assert.deepEqual(report.falseNegatives,[]);
  assert.deepEqual(report.falsePositives,[]);
});
