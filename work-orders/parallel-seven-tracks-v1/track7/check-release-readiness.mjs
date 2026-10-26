import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
const AUTHORITY = ['legal','disclosure','release','signing','notarization','publication'];
const PLATFORMS = ['portable','native','windows','install'];
const PASS = new Set(['PASS','PASS_SCOPED','READY','VERIFIED']);
const ADVERSE = new Set(['FAIL','NOT_RUN','INCONCLUSIVE','ERROR','REQUIRES_AUTHORITY']);
const sha = b => createHash('sha256').update(b).digest('hex');
const plain = x => x !== null && typeof x === 'object' && !Array.isArray(x);
const safe = x => typeof x === 'string' && x.length > 0 && !path.isAbsolute(x) && x.split(/[\\/]/).every(p => p && p !== '.' && p !== '..');
function file(root, spec) {
  if (!plain(spec) || !safe(spec.path) || !/^[a-f0-9]{64}$/.test(spec.sha256)) return {status:'ERROR',reason:'INVALID_FILE_BINDING'};
  try { const real=fs.realpathSync(root), target=path.resolve(real,spec.path); if(!target.startsWith(real+path.sep)) throw Error('PATH_ESCAPE'); let cursor=real; for(const part of spec.path.split(/[\\/]/)){cursor=path.join(cursor,part);if(fs.lstatSync(cursor).isSymbolicLink())throw Error('SYMLINK_NOT_ALLOWED');} const realTarget=fs.realpathSync(target); if(!realTarget.startsWith(real+path.sep)) throw Error('PATH_ESCAPE'); const st=fs.lstatSync(realTarget); if(!st.isFile()||st.isSymbolicLink()) throw Error('NOT_REGULAR_FILE'); const bytes=fs.readFileSync(realTarget); const digest=sha(bytes); return {status:digest===spec.sha256?'PASS':'INCONCLUSIVE',reason:digest===spec.sha256?null:'DIGEST_MISMATCH',bytes}; } catch(e) { return {status:e.code==='ENOENT'?'NOT_RUN':'ERROR',reason:e.message}; }
}
function approval() { return 'REQUIRES_AUTHORITY'; }
function mapReceiptStatus(status) {
  if (PASS.has(status)) return 'PASS';
  if (ADVERSE.has(status)) return status;
  return 'ERROR';
}
export function checkReleaseReadiness(input,{root=process.cwd()}={}) {
  if(!plain(input)||input.schemaVersion!=='nisi-release-readiness-input/v1'||!Array.isArray(input.platforms)||!plain(input.approvals)||!plain(input.artifact)||!plain(input.productReport)) return {schemaVersion:1,status:'ERROR',reason:'INVALID_INPUT',authorizing:false,publishingAllowed:false};
  const approvalKeys=Object.keys(input.approvals);
  if(approvalKeys.length!==AUTHORITY.length||!AUTHORITY.every(k=>approvalKeys.includes(k)&&plain(input.approvals[k]))) return {schemaVersion:1,status:'ERROR',reason:'INVALID_APPROVALS',authorizing:false,publishingAllowed:false};
  if(input.platforms.length!==4||new Set(input.platforms.map(x=>x?.id)).size!==4||!PLATFORMS.every(id=>input.platforms.some(x=>x?.id===id))) return {schemaVersion:1,status:'ERROR',reason:'INCOMPLETE_PLATFORM_MATRIX',authorizing:false,publishingAllowed:false};
  let rootReal; try {rootReal=fs.realpathSync(root);if(!fs.statSync(rootReal).isDirectory())throw Error('ROOT_NOT_DIRECTORY');} catch {return {schemaVersion:1,status:'ERROR',reason:'INVALID_ROOT',authorizing:false,publishingAllowed:false};}
  const artifact=file(rootReal,input.artifact), report=file(rootReal,input.productReport); let product=null;
  if(report.status==='PASS') {try {product=JSON.parse(report.bytes.toString('utf8'));}catch{report.status='ERROR';report.reason='MALFORMED_PRODUCT_REPORT';}}
  const productPass=plain(product)&&product.status==='PASS_SCOPED'&&product.ready===true&&product.authorizing===false;
  const platforms=Object.fromEntries(input.platforms.map(x=>{
    if(!plain(x?.receipt)) return [x.id,{status:'ERROR',reason:'UNBOUND_PLATFORM'}];
    const bound=file(rootReal,x.receipt);
    if(bound.status!=='PASS') return [x.id,{status:bound.status,reason:bound.reason,receiptId:x.receipt.path}];
    let receiptObj; try{receiptObj=JSON.parse(bound.bytes.toString('utf8'));}catch{return [x.id,{status:'ERROR',reason:'MALFORMED_RECEIPT',receiptId:x.receipt.path}];}
    const status=mapReceiptStatus(receiptObj.status);
    const reason=status==='ERROR'&&!ADVERSE.has(receiptObj.status)?(receiptObj.status===undefined?'MISSING_RECEIPT_STATUS':'UNKNOWN_RECEIPT_STATUS'):null;
    return [x.id,{status,reason,receiptId:x.receipt.path}];
  }));
  const platformPass=PLATFORMS.every(id=>platforms[id].status==='PASS');
  const approvals=Object.fromEntries(AUTHORITY.map(id=>[id,{status:approval(input.approvals[id])}]));
  const allPass=artifact.status==='PASS'&&report.status==='PASS'&&productPass&&platformPass;
  return Object.freeze({schemaVersion:1,status:allPass?'PASS_SCOPED':'INCONCLUSIVE',ready:allPass,authorizing:false,publishingAllowed:false,artifact:{status:artifact.status,reason:artifact.reason},productReport:{status:report.status,reason:report.reason},platforms,approvals});
}
