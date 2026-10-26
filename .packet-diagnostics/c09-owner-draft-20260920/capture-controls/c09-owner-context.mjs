// Independently derive the C09 owner contract from a trusted static checkout.
// Read-only. No capture/receipt/expected-file input, subprocesses or providers.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {types} from 'node:util';
import assertStrict from 'node:assert/strict';

// Owner-reviewed independent policy. Do not import executable checkout files:
// a changed package contract must be refused without evaluating its top level.
const RUNTIME_FILES=Object.freeze([
  'adapters/apple-foundation-models.mjs','adapters/local-chat.mjs',
  'adapters/native-chat-v1.mjs','adapters/native-chat-protocol-v1.mjs',
  'adapters/repair-guidance-v1.mjs','canonical/canonical-json-v1.mjs',
  'gate/afm-content-executor.mjs','gate/content-consent.mjs',
  'hosts/repository/snapshot-contract.mjs','hosts/swift-verifier/owned-child.mjs',
  'hosts/swift-verifier/protocol.mjs','index.mjs','policy/file-access.mjs',
  'serialization/canonical-json-v1.mjs','workflow/contracts.mjs','workflow/engine.mjs',
]);
const TYPE_FILES=Object.freeze([
  'types/afm-content-executor.d.ts','types/apple-foundation-models.d.ts','types/canonical.d.ts',
  'types/content-consent.d.ts','types/contracts.d.ts','types/index.d.ts','types/local-chat.d.ts',
  'types/native-chat.d.ts','types/repair-guidance.d.ts','types/policy.d.ts',
  'types/serialization.d.ts','types/workflow.d.ts',
]);
const ENTRIES=[
  ['.','index.mjs','index'],['workflow','workflow/engine.mjs','workflow'],
  ['policy','policy/file-access.mjs','policy'],['serialization','serialization/canonical-json-v1.mjs','serialization'],
  ['adapters/apple-foundation-models','adapters/apple-foundation-models.mjs','apple-foundation-models'],
  ['adapters/local-chat','adapters/local-chat.mjs','local-chat'],
  ['adapters/native-chat','adapters/native-chat-v1.mjs','native-chat'],
  ['adapters/repair-guidance','adapters/repair-guidance-v1.mjs','repair-guidance'],
  ['index.mjs','index.mjs','index'],['workflow/engine.mjs','workflow/engine.mjs','workflow'],
  ['workflow/contracts.mjs','workflow/contracts.mjs','contracts'],
  ['policy/file-access.mjs','policy/file-access.mjs','policy'],
  ['serialization/canonical-json-v1.mjs','serialization/canonical-json-v1.mjs','serialization'],
  ['adapters/apple-foundation-models.mjs','adapters/apple-foundation-models.mjs','apple-foundation-models'],
  ['adapters/local-chat.mjs','adapters/local-chat.mjs','local-chat'],
  ['adapters/native-chat-v1.mjs','adapters/native-chat-v1.mjs','native-chat'],
  ['adapters/repair-guidance-v1.mjs','adapters/repair-guidance-v1.mjs','repair-guidance'],
  ['canonical/canonical-json-v1.mjs','canonical/canonical-json-v1.mjs','canonical'],
  ['gate/content-consent.mjs','gate/content-consent.mjs','content-consent'],
  ['gate/afm-content-executor.mjs','gate/afm-content-executor.mjs','afm-content-executor'],
];
const EXPORTS=Object.freeze(Object.fromEntries(ENTRIES.map(([key,runtime,type])=>
  [key==='.'?key:'./'+key,Object.freeze({types:'./types/'+type+'.d.ts',default:'./'+runtime})])));
const PRIVATE_PACKAGE_FILES=Object.freeze(['package.json',...RUNTIME_FILES,...TYPE_FILES].sort());
function createPrivatePackageMetadata(source){
  try{
    for(const [key,value] of Object.entries({name:'nisi',version:'0.2.0-private.0',private:true,
      license:'UNLICENSED',type:'module',main:'./index.mjs',types:'./types/index.d.ts'}))assertStrict.equal(source[key],value);
    assertStrict.deepEqual(source.engines,{node:'>=22'});
    assertStrict.deepEqual(source.exports,{...EXPORTS,'./*':'./*'});
    assertStrict.deepEqual(source.files,[...RUNTIME_FILES,...TYPE_FILES]);
    for(const key of ['dependencies','optionalDependencies','bundledDependencies','bundleDependencies','peerDependencies'])
      assertStrict(!source[key]||Object.keys(source[key]).length===0);
  }catch{fail('CONTEXT_METADATA');}
  return {name:source.name,version:source.version,private:true,license:'UNLICENSED',
    description:source.description,author:source.author,type:'module',engines:{node:source.engines.node},
    main:source.main,types:source.types,exports:{...EXPORTS,'./*':'./*'},files:[...RUNTIME_FILES,...TYPE_FILES]};
}

