import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildTimeline } from '../src/index.mjs';
test('private dependency-free ESM package',()=>{const p=JSON.parse(fs.readFileSync(new URL('../package.json',import.meta.url)));assert.equal(p.private,true);assert.equal(p.type,'module');assert.equal(p.license,'UNLICENSED');assert.equal(p.dependencies,undefined);});
test('named synchronous API placeholder exists',()=>assert.equal(typeof buildTimeline,'function'));
