import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {inspectOwnerCapture} from './c09-owner-capture-check.mjs';
import {collectOwnerContext} from './c09-owner-context.mjs';

const ROOT=path.resolve(path.dirname(new URL(import.meta.url).pathname),'..','runtime-node24-TyjDOb');
const NAMES=['capture.json','intent.json','receipt.json','archive.tgz','expected.json','stdout.log','stderr.log'];
const digest=p=>{const b=fs.readFileSync(path.join(ROOT,p));return {sha256:createHash('sha256').update(b).digest('hex'),byteLength:b.length};};
const pins=()=>Object.fromEntries(NAMES.map(n=>[n,digest(n)]));
const contract=()=>{const e=JSON.parse(fs.readFileSync(path.join(ROOT,'expected.json'),'utf8'));return {sourceManifest:e.sourceManifest,stageManifest:e.stageManifest,caseManifest:e.caseManifest,toolchain:e.toolchain,negativeLocations:e.negativeLocations};};
const ownerPins=()=>{const i=JSON.parse(fs.readFileSync(path.join(ROOT,'intent.json'),'utf8'));return {node:i.node,writer:i.writer,command:i.command,cwd:i.cwd,version:i.version};};
const digestAt=(root,name)=>{const b=fs.readFileSync(path.join(root,name));return {sha256:createHash('sha256').update(b).digest('hex'),byteLength:b.length};};
const tempBundle=(t,mutate)=>{
  const root=fs.mkdtempSync(path.join(fs.realpathSync(tmpdir()),'c09-owner-capture-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  for(const name of NAMES)fs.copyFileSync(path.join(ROOT,name),path.join(root,name));
  editJSON(root,'capture.json',value=>{
    value.retainedReceipt.path=path.join(root,'receipt.json');
    value.retainedArchive.path=path.join(root,'archive.tgz');
    value.retainedExpected.path=path.join(root,'expected.json');
  });
  mutate(root);
  return {root,pins:Object.fromEntries(NAMES.map(name=>[name,digestAt(root,name)])),contract:contract(),ownerPins:ownerPins()};
};
const editJSON=(root,name,mutate)=>{
  const file=path.join(root,name),value=JSON.parse(fs.readFileSync(file,'utf8'));
  mutate(value);fs.writeFileSync(file,JSON.stringify(value,null,2)+'\n',{mode:0o600});
};
// Mutation fixtures deliberately rebind only dependent hashes so a semantic
// mismatch reaches its intended guard. This never edits the retained real run.
const rebindDescriptor=(root,name)=>editJSON(root,'capture.json',capture=>{
  const d=digestAt(root,name);
  if(name==='expected.json'){
    Object.assign(capture.retainedExpected,d);capture.expectedSha256=d.sha256;
  } else if(name==='receipt.json'){
    for(const field of ['retainedReceipt','receiptBefore','receiptAfter'])Object.assign(capture[field],d);
  }
});

test('semantic lifecycle flags refuse even when temporary-copy pins are refreshed',t=>{
  for(const [label,mutate,reason] of [
    ['accepted flag',v=>{v.accepted=true},'CAPTURE_LIFECYCLE'],
    ['unconfirmed close',v=>{v.closeConfirmed=false},'CAPTURE_LIFECYCLE'],
    ['network authority',v=>{v.network=true},'CAPTURE_INTENT']
  ]){
    const bundle=tempBundle(t,(root)=>editJSON(root,label==='network authority'?'intent.json':'capture.json',mutate));
    const result=inspectOwnerCapture(bundle);
    assert.equal(result.status,'REFUSED',label);assert.equal(result.reason,reason,label);
  }
});

test('an unmodified owned temporary copy preserves the positive contract',t=>{
  const result=inspectOwnerCapture(tempBundle(t,()=>{}));
  assert.equal(result.status,'CONSISTENT_NODE24_ONLY');
  assert.equal(result.node22,'NOT_RUN');
  assert.equal(result.matrixStatus,'INCOMPLETE');
});

test('temporary-copy source contracts cannot pass by refreshing caller pins',t=>{
  const cases=[
    ['intent source mismatch',(root)=>editJSON(root,'intent.json',v=>{v.sourceManifest['index.mjs']='f'.repeat(64)}),'CAPTURE_INTENT'],
    ['expected source mismatch',(root)=>{editJSON(root,'expected.json',v=>{v.sourceManifest['index.mjs']='f'.repeat(64)});rebindDescriptor(root,'expected.json');},'CAPTURE_EXPECTED'],
    ['receipt source mismatch',(root)=>{editJSON(root,'receipt.json',v=>{v.sourceManifest['index.mjs']='f'.repeat(64)});rebindDescriptor(root,'receipt.json');},'CAPTURE_INTENT']
  ];
  for(const [label,mutate,reason] of cases){
    const bundle=tempBundle(t,mutate);
    const result=inspectOwnerCapture(bundle);
    assert.equal(result.status,'REFUSED',label);assert.equal(result.reason,reason,label);
  }
});

test('temporary-copy archive bytes remain bound to receipt metadata',t=>{
  const bundle=tempBundle(t,root=>{
    const file=path.join(root,'archive.tgz'),bytes=fs.readFileSync(file);
    bytes[0]^=1;fs.writeFileSync(file,bytes,{mode:0o600});
  });
  const result=inspectOwnerCapture(bundle);
  // The stdout summary binds the archive before the receipt-level check does.
  assert.equal(result.status,'REFUSED');assert.equal(result.reason,'CAPTURE_SUMMARY');
});

test('required after/retained descriptors cannot be omitted in a refreshed copy',t=>{
  for(const field of ['nodeAfter','writerAfter','receiptBefore','receiptAfter','retainedReceipt','retainedArchive','retainedExpected','archiveBefore','archiveAfter','expectedSha256']){
    const bundle=tempBundle(t,root=>editJSON(root,'capture.json',value=>{delete value[field];}));
    const result=inspectOwnerCapture(bundle);
    assert.equal(result.status,'REFUSED',field);assert.equal(result.reason,'CAPTURE_SCHEMA',field);
  }
});

test('caller contract validation rejects accessors, toJSON, and revoked proxies without traps',()=>{
  const base={root:ROOT,pins:pins(),contract:contract(),ownerPins:ownerPins()};
  let traps=0;let getterContract={...base,contract:Object.defineProperty({...contract()},'toJSON',{enumerable:true,get(){traps++;throw new Error('trap');}})};
  assert.equal(inspectOwnerCapture(getterContract).status,'REFUSED');assert.equal(traps,0);
  const revoked=Proxy.revocable(contract(),{});revoked.revoke();
  assert.equal(inspectOwnerCapture({...base,contract:revoked.proxy}).status,'REFUSED');
  const nested=Proxy.revocable(ownerPins().node,{});nested.revoke();
  assert.equal(inspectOwnerCapture({...base,ownerPins:{...ownerPins(),node:nested.proxy}}).status,'REFUSED');
  let commandTraps=0;const commandProxy=new Proxy(ownerPins().command,{get(){commandTraps++;throw new Error('trap');}});
  assert.equal(inspectOwnerCapture({...base,ownerPins:{...ownerPins(),command:commandProxy}}).status,'REFUSED');assert.equal(commandTraps,0);
  let mapTraps=0;const mapProxy=new Proxy(contract().sourceManifest,{ownKeys(){mapTraps++;throw new Error('trap');}});
  assert.equal(inspectOwnerCapture({...base,contract:{...contract(),sourceManifest:mapProxy}}).status,'REFUSED');assert.equal(mapTraps,0);
});

test('retained owner bundle is checked as Node24-only and never accepted',()=>{
  const result=inspectOwnerCapture({root:ROOT,pins:pins(),contract:contract(),ownerPins:ownerPins()});
  assert.equal(result.schema,'nisi.c09.owner-capture-consistency-v1');
  assert.equal(result.status,'CONSISTENT_NODE24_ONLY');
  assert.equal(result.node22,'NOT_RUN');
  assert.equal(result.matrixStatus,'INCOMPLETE');
  assert.equal(result.authorizing,false);
  assert.equal(result.executionAttested,false);
  assert.equal(result.sourceAuthenticityAttested,false);
  assert.equal(result.scope,'TRUSTED_OWNER_CAPTURE_CONSISTENCY');
});

test('any external seven-file pin mismatch refuses without reading an alternate path',()=>{
  const altered=pins();altered['receipt.json']={...altered['receipt.json'],sha256:'0'.repeat(64)};
  const result=inspectOwnerCapture({root:ROOT,pins:altered,contract:contract(),ownerPins:ownerPins()});
  assert.equal(result.status,'REFUSED');assert.equal(result.reason,'CAPTURE_PIN_MISMATCH');
});

test('fixed-root and closed-pin boundaries refuse safely',()=>{
  assert.equal(inspectOwnerCapture({root:path.join(ROOT,'capture.json'),pins:pins(),contract:contract(),ownerPins:ownerPins()}).status,'REFUSED');
  assert.equal(inspectOwnerCapture({root:ROOT,pins:{...pins(),extra:{sha256:'0'.repeat(64),byteLength:0}},contract:contract(),ownerPins:ownerPins()}).status,'REFUSED');
});

test('checker remains a bounded reader with no execution/network/model surface',()=>{
  const source=fs.readFileSync(new URL('./c09-owner-capture-check.mjs',import.meta.url),'utf8');
  for(const banned of ['node:child_process','spawn(','exec(','fetch(','node:http','node:net'])assert.equal(source.includes(banned),false,banned);
});

test('coherent malformed original identities refuse even when both observations agree',t=>{
  assert.equal(inspectOwnerCapture(tempBundle(t,()=>{})).status,'CONSISTENT_NODE24_ONLY');
  for(const [key,value] of [['device',-1],['inode','12'],['inode',1.5],['mode',0],
    ['mode',0o040700],['mode',0x100000000+0o100600],['byteLength',-1],['path','relative']]){
    const bundle=tempBundle(t,root=>editJSON(root,'capture.json',c=>{
      c.receiptBefore[key]=value;c.receiptAfter[key]=value;
    }));
    const result=inspectOwnerCapture(bundle);
    assert.equal(result.status,'REFUSED',key);assert.equal(result.reason,'CAPTURE_IDENTITY',key);
  }
});

test('mutually consistent substituted capture maps do not replace current checkout evidence',t=>{
  const current=collectOwnerContext();
  const good=tempBundle(t,()=>{});
  assert.equal(inspectOwnerCapture({...good,...current}).status,'REFUSED'); // closed API rejects inputs map
  assert.equal(inspectOwnerCapture({...good,contract:current.contract,ownerPins:current.ownerPins}).status,'CONSISTENT_NODE24_ONLY');
  const substituted=tempBundle(t,root=>{
    for(const name of ['intent.json','expected.json','receipt.json'])
      editJSON(root,name,v=>{v.sourceManifest['index.mjs']='f'.repeat(64);});
    rebindDescriptor(root,'expected.json');rebindDescriptor(root,'receipt.json');
  });
  const result=inspectOwnerCapture({...substituted,contract:current.contract,ownerPins:current.ownerPins});
  assert.equal(result.status,'REFUSED');assert.equal(result.reason,'CAPTURE_CONTRACT');
});