const PROJECT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../..');
const WRITER='scripts/check-private-package.mjs';
const CONTRACT='scripts/private-package-contract.mjs';
const WRITER_SHA='bf342e5e1b1c75bc89d8481ea0e20ca1641a23a60ff426b3ec10974a75806c69';
const CONTRACT_SHA='1983f133f4580bbca58fdefbc4b60431c462b8507b48aff1e45f9b72fd3b112c';
const CASES=Object.freeze(['adoption-reviewed.mts','baseline.mts','declaration-regressions.mts',
  'declaration-regressions.test.mjs','edge-cases.mts','local-chat-reasoning-effort.mts',
  'native-chat-runtime.test.mjs','native-chat.mts','output-mode-types.mts',
  'repair-guidance-runtime.test.mjs','repair-guidance.mts','runtime.test.mjs']);
const fail=(code,detail)=>{throw Object.assign(new Error(code+(detail?': '+detail:'')),{code});};
const assert=(ok,code,detail)=>{if(!ok)fail(code,detail);};
const sha=b=>createHash('sha256').update(b).digest('hex');
function exactPath(value){
  assert(typeof value==='string'&&value.isWellFormed()&&!value.includes('\0')&&path.isAbsolute(value)
    &&path.resolve(value)===value,'CONTEXT_PATH');return value;
}
function physicalDirectory(directory){
  const s=fs.lstatSync(directory);
  assert(s.isDirectory()&&!s.isSymbolicLink()&&fs.realpathSync(directory)===directory,'CONTEXT_PATH',directory);
}
function ancestors(root,file){
  assert(file.startsWith(root+path.sep),'CONTEXT_PATH',file);
  physicalDirectory(root);
  const parts=path.relative(root,file).split(path.sep);let current=root;
  for(const name of parts.slice(0,-1)){current=path.join(current,name);physicalDirectory(current);}
}
function stableFile(file,{container=null,maxBytes=2*1024*1024,retain=true}={}){
  exactPath(file);if(container!==null)ancestors(container,file);
  const before=fs.lstatSync(file);
  assert(before.isFile()&&!before.isSymbolicLink(),'CONTEXT_FILE',file);
  assert(Number.isSafeInteger(before.size)&&before.size>=0&&before.size<=maxBytes,'CONTEXT_SIZE',file);
  assert(fs.realpathSync(file)===file,'CONTEXT_PATH',file);
  let fd;
  try{
    fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK);
    const opened=fs.fstatSync(fd),same=(a,b)=>['dev','ino','mode','size','mtimeMs','ctimeMs'].every(k=>a[k]===b[k]);
    assert(opened.isFile()&&same(before,opened),'CONTEXT_CHANGED',file);
    const digest=createHash('sha256'),chunks=[],buffer=Buffer.alloc(Math.min(65536,opened.size||1));let count=0;
    while(count<opened.size){
      const n=fs.readSync(fd,buffer,0,Math.min(buffer.length,opened.size-count),null);
      assert(n>0,'CONTEXT_EOF',file);digest.update(buffer.subarray(0,n));
      if(retain)chunks.push(Buffer.from(buffer.subarray(0,n)));count+=n;
    }
    assert(fs.readSync(fd,buffer,0,1,null)===0,'CONTEXT_GROWTH',file);
    assert(same(opened,fs.fstatSync(fd))&&same(opened,fs.lstatSync(file))&&fs.realpathSync(file)===file,'CONTEXT_CHANGED',file);
    const identity={path:file,resolved:file,sha256:digest.digest('hex'),byteLength:count,device:opened.dev,inode:opened.ino,mode:opened.mode};
    return {identity,bytes:retain?Buffer.concat(chunks,count):null};
  }finally{if(fd!==undefined)fs.closeSync(fd);}
}
function deepFreeze(value){if(value&&typeof value==='object'){for(const child of Object.values(value))deepFreeze(child);Object.freeze(value);}return value;}

