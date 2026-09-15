import test from 'node:test';
import assert from 'node:assert/strict';
import { buildUsageTable as build } from '../src/index.mjs';
const row=patch=>({id:'a',stage:'draft',provider:null,model:null,inputTokens:2,outputTokens:3,reasoningTokens:1,durationMs:4,...patch});
test('unknown input on an earlier row cannot skip independent later columns',()=>{const r=build({runId:'r',rows:[row({inputTokens:null}),row({id:'b'})]});assert.deepEqual(r.totals,{inputTokens:null,outputTokens:6,reasoningTokens:2,totalTokens:null,durationMs:8});});
test('known reasoning/output contradiction is refused even when input tokens unknown',()=>assert.deepEqual(build({runId:'r',rows:[row({inputTokens:null,outputTokens:0,reasoningTokens:1})]}),{status:'REFUSED',reason:'INVALID_INPUT',authorizing:false}));
test('combined input and output overflow stays null although column sums individually fit',()=>{const r=build({runId:'r',rows:[row({inputTokens:Number.MAX_SAFE_INTEGER,outputTokens:1,reasoningTokens:0})]});assert.equal(r.rows[0].totalTokens,null);assert.equal(r.totals.totalTokens,null);});
test('unknown reasoning on one row does not skip later duration sums',()=>{const r=build({runId:'r',rows:[row({reasoningTokens:null}),row({id:'b'})]});assert.equal(r.totals.durationMs,8);assert.equal(r.totals.reasoningTokens,null);});
