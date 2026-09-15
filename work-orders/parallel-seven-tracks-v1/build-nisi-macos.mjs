// Private unsigned compilation + bundle assembly of the Nisi overlay package.
// Never launches an app, test or model; never signs with an identity, never
// notarizes or installs. Every subprocess is one of three absolute system tools.
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {verifyImportedTree} from '../../scripts/verify-veritas-import.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const imported=path.join(root,'integrations/veritas');
const frozenPackage=path.join(imported,'native/macos/CodenameVeritasFramework');
const manifestPath=path.join(imported,'import-manifest.json');
const overlay=path.join(root,'native/macos/Nisi');
const hash=b=>createHash('sha256').update(b).digest('hex');
const configuration=process.argv[2]==='release'?'release':'debug';
const evidence=fs.mkdtempSync(path.join(root,`.build/nisi-app-bundle-${configuration}-`));
const scratch=path.join(evidence,'swift-build');
const args=['swift','build','--package-path',overlay,'--product','Nisi','--configuration',configuration,'--scratch-path',scratch];
// CODE_SIGNING_* are passed for the record but MEASURED INEFFECTIVE for `swift build`:
// the debug product is still ad-hoc codesigned with default debug entitlements by
// Xcode's build system (see codesign fields in the receipt). They disable nothing.
const buildEnv={DEVELOPER_DIR:'/Applications/Xcode-27.0.app/Contents/Developer',CODE_SIGNING_ALLOWED:'NO',CODE_SIGNING_REQUIRED:'NO'};
const env={...process.env,...buildEnv};
const TOOLS={xcrun:'/usr/bin/xcrun',plutil:'/usr/bin/plutil',codesign:'/usr/bin/codesign'};
// The import verifier skips these names without traversal, so a source dropped under
// them would compile while the verifier stays green. Pin the ONLY exclusion allowed.
const KNOWN_EXCLUDED=['native/macos/CodenameVeritasFramework/.build'];
const KNOWN_HIDDEN=['native/macos/CodenameVeritasFramework/.build/.buildSystem_debug','native/macos/CodenameVeritasFramework/.build/CACHEDIR.TAG'];
const SOURCE_KINDS=new Set(['.swift','.c','.h']);
const run=(tool,toolArgs,options={})=>spawnSync(TOOLS[tool],toolArgs,{cwd:root,env,encoding:'utf8',timeout:10000,...options});
const record={schemaVersion:'nisi-app-bundle-build/v3',status:'INCOMPLETE',startedAt:new Date().toISOString(),
  command:{file:TOOLS.xcrun,args,cwd:root,env:buildEnv},configuration,overlay,frozenPackage,scratch,
  manifestSha256:null,sourceBefore:null,sourceAfter:null,hiddenBefore:null,hiddenAfter:null,
  overlayInventory:null,buildInputs:null,docs:null,compiledSources:null,toolchain:null,result:null,binPath:null,executable:null,bundle:null,
  residualBrandStrings:null,embeddedRootPathStrings:null,
  signedWithIdentity:false,notarized:false,appLaunched:false,modelCalled:false,
  installed:false,releaseAuthorized:false,authorizing:false};
