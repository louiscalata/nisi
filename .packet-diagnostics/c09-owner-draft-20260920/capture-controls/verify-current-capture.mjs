// Owner-reviewed, fixed-root Node24 evidence check. No fixture/root/receipt CLI
// override and no rehearsal execution. This does not complete the Node22 matrix.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';

const HERE=path.dirname(fileURLToPath(import.meta.url));
const ROOT=path.resolve(HERE,'../../..');
const CAPTURE=path.resolve(HERE,'../runtime-node24-TyjDOb');
// Frozen outside the retained capture. Never regenerate these from its files
// merely to turn a refusal into success; a new capture needs a reviewed binding.
const CAPTURE_PINS=Object.freeze(Object.fromEntries([
  ['capture.json','38ce097e799806bea4ae87a9e9a9abae76cb191d16786a7444b5c07c59738888',4573],
  ['intent.json','37218d8094254050adfb59a8190d7bd6ecaa61ff5be283d9a9a8a4c2c70d65ed',14343],
  ['receipt.json','412e2fa843ca3cda318f419a582451c73b40169f6da6b712e1ef7a17f0fdb584',251535],
  ['archive.tgz','f79c9f133966b4258953021ea2d107bad991121704ce9d9c299090eba7879972',43624],
  ['expected.json','5d2e8c383606414677d6d0c900bed22300504612c51412842b709de02bf7d622',14001],
  ['stdout.log','adcf879341ab37a914911e32f030b56b17529dbc849dfcd9b0401543de0fd597',368],
  ['stderr.log','e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',0],
].map(([name,sha256,byteLength])=>[name,Object.freeze({sha256,byteLength})])));
const CODE_PINS=Object.freeze({
  'c09-owner-context.mjs':'855c90bbf74f6c76e7dc52b5ab1520f4d8379e54b3b0dd254cab28fe32db82ee',
  'c09-owner-capture-check.mjs':'d6fb2e01d4c86afb493d26224f64253dcfdf30512ac7db1af99890ff90f3ba85',
  '../candidate/work-orders/v02-finish-cluster-v1/consumer/runtime-matrix-v1.mjs':'18cf428f02e64a3df15e9fe6fde41410541bf8d40131f2d55c74b8b59d2c73e0',
  '../candidate/scripts/private-package-contract.mjs':'1983f133f4580bbca58fdefbc4b60431c462b8507b48aff1e45f9b72fd3b112c',
});
const sha=b=>createHash('sha256').update(b).digest('hex');
function readCode(relative){
  const file=path.resolve(HERE,relative),before=fs.lstatSync(file);
  assert(before.isFile()&&!before.isSymbolicLink()&&before.size<=2*1024*1024,'OWNER_CODE_FILE');
  assert.equal(fs.realpathSync(file),file,'OWNER_CODE_PATH');
  const fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK);
  const same=(a,b)=>['dev','ino','mode','size','mtimeMs','ctimeMs'].every(k=>a[k]===b[k]);
  try{
    const opened=fs.fstatSync(fd);assert(same(before,opened),'OWNER_CODE_CHANGED');
    const bytes=Buffer.alloc(opened.size);let offset=0;
    while(offset<bytes.length){const n=fs.readSync(fd,bytes,offset,bytes.length-offset,null);assert(n>0,'OWNER_CODE_EOF');offset+=n;}
    assert.equal(fs.readSync(fd,Buffer.alloc(1),0,1,null),0,'OWNER_CODE_GROWTH');
    assert(same(opened,fs.fstatSync(fd))&&same(opened,fs.lstatSync(file)),'OWNER_CODE_CHANGED');
    return sha(bytes);
  }finally{fs.closeSync(fd);}
}
function codeSnapshot(){
  const result={};for(const [name,expected] of Object.entries(CODE_PINS)){
    result[name]=readCode(name);assert.equal(result[name],expected,'OWNER_CODE_PIN: '+name);
  }
  result['verify-current-capture.mjs']=readCode('verify-current-capture.mjs');return result;
}

assert.equal(process.argv.length,2,'This fixed owner command accepts no arguments.');
assert.equal(ROOT,'/Users/louiscalata/nisi','OWNER_CANONICAL_ROOT');
assert.equal(fs.realpathSync(HERE),HERE,'OWNER_PHYSICAL_ROOT');
const out=fs.mkdtempSync(path.join(HERE,'current-'));
const receipt={schema:'nisi.c09.current-owner-verification.v1',startedAt:new Date().toISOString(),
  root:ROOT,captureRoot:CAPTURE,capturePins:CAPTURE_PINS,node:process.version,
  status:'REFUSED',node22:'NOT_RUN',matrixStatus:'INCOMPLETE',accepted:false,
  executionAttested:false,sourceAuthenticityAttested:false,publicationAuthorized:false,
  modelInference:'NOT_RUN',nativeAppExecution:'NOT_RUN'};
try{
  // Check all non-builtin imports before evaluating any of them. This is a
  // trusted static-checkout check, not isolation from hostile concurrent writes.
  receipt.codeBefore=codeSnapshot();
  const {collectOwnerContext}=await import(pathToFileURL(path.join(HERE,'c09-owner-context.mjs')));
  const {inspectOwnerCapture}=await import(pathToFileURL(path.join(HERE,'c09-owner-capture-check.mjs')));
  receipt.before=collectOwnerContext();
  receipt.result=inspectOwnerCapture({root:CAPTURE,pins:CAPTURE_PINS,
    contract:receipt.before.contract,ownerPins:receipt.before.ownerPins});
  receipt.after=collectOwnerContext();receipt.codeAfter=codeSnapshot();
  assert.deepEqual(receipt.before,receipt.after,'OWNER_CONTEXT_DRIFT');
  assert.deepEqual(receipt.codeBefore,receipt.codeAfter,'OWNER_CODE_DRIFT');
  assert.equal(receipt.result.status,'CONSISTENT_NODE24_ONLY','OWNER_CAPTURE_REFUSED: '+receipt.result.reason);
  receipt.status='CONSISTENT_CURRENT_NODE24_ONLY';receipt.unchanged=true;
}catch(error){receipt.reason=error.code??'OWNER_ERROR';receipt.detail=error.message;process.exitCode=1;}
receipt.completedAt=new Date().toISOString();
fs.writeFileSync(path.join(out,'receipt.json'),JSON.stringify(receipt,null,2)+'\n',{flag:'wx',mode:0o600});
console.log(JSON.stringify({out,status:receipt.status,reason:receipt.reason??null,
  detail:receipt.detail??null,node22:receipt.node22,matrixStatus:receipt.matrixStatus,accepted:false}));
