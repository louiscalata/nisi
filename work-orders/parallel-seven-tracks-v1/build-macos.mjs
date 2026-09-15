// Private unsigned compilation only. Never launches an app, test or model.
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {verifyImportedTree} from '../../scripts/verify-veritas-import.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const imported=path.join(root,'integrations/veritas');
const manifestPath=path.join(imported,'import-manifest.json');
const hash=b=>createHash('sha256').update(b).digest('hex');
const manifestBytes=fs.readFileSync(manifestPath),manifest=JSON.parse(manifestBytes);
const before=verifyImportedTree(imported,manifest);
const configuration=process.argv[2]==='release'?'release':'debug';
const evidence=fs.mkdtempSync(path.join(root,`.build/nisi-full-native-build-${configuration}-`));
const packagePath=path.join(imported,'native/macos/CodenameVeritasFramework');
const scratch=path.join(evidence,'swift-build');
const args=['swift','build','--package-path',packagePath,'--product','Codename Veritas Framework',
  '--configuration',configuration,'--scratch-path',scratch];
const env={...process.env,DEVELOPER_DIR:'/Applications/Xcode-27.0.app/Contents/Developer',
  CODE_SIGNING_ALLOWED:'NO',CODE_SIGNING_REQUIRED:'NO'};
const record={schemaVersion:'nisi-full-native-build/v1',status:'INCOMPLETE',startedAt:new Date().toISOString(),
  command:{file:'/usr/bin/xcrun',args},configuration,packagePath,scratch,
  manifestSha256:hash(manifestBytes),sourceBefore:before,sourceAfter:null,
  toolchain:null,result:null,binPath:null,artifact:null,appLaunched:false,modelCalled:false,
  installed:false,releaseAuthorized:false,authorizing:false};
try{
  const tool=spawnSync('/usr/bin/xcrun',['swift','--version'],{cwd:root,env,encoding:'utf8',timeout:10000});
  if(tool.error||tool.signal||tool.status!==0)throw Error('TOOLCHAIN_UNAVAILABLE');
  record.toolchain=tool.stdout.trim();
  const result=spawnSync('/usr/bin/xcrun',args,{cwd:root,env,encoding:'utf8',timeout:180000,maxBuffer:8388608});
  fs.writeFileSync(path.join(evidence,'stdout.txt'),result.stdout??'',{flag:'wx'});
  fs.writeFileSync(path.join(evidence,'stderr.txt'),result.stderr??'',{flag:'wx'});
  record.result={exitCode:result.status,signal:result.signal,error:result.error?.code??null};
  record.sourceAfter=verifyImportedTree(imported,manifest);
  if(!fs.readFileSync(manifestPath).equals(manifestBytes))throw Error('MANIFEST_DRIFT');
  if(result.error||result.signal||result.status!==0)throw Error('BUILD_NOT_SUCCESSFUL');
  // Ask SwiftPM where it put the product instead of assuming a layout: Xcode 27's
  // build system emits to <scratch>/out/Products/<Config>, not arm64-apple-macosx/<config>.
  // The first run (receipt .build/nisi-full-native-build-bD8zYH, retained) compiled
  // clean and then FAILed on exactly that assumption.
  const shown=spawnSync('/usr/bin/xcrun',[...args,'--show-bin-path'],{cwd:root,env,encoding:'utf8',timeout:60000});
  if(shown.error||shown.signal||shown.status!==0)throw Error('BIN_PATH_UNAVAILABLE');
  const binPath=shown.stdout.trim().split('\n').pop();
  record.binPath=binPath;
  const artifact=path.join(binPath,'Codename Veritas Framework');
  const stat=fs.lstatSync(artifact);if(!stat.isFile()||stat.isSymbolicLink())throw Error('ARTIFACT_NOT_REGULAR');
  record.artifact={path:artifact,sha256:hash(fs.readFileSync(artifact)),bytes:stat.size};
  record.status='COMPILED_APP_TARGET_ONLY';
}catch(error){record.status='FAIL';record.failure=error.message;process.exitCode=1;}
record.completedAt=new Date().toISOString();
fs.writeFileSync(path.join(evidence,'verification.json'),JSON.stringify(record,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({evidence,...record}));