function overlayInventory(frozenReal){
  // Every symlink in the overlay must resolve inside the frozen package; every
  // regular file is Nisi-owned and hashed; every .swift in the frozen app target
  // must be covered (symlinked, or one of the two branded originals).
  const entries=[];
  const walk=dir=>{for(const name of fs.readdirSync(dir).sort()){const p=path.join(dir,name);const st=fs.lstatSync(p);
    if(st.isSymbolicLink()){const target=fs.realpathSync.native(p);const rel=path.relative(frozenReal,target);
      if(rel===''||rel.startsWith('..')||path.isAbsolute(rel))throw Error('OVERLAY_SYMLINK_ESCAPES_FROZEN_PACKAGE:'+p);
      entries.push({path:path.relative(overlay,p),kind:'symlink',frozen:rel});}
    else if(st.isDirectory())walk(p);
    else if(st.isFile())entries.push({path:path.relative(overlay,p),kind:'file',sha256:hash(fs.readFileSync(p)),bytes:st.size});
    else throw Error('OVERLAY_UNEXPECTED_ENTRY:'+p);}};
  walk(overlay);
  const covered=new Set(entries.filter(e=>e.kind==='symlink').map(e=>path.basename(e.frozen)));
  const branded={'CodenameVeritasApp.swift':'Sources/NisiApp/NisiApp.swift','MenuBarView.swift':'Sources/NisiApp/MenuBarView.swift','ShellTruthV1.swift':'Sources/NisiApp/ShellTruthV1.swift','PrivateVerifiedFileWriter.swift':'Sources/NisiApp/PrivateVerifiedFileWriter.swift'};
  for(const name of fs.readdirSync(path.join(frozenPackage,'Sources/CodenameVeritasApp')).sort()){
    if(!name.endsWith('.swift'))throw Error('FROZEN_APP_TARGET_NON_SWIFT_ENTRY:'+name);
    if(!covered.has(name)&&!(name in branded&&entries.some(e=>e.path===branded[name])))throw Error('FROZEN_APP_TARGET_NOT_COVERED:'+name);}
  return entries;
}
function compiledSources(manifestByPath){
  // Walk THROUGH the mirrored target symlinks the way SwiftPM does: every regular
  // file reachable under Sources/ must be a manifest entry with the same sha256,
  // no dot entries, no foreign file kinds. Branded copies must be exact transforms
  // (the product test pins the replacement lines); here they only need to be
  // the overlay's own regular files.
  const out=[];const base=path.join(overlay,'Sources');
  const walk=(dir,rel)=>{for(const name of fs.readdirSync(dir).sort()){const p=path.join(dir,name);const st=fs.statSync(p);const r=rel?rel+'/'+name:name;
    if(name.startsWith('.'))throw Error('COMPILED_TREE_DOT_ENTRY:'+r);
    if(st.isDirectory()){walk(p,r);continue;}
    if(!st.isFile())throw Error('COMPILED_TREE_NOT_REGULAR:'+r);
    if(!SOURCE_KINDS.has(path.extname(name)))throw Error('COMPILED_TREE_FOREIGN_FILE:'+r);
    const owned=!fs.lstatSync(p).isSymbolicLink()&&r.startsWith('NisiApp/');
    if(owned){out.push({path:'Sources/'+r,kind:'owned'});continue;}
    const target=fs.realpathSync.native(p);const frozenRel=path.relative(imported,target);
    const entry=manifestByPath.get(frozenRel);
    if(!entry)throw Error('COMPILED_SOURCE_NOT_IN_MANIFEST:'+r+'->'+frozenRel);
    if(hash(fs.readFileSync(p))!==entry.sha256)throw Error('COMPILED_SOURCE_HASH_MISMATCH:'+r);
    out.push({path:'Sources/'+r,kind:'frozen',manifest:frozenRel});}};
  walk(base,'');return out;
}
function hiddenSnapshot(manifestPaths){
  // Everything under the frozen package the manifest does not cover (SwiftPM's
  // .build etc.). Any change here during the build is a write into the import.
  const out=[];const base=path.join(imported);
  const walk=dir=>{for(const name of fs.readdirSync(dir).sort()){const p=path.join(dir,name);const st=fs.lstatSync(p);const rel=path.relative(base,p);
    if(st.isDirectory())walk(p);else if(manifestPaths.has(rel))continue;
    else out.push({path:rel,kind:st.isSymbolicLink()?'symlink':'file',bytes:st.size,sha256:st.isFile()?hash(fs.readFileSync(p)):null});}};
  walk(frozenPackage);return out;
}
function plistKeys(xml){return [...xml.matchAll(/<key>([^<]+)<\/key>/g)].map(m=>m[1]);}
try{
  const manifestBytes=fs.readFileSync(manifestPath),manifest=JSON.parse(manifestBytes);
  record.manifestSha256=hash(manifestBytes);
  const manifestPaths=new Set(manifest.files.map(f=>f.path));
  const manifestByPath=new Map(manifest.files.map(f=>[f.path,f]));
  const frozenReal=fs.realpathSync.native(frozenPackage);
  record.sourceBefore=verifyImportedTree(imported,manifest);
  if(record.sourceBefore.status!=='PASS_SOURCE_FREEZE_ONLY')throw Error('FROZEN_IMPORT_NOT_VERIFIED_BEFORE');
  if(JSON.stringify(record.sourceBefore.excluded)!==JSON.stringify(KNOWN_EXCLUDED))throw Error('IMPORT_UNEXPECTED_EXCLUSION');
  record.hiddenBefore=hiddenSnapshot(manifestPaths);
  if(JSON.stringify(record.hiddenBefore.map(h=>h.path))!==JSON.stringify(KNOWN_HIDDEN))throw Error('FROZEN_HIDDEN_ENTRY_UNEXPECTED');
  record.overlayInventory=overlayInventory(frozenReal);
  // Build identity = manifest, Info.plist and everything under Sources/; docs are
  // recorded separately so a README edit does not change what the build was.
  record.buildInputs=record.overlayInventory.filter(e=>e.path==='Package.swift'||e.path==='Info.plist'||e.path.startsWith('Sources/'));
  record.docs=record.overlayInventory.filter(e=>!record.buildInputs.includes(e));
  record.compiledSources=compiledSources(manifestByPath);
  const tool=run('xcrun',['swift','--version']);
  if(tool.error||tool.signal||tool.status!==0)throw Error('TOOLCHAIN_UNAVAILABLE');
  record.toolchain=tool.stdout.trim();
  const result=run('xcrun',args,{timeout:300000,maxBuffer:16777216});
  fs.writeFileSync(path.join(evidence,'stdout.txt'),result.stdout??'',{flag:'wx'});
  fs.writeFileSync(path.join(evidence,'stderr.txt'),result.stderr??'',{flag:'wx'});
  record.result={exitCode:result.status,signal:result.signal,error:result.error?.code??null};
  record.sourceAfter=verifyImportedTree(imported,manifest);
  if(record.sourceAfter.status!=='PASS_SOURCE_FREEZE_ONLY')throw Error('FROZEN_IMPORT_NOT_VERIFIED_AFTER');
  if(JSON.stringify(record.sourceAfter.excluded)!==JSON.stringify(KNOWN_EXCLUDED))throw Error('IMPORT_UNEXPECTED_EXCLUSION');
  if(!fs.readFileSync(manifestPath).equals(manifestBytes))throw Error('MANIFEST_DRIFT');
  record.hiddenAfter=hiddenSnapshot(manifestPaths);
  if(JSON.stringify(record.hiddenAfter)!==JSON.stringify(record.hiddenBefore))throw Error('FROZEN_HIDDEN_ENTRY_DRIFT');
  if(JSON.stringify(overlayInventory(frozenReal))!==JSON.stringify(record.overlayInventory))throw Error('OVERLAY_DRIFT_DURING_BUILD');
  if(JSON.stringify(compiledSources(manifestByPath))!==JSON.stringify(record.compiledSources))throw Error('COMPILED_TREE_DRIFT_DURING_BUILD');
  if(result.error||result.signal||result.status!==0)throw Error('BUILD_NOT_SUCCESSFUL');
  const shown=run('xcrun',[...args,'--show-bin-path'],{timeout:60000});
  if(shown.error||shown.signal||shown.status!==0)throw Error('BIN_PATH_UNAVAILABLE');
  const binPath=shown.stdout.trim().split('\n').pop();
  if(!binPath.startsWith(scratch+path.sep))throw Error('BIN_PATH_OUTSIDE_SCRATCH');
  record.binPath=binPath;
  const executable=path.join(binPath,'Nisi');
  const stat=fs.lstatSync(executable);if(!stat.isFile()||stat.isSymbolicLink())throw Error('EXECUTABLE_NOT_REGULAR');
  const bytes=fs.readFileSync(executable);
  record.executable={path:executable,sha256:hash(bytes),bytes:stat.size};
  // Honest branding inventory over the raw bytes (string table included):
  // exact old-name literals, bare "Veritas" words, and how often the build root
  // path is embedded (debug-info / N_OSO stabs), so nothing is shared blind.
  const text=bytes.toString('latin1');
  const count=re=>(text.match(re)??[]).length;
  record.residualBrandStrings={codenameVeritasFramework:count(/Codename Veritas Framework/g),veritasWord:count(/\bVeritas\b/g),nisiWord:count(/\bNisi\b/g)};
  record.embeddedRootPathStrings=count(new RegExp(root.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),'g'));
  // Assemble the bundle next to the receipt. Layout only; this script never
  // invokes codesign to sign. What the build system already did is measured.
  const app=path.join(evidence,'Nisi.app');const contents=path.join(app,'Contents');
  fs.mkdirSync(path.join(contents,'MacOS'),{recursive:true});fs.mkdirSync(path.join(contents,'Resources'));
  fs.copyFileSync(executable,path.join(contents,'MacOS/Nisi'),fs.constants.COPYFILE_EXCL);
  fs.chmodSync(path.join(contents,'MacOS/Nisi'),0o755);
  fs.copyFileSync(path.join(overlay,'Info.plist'),path.join(contents,'Info.plist'),fs.constants.COPYFILE_EXCL);
  fs.writeFileSync(path.join(contents,'PkgInfo'),'APPL????',{flag:'wx'});
  const lint=run('plutil',['-lint',path.join(contents,'Info.plist')]);
  if(lint.status!==0)throw Error('INFO_PLIST_INVALID');
  const files={};for(const rel of ['Contents/Info.plist','Contents/PkgInfo','Contents/MacOS/Nisi']){const b=fs.readFileSync(path.join(app,rel));files[rel]={sha256:hash(b),bytes:b.length};}
  const sign=run('codesign',['-dvv',app]);
  const lines=(sign.stderr??'').split('\n');
  const field=k=>(lines.find(l=>l.startsWith(k+'='))??'').slice(k.length+1)||null;
  const directory=lines.find(l=>l.startsWith('CodeDirectory '))??null;
  const flags=directory?.match(/flags=0x[0-9a-f]+\(([^)]*)\)/)?.[1]??null;
  const ent=run('codesign',['-d','--entitlements',':-',app]);
  const entitlementKeys=plistKeys(ent.stdout??'');
  record.bundle={path:app,files,codesign:{exitCode:sign.status,signature:field('Signature'),flags,linkerSigned:flags?.split(',').includes('linker-signed')??false,
    identifier:field('Identifier'),teamIdentifier:field('TeamIdentifier'),authority:field('Authority'),entitlementKeys}};
  const c=record.bundle.codesign;
  if(c.exitCode!==0||c.signature!=='adhoc'||c.authority!==null||c.teamIdentifier!=='not set')throw Error('UNEXPECTED_SIGNATURE_STATE');
  record.status='ASSEMBLED_UNSIGNED_BUNDLE';
}catch(error){record.status='FAIL';record.failure=error.message;process.exitCode=1;}
record.completedAt=new Date().toISOString();
fs.writeFileSync(path.join(evidence,'verification.json'),JSON.stringify(record,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({evidence,status:record.status,failure:record.failure??null,executable:record.executable,codesign:record.bundle?.codesign??null,residualBrandStrings:record.residualBrandStrings,embeddedRootPathStrings:record.embeddedRootPathStrings}));