export function collectOwnerContext(options={}){
  assert(options&&typeof options==='object'&&!types.isProxy(options)&&!Array.isArray(options),'CONTEXT_INPUT');
  const keys=Reflect.ownKeys(options),input=Object.create(null);
  assert(keys.every(k=>k==='projectRoot'||k==='nodePath'),'CONTEXT_INPUT');
  for(const key of keys){const d=Object.getOwnPropertyDescriptor(options,key);assert(d?.enumerable&&Object.hasOwn(d,'value'),'CONTEXT_INPUT');input[key]=d.value;}
  const root=exactPath(input.projectRoot??PROJECT),nodePath=exactPath(input.nodePath??process.execPath);
  physicalDirectory(root);
  assert(nodePath===process.execPath&&process.version==='v24.18.0','CONTEXT_RUNTIME');
  const inputs={};let total=0;
  const read=relative=>{
    const result=stableFile(path.join(root,relative),{container:root});
    total+=result.identity.byteLength;assert(total<=64*1024*1024,'CONTEXT_TOTAL_SIZE');
    assert(Buffer.from(result.bytes.toString('utf8'),'utf8').equals(result.bytes),'CONTEXT_UTF8',relative);
    inputs[relative]=result.identity.sha256;return result;
  };
  const writer=read(WRITER),contractModule=read(CONTRACT);
  assert(writer.identity.sha256===WRITER_SHA,'CONTEXT_WRITER');
  assert(contractModule.identity.sha256===CONTRACT_SHA,'CONTEXT_CONTRACT');
  const node=stableFile(nodePath,{maxBytes:512*1024*1024,retain:false});inputs[nodePath]=node.identity.sha256;
  const sources=Object.fromEntries(PRIVATE_PACKAGE_FILES.map(file=>[file,read(file)]));
  assert(PRIVATE_PACKAGE_FILES.length===29,'CONTEXT_SOURCE_INVENTORY');
  const sourceManifest=Object.fromEntries(Object.entries(sources).map(([file,row])=>[file,row.identity.sha256]));
  const metadata=JSON.parse(sources['package.json'].bytes.toString('utf8'));
  const stageManifest={...sourceManifest,'package.json':sha(JSON.stringify(createPrivatePackageMetadata(metadata),null,2)+'\n')};
  const caseRoot=path.join(root,'tests/private-consumer');ancestors(root,path.join(caseRoot,'placeholder'));physicalDirectory(caseRoot);
  const names=[],directory=fs.opendirSync(caseRoot,{bufferSize:1});
  try{let entry;while((entry=directory.readSync())!==null){
    assert(names.length<CASES.length,'CONTEXT_CASE_INVENTORY');
    assert(entry.isFile()&&!entry.isSymbolicLink(),'CONTEXT_CASE_INVENTORY');names.push(entry.name);
  }}finally{directory.closeSync();}
  names.sort();
  assert(JSON.stringify(names)===JSON.stringify(CASES),'CONTEXT_CASE_INVENTORY');
  const cases=Object.fromEntries(names.map(file=>[file,read('tests/private-consumer/'+file)]));
  const caseManifest=Object.fromEntries(Object.entries(cases).map(([file,row])=>[file,row.identity.sha256]));
  const negativeLocations=[];
  for(const file of names.filter(f=>f.endsWith('.mts')))
    cases[file].bytes.toString('utf8').split('\n').forEach((line,i)=>{if(line.includes('@ts-expect-error'))negativeLocations.push({file:'negative-'+file,line:i+2});});
  assert(negativeLocations.length===73,'CONTEXT_NEGATIVE_INVENTORY');
  const compiler='node_modules/typescript/bin/tsc',compilerEntry=read(compiler);
  const ts=JSON.parse(read('node_modules/typescript/package.json').bytes.toString('utf8'));
  const nodeTypes=JSON.parse(read('node_modules/@types/node/package.json').bytes.toString('utf8'));
  assert(typeof ts.version==='string'&&typeof nodeTypes.version==='string','CONTEXT_TOOLCHAIN');
  const lock=read('package-lock.json');
  const toolchain={compilerPath:path.join(root,compiler),compilerEntrySha256:compilerEntry.identity.sha256,
    typescript:ts.version,nodeTypes:nodeTypes.version,lockSha256:lock.identity.sha256,typeRoots:[path.join(root,'node_modules/@types')]};
  return deepFreeze({contract:{sourceManifest,stageManifest,caseManifest,toolchain,negativeLocations},
    ownerPins:{node:node.identity,writer:writer.identity,command:[nodePath,WRITER],cwd:root,version:process.version},inputs});
}
