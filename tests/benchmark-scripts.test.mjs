import test from 'node:test';
import assert from 'node:assert/strict';
import {classifyProcessResult,runPurityComparison,PURITY_PROMPT} from '../scripts/ab-purity.mjs';
import {runCanonicalBenchmark} from '../scripts/bench.mjs';
import {canonicalizeJSONV1} from '../canonical/canonical-json-v1.mjs';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const fixtures={schemaVersion:1,mutations:[{id:'effect',source:'fetch("https://example.invalid");',expectedRule:'network-effect'}],allowed:[{id:'clean',source:'const count = 1;'}]};
const success=stdout=>({status:0,signal:null,stdout});
const counter=()=>{let value=0;return()=>value++;};

test('purity accepts only exact successful verdicts, not tokens inside prose', () => {
  for(const [stdout,answer] of [['PURE','PURE'],[' \nIMPURE\r\n','IMPURE']]) assert.deepEqual(classifyProcessResult(success(stdout)),{status:'ANSWERED',answer,code:null});
  for(const stdout of ['pure','Pure','Answer: PURE','PURE IMPURE','IMPURE then PURE','```PURE```','',null,Buffer.from('PURE')]) {
    assert.equal(classifyProcessResult(success(stdout)).status,'INVALID_OUTPUT');
    assert.equal(classifyProcessResult(success(stdout)).answer,null);
  }
  for(const r of [null,{}, {...success('PURE'),status:1}, {...success('PURE'),status:null}, {...success('PURE'),signal:'SIGTERM'}, {...success('PURE'),error:{code:'ETIMEDOUT'}}]) {
    assert.equal(classifyProcessResult(r).status,'UNAVAILABLE');
    assert.equal(classifyProcessResult(r).answer,null);
  }
});

test('purity separates valid errors from unavailable and unrun cases', () => {
  let calls=0;
  const r=runPurityComparison(fixtures,'synthetic-cli',{clock:counter(),run:()=>{calls++;return{error:{code:'ENOENT'},status:null,signal:null,stdout:'IMPURE'};}});
  assert.equal(calls,1);assert.equal(r.status,'INCOMPLETE');assert.equal(r.cases,2);
  assert.equal(r.attemptedCases,1);assert.equal(r.answeredCases,0);assert.equal(r.notRunCases,1);
  assert.equal(r.unavailableCases,1);assert.equal(r.invalidOutputCases,0);
  assert.equal(r.accuracy,null);assert.equal(r.answeredDecisionAccuracy,null);
  assert.equal(r.correctPerAttempt,0);assert.equal(r.timings.medianAnsweredMs,null);
  assert.deepEqual(r.falsePositives,[]);assert.deepEqual(r.falseNegatives,[]);
  assert.deepEqual(r.rows.map(r=>r.correct),[null,null]);assert.equal(r.usage,null);
});

test('partial valid decisions never become a complete accuracy claim', () => {
  const replies=['IMPURE','maybe PURE'];
  const r=runPurityComparison(fixtures,'synthetic-cli',{clock:counter(),run:()=>success(replies.shift())});
  assert.equal(r.status,'INCOMPLETE');assert.equal(r.attemptedCases,2);assert.equal(r.answeredCases,1);
  assert.equal(r.invalidOutputCases,1);assert.equal(r.accuracy,null);
  assert.equal(r.answeredDecisionAccuracy,1);assert.equal(r.correctPerAttempt,0.5);
  assert.equal(r.rows[1].correct,null);assert.deepEqual(r.falsePositives,[]);
});

test('complete incorrect decisions count actual false positives and negatives', () => {
  const replies=['PURE','IMPURE'];let seen=0;
  const r=runPurityComparison(fixtures,'synthetic-cli',{clock:counter(),run:(exe,args,options)=>{
    seen++;assert.equal(exe,'synthetic-cli');assert.deepEqual(args,['--mode','text']);
    assert.equal(options.shell,false);assert.equal(options.timeout,60000);assert.equal(options.maxBuffer,65536);assert.equal(options.killSignal,'SIGKILL');
    assert.ok(options.input.startsWith(PURITY_PROMPT));return success(replies.shift());
  }});
  assert.equal(seen,2);assert.equal(r.status,'COMPLETE');assert.equal(r.accuracy,0);
  assert.deepEqual(r.falseNegatives,['effect']);assert.deepEqual(r.falsePositives,['clean']);
  assert.equal(r.timings.totalAttemptedMs,2);assert.equal(r.timings.medianAnsweredMs,1);
  assert.equal(r.reportedModel,null);assert.equal(r.schemaVersion,2);
  assert.match(r.fixtureSha256,/^[a-f0-9]{64}$/);assert.match(r.promptSha256,/^[a-f0-9]{64}$/);
});

