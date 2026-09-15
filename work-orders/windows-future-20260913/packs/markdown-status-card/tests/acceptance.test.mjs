import test from 'node:test';
import assert from 'node:assert/strict';
import { renderStatusCard as render } from '../src/index.mjs';
const prefix = '# Report\n\n| Field | Value |\n| --- | --- |\n';
const bad={status:'REFUSED',reason:'INVALID_INPUT',authorizing:false};
test('empty card has exact explicit empty row',()=>assert.deepEqual(render({title:'Report',fields:[]}),{schemaVersion:1,status:'READY',markdown:prefix+'| Status | No fields supplied |\n',authorizing:false}));
test('known zero, empty text and unknown remain distinct',()=>assert.equal(render({title:'Report',fields:[{label:'a',value:0},{label:'b',value:''},{label:'c',value:null}]}).markdown,prefix+'| a | 0 |\n| b |  |\n| c | UNKNOWN |\n'));
test('title and values cannot add headings or table columns',()=>{
  const r=render({title:'A | # <',fields:[{label:'x|y',value:'one\n# forged'}]});
  assert.equal(r.markdown,'# A &#x7C; &#x23; &#x3C;\n\n| Field | Value |\n| --- | --- |\n| x&#x7C;y | one&#xA;&#x23; forged |\n');
});
test('all specified ASCII metacharacters are escaped once',()=>{
  const codes=[60,62,38,34,39,124,92,96,35,91,93,40,41,42,95,33];
  const value=String.fromCodePoint(...codes),expected=codes.map(x=>'&#x'+x.toString(16).toUpperCase()+';').join('');
  assert.equal(render({title:'Report',fields:[{label:'raw',value}]}).markdown,prefix+'| raw | '+expected+' |\n');
  assert.equal(render({title:'Report',fields:[{label:'raw',value:'&#x41;'}]}).markdown,prefix+'| raw | &#x26;&#x23;x41; |\n');
});
test('control, separator and bidi characters are visible entities',()=>{
  const codes=[...Array.from({length:32},(_,i)=>i),...Array.from({length:33},(_,i)=>127+i),0x2028,0x2029,...Array.from({length:5},(_,i)=>0x202a+i),...Array.from({length:4},(_,i)=>0x2066+i)];
  for(const c of codes){const r=render({title:'Report',fields:[{label:'x',value:String.fromCodePoint(c)}]});assert.equal(r.markdown,prefix+'| x | &#x'+c.toString(16).toUpperCase()+'; |\n');}
});
test('ordinary Unicode and spaces are not normalized away',()=>assert.equal(render({title:'Report',fields:[{label:'日本語',value:'  café 🌱  '}]}).markdown,prefix+'| 日本語 |   café 🌱   |\n'));
test('closed shapes, bounds and invalid numeric values refuse',()=>{
  for(const x of [null,[],{}, {title:'Report',fields:[],extra:true},{title:'',fields:[]},{title:'x'.repeat(129),fields:[]},{title:'Report',fields:Array.from({length:51},()=>({label:'x',value:null}))},{title:'Report',fields:[{label:'',value:1}]},{title:'Report',fields:[{label:'x',value:'x'.repeat(2049)}]},{title:'Report',fields:[{label:'x',value:true}]},{title:'Report',fields:[{label:'x',value:NaN}]},{title:'Report',fields:[{label:'x',value:Infinity}]},{title:'Report',fields:[{label:'x',value:-0}]},{title:'Report',fields:[{label:'x',value:Number.MAX_SAFE_INTEGER+1}]},{title:'Report',fields:[{label:'x',value:1,extra:1}]},JSON.parse('{"title":"Report","fields":[],"__proto__":{}}')]) assert.deepEqual(render(x),bad);
});
test('duplicate labels remain separate supplied rows',()=>assert.equal(render({title:'Report',fields:[{label:'same',value:1},{label:'same',value:2}]}).markdown,prefix+'| same | 1 |\n| same | 2 |\n'));
test('negative and fractional numeric fields render literally',()=>assert.equal(render({title:'Report',fields:[{label:'delta',value:-1.5}]}).markdown,prefix+'| delta | -1.5 |\n'));
test('render is deterministic and does not mutate inputs',()=>{const x={title:'Report',fields:[{label:'x',value:'y'}]},before=structuredClone(x);assert.deepEqual(render(x),render(x));assert.deepEqual(x,before);});
