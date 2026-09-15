import test from 'node:test';
import assert from 'node:assert/strict';
import { buildComparisonTable as build } from '../src/index.mjs';
const row = patch => ({id:'r',label:'Measured sample',off:100,on:75,unit:'TOKENS',...patch});
const bad = {status:'REFUSED',reason:'INVALID_INPUT',authorizing:false};
test('empty comparison has exact neutral shape',()=>assert.deepEqual(build({rows:[]}),{schemaVersion:1,status:'READY',rows:[],summary:{total:0,knownPairs:0,unknownPairs:0},authorizing:false}));
test('known comparison computes signed change without a savings claim',()=>assert.deepEqual(build({rows:[row()]}),{schemaVersion:1,status:'READY',rows:[{...row(),delta:-25,relativeChangePercent:-25}],summary:{total:1,knownPairs:1,unknownPairs:0},authorizing:false}));
test('unknown values stay unknown and known zero is preserved',()=>{
  const r=build({rows:[row({id:'a',off:null}),row({id:'b',on:null}),row({id:'c',off:0,on:0})]});
  assert.deepEqual(r.rows.map(x=>[x.delta,x.relativeChangePercent]),[[null,null],[null,null],[0,null]]);
  assert.deepEqual(r.summary,{total:3,knownPairs:1,unknownPairs:2});
});
test('millisecond fractions retain unrounded change and units are not aggregated',()=>{
  const r=build({rows:[row({id:'a',off:3,on:4,unit:'CHECKS'}),row({id:'b',off:1.5,on:2,unit:'MILLISECONDS'})]});
  assert.equal(r.rows[0].relativeChangePercent,1/3*100);assert.equal(r.rows[1].delta,.5);
  assert.equal(Object.hasOwn(r,'totalSavings'),false);assert.equal(Object.hasOwn(r.summary,'delta'),false);
});
test('unsafe, nonfinite, negative and noninteger counts refuse',()=>{
  for(const x of [-1,-0,NaN,Infinity,Number.MAX_SAFE_INTEGER+1,.5]) for(const k of ['off','on']) assert.deepEqual(build({rows:[row({[k]:x})]}),bad);
  for(const unit of ['MILLISECONDS','TOKENS','CHECKS']) assert.deepEqual(build({rows:[row({unit,on:-1})]}),bad);
});
test('overflowing relative percentage is unknown not infinity',()=>{
  const r=build({rows:[row({off:Number.MIN_VALUE,on:Number.MAX_SAFE_INTEGER,unit:'MILLISECONDS'})]});
  assert.equal(r.rows[0].relativeChangePercent,null);assert.equal(r.summary.knownPairs,1);
});
test('closed shapes and unique bounded ids are required',()=>{
  for(const x of [null,[],{}, {rows:[],extra:1},{rows:new Array(201).fill(row())},{rows:[row(),row()]},{rows:[row({id:''})]},{rows:[row({label:'x'.repeat(129)})]},{rows:[row({unit:'ACCURACY'})]},{rows:[{...row(),approved:true}]},JSON.parse('{"rows":[],"__proto__":{}}')]) assert.deepEqual(build(x),bad);
});
test('rows preserve order and literal labels',()=>{
  const r=build({rows:[row({id:'z',label:'日本語 | <raw>'}),row({id:'a'})]});
  assert.deepEqual(r.rows.map(x=>x.id),['z','a']);assert.equal(r.rows[0].label,'日本語 | <raw>');
});
test('input and output are independent copies',()=>{
  const x={rows:[row()]},before=structuredClone(x),a=build(x);assert.deepEqual(x,before);
  x.rows[0].label='changed';assert.equal(a.rows[0].label,'Measured sample');a.rows[0].id='new';assert.equal(x.rows[0].id,'r');
});
test('deterministic repeated requests',()=>assert.deepEqual(build({rows:[row()]}),build({rows:[row()]})));