test('complete successful decisions preserve a valid denominator and null token usage', () => {
  const replies=['IMPURE','PURE'];
  const r=runPurityComparison(fixtures,'synthetic-cli',{clock:counter(),run:()=>success(replies.shift())});
  assert.equal(r.accuracy,1);assert.equal(r.answeredCases,r.cases);assert.equal(r.correct,r.cases);assert.equal(r.usage,null);
});

test('purity input and clock validation fail before producing misleading reports', () => {
  let calls=0;const run=()=>{calls++;return success('PURE');};
  for(const f of [{}, {...fixtures,schemaVersion:2}, {...fixtures,mutations:[] ,allowed:[]}, {...fixtures,allowed:[{id:'effect',source:'x'}]}])assert.throws(()=>runPurityComparison(f,'synthetic-cli',{run}),/PURITY_FIXTURES_INVALID/);
  assert.equal(calls,0);
  assert.throws(()=>runPurityComparison(fixtures,'',{run}),/PURITY_CONFIG_INVALID/);
  assert.throws(()=>runPurityComparison(fixtures,'synthetic-cli',{run,clock:()=>NaN}),/PURITY_CLOCK_INVALID/);
  const r=runPurityComparison(fixtures,'synthetic-cli',{clock:counter(),run:()=>{throw Object.assign(Error('synthetic'),{code:'EIO'});}});
  assert.equal(r.status,'INCOMPLETE');assert.equal(r.rows[0].code,'EIO');assert.equal(r.rows[1].status,'NOT_RUN');
});

test('canonical benchmark checks all four exact refusal codes against real codec', () => {
  const r=runCanonicalBenchmark({iterations:2,targets:[64]});
  assert.equal(r.schemaVersion,2);assert.equal(r.admit.length,1);
  assert.deepEqual(r.refuse.map(r=>r.code),['INVALID_JSON_INPUT','INVALID_JSON_SIZE','INVALID_JSON_DEPTH','INVALID_JSON_SYNTAX']);
  assert.ok(r.refuse.every(r=>r.conformanceChecked===true&&r.iterations===2));
});

test('canonical benchmark rejects an always-accepting codec and wrong refusal codes', () => {
  assert.throws(()=>runCanonicalBenchmark({codec:()=>({}),iterations:1,targets:[64]}),/BENCHMARK_EXPECTED_REFUSAL/);
  assert.throws(()=>runCanonicalBenchmark({codec:input=>{if(!(input instanceof Uint8Array))throw Object.assign(Error('wrong'),{code:'WRONG_CODE'});return canonicalizeJSONV1(input);},iterations:1,targets:[64]}),/BENCHMARK_EXPECTED_REFUSAL/);
});

test('canonical benchmark requires refusal on every warm-up and timed invocation', () => {
  let refusalCalls=0;
  assert.throws(()=>runCanonicalBenchmark({codec:input=>{if(!(input instanceof Uint8Array)&&++refusalCalls>1)return{};return canonicalizeJSONV1(input);},iterations:1,targets:[64]}),/BENCHMARK_EXPECTED_REFUSAL/);
  assert.equal(refusalCalls,2);
});

test('canonical benchmark bounds injected run options', () => {
  for(const options of [{iterations:0},{iterations:10001},{targets:[]},{targets:[Infinity]},{codec:null}])assert.throws(()=>runCanonicalBenchmark(options),/BENCHMARK_CONFIG_INVALID/);
});

test('canonical benchmark CLI prints complete checked results and exits successfully', () => {
  const r=spawnSync(process.execPath,['scripts/bench.mjs'],{cwd:fileURLToPath(new URL('../',import.meta.url)),env:{...process.env,NISI_BENCH_JSON:'1'},encoding:'utf8',timeout:60000,maxBuffer:1048576});
  assert.equal(r.error,undefined);assert.equal(r.status,0,r.stderr);
  for(const code of ['INVALID_JSON_INPUT','INVALID_JSON_SIZE','INVALID_JSON_DEPTH','INVALID_JSON_SYNTAX'])assert.ok(r.stdout.includes(code),code);
  assert.equal(r.stdout.split('\n').filter(line=>line.startsWith('  admit ')).length,4);
  const report=JSON.parse(r.stdout.slice(r.stdout.indexOf('\n{')+1));
  assert.equal(report.schemaVersion,2);assert.equal(report.admit.length,4);
  assert.equal(report.refuse.length,4);assert.ok(report.refuse.every(row=>row.conformanceChecked));
});
