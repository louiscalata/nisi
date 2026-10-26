// Private declaration-consistency extension. No loader, scheduler or authority.
import Ajv2020 from 'ajv/dist/2020.js';
import { createHash } from 'node:crypto';
import { BN01_LIMITS, validateBn01Bytes } from './bn01.mjs';

export const DUAL_FACE_LIMITS = Object.freeze({bytes:131072,depth:12,values:6000,
  queuedMessages:256,queuedPayloadBytes:1048576});
const ceiling = Object.freeze({attachmentRuntimeObserved:false,modelExecuted:false,
  authorizing:false,certificationGranted:false,promotionGranted:false,neuralRoadmapCredit:0});
const result = (code, details = {}) => Object.freeze({ok:code==='PASS_BN01_DUAL_FACE_METADATA_BINDING_ONLY',code,...details,...ceiling});
const id = {type:'string',minLength:1,maxLength:96,pattern:'^[a-z][a-z0-9_.-]*(?![\\s\\S])'};
const digest = {type:'string',minLength:64,maxLength:64,pattern:'^[0-9a-f]{64}$'};
const integer = max => ({type:'integer',minimum:1,maximum:max});
const object = properties => ({type:'object',additionalProperties:false,required:Object.keys(properties),properties});
const list = (items,minItems,maxItems) => ({type:'array',items,minItems,maxItems});
const envelope = record => object({record,sha256:digest});
const topologySchema = object({kind:{const:'dual-face-topology-v1'},topologyId:id,revision:integer(1000000),scopeId:id,baseGraphSha256:digest,
  transportBudget:object({maxQueuedMessages:integer(DUAL_FACE_LIMITS.queuedMessages),
    maxQueuedPayloadBytes:integer(DUAL_FACE_LIMITS.queuedPayloadBytes)}),
  ports:list(object({portId:id,nodeId:id,face:{enum:['A','B']}}),4,128),
  links:list(object({linkId:id,aPortId:id,bPortId:id}),2,64),
  channels:list(object({channelId:id,linkId:id,fromPortId:id,toPortId:id,permission:{enum:['ALLOW','DENY']},
    queueLimit:integer(64),maxPayloadBytes:integer(65536),hopLimit:integer(16),ttlMs:integer(60000)}),4,128),
});
const schema = object({schemaVersion:{const:1},profile:{const:'veritas-bn01-dual-face-v1'},topology:envelope(topologySchema),
  plan:envelope(object({kind:{const:'dual-face-plan-v1'},runSha256:digest,topologySha256:digest,
    routes:list(object({fromNodeId:id,toNodeId:id,channelId:id}),0,32)})),
});
const checkSchema = new Ajv2020({strict:true,allErrors:false,ownProperties:true}).compile(schema);

// Profile-specific ASCII/integer canonical encoding; deliberately not JCS.
function canonical(v) {
  if(Array.isArray(v))return '['+v.map(canonical).join(',')+']';
  if(v!==null&&typeof v==='object')return '{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}';
  return JSON.stringify(v);
}
function hash(record) {
  return createHash('sha256').update(`veritas/bn01-dual-face/${record.kind}\0`).update(canonical(record)).digest('hex');
}
function boundedTree(root) {
  const stack=[[root,0]];let count=0;
  while(stack.length){
    const [item,depth]=stack.pop();
    if(++count>DUAL_FACE_LIMITS.values||depth>DUAL_FACE_LIMITS.depth)return false;
    if(item!==null&&typeof item==='object')for(const value of Object.values(item))stack.push([value,depth+1]);
  }
  return true;
}
const tensorEqual = (a,b) => a.dtype===b.dtype&&a.width===b.width&&a.spaceSha256===b.spaceSha256;

function semantics(base, dual) {
  const t=dual.topology.record,p=dual.plan.record,g=base.graph.record;
  if(t.scopeId!==g.scopeId)return 'SCOPE_MISMATCH';
  if(t.baseGraphSha256!==base.graph.sha256)return 'BASE_GRAPH_MISMATCH';
  if(p.runSha256!==base.run.sha256)return 'BASE_RUN_MISMATCH';
  if(g.nodes.length<2)return 'ATTACHMENT_NODE_MINIMUM';
  const nodes=new Map(g.nodes.map(n=>[n.nodeId,n]));
  const plugins=new Map(base.plugins.map(e=>[e.sha256,e.record]));
  const counts=new Map(g.nodes.map(n=>[n.nodeId,{A:0,B:0}]));
  const ports=new Map();
  for(const port of t.ports){
    if(ports.has(port.portId))return 'PORT_DUPLICATE';
    if(!nodes.has(port.nodeId))return 'PORT_NODE_UNKNOWN';
    ports.set(port.portId,port);counts.get(port.nodeId)[port.face]++;
  }
  for(const c of counts.values())if(c.A<1||c.B<1||c.A>4||c.B>4)return 'FACE_COVERAGE';
  const links=new Map(),usedPorts=new Set();
  const adjacency=new Map(g.nodes.map(n=>[n.nodeId,new Set()]));
  for(const link of t.links){
    if(links.has(link.linkId))return 'LINK_DUPLICATE';
    const a=ports.get(link.aPortId),b=ports.get(link.bPortId);
    if(!a||!b)return 'LINK_PORT_UNKNOWN';
    if(a.face!=='A'||b.face!=='B')return 'LINK_FACE_MISMATCH';
    if(a.nodeId===b.nodeId)return 'LINK_SELF_ATTACHMENT';
    if(usedPorts.has(a.portId)||usedPorts.has(b.portId))return 'PORT_REUSED';
    usedPorts.add(a.portId);usedPorts.add(b.portId);links.set(link.linkId,link);
    adjacency.get(a.nodeId).add(b.nodeId);adjacency.get(b.nodeId).add(a.nodeId);
  }
  if(usedPorts.size!==ports.size)return 'PORT_UNLINKED';
  const reached=new Set(),pending=[g.nodes[0].nodeId];
  while(pending.length){const node=pending.pop();if(reached.has(node))continue;reached.add(node);for(const n of adjacency.get(node))if(!reached.has(n))pending.push(n);}
  if(reached.size!==nodes.size)return 'ATTACHMENTS_DISCONNECTED';
  const channels=new Map(),directions=new Map([...links.keys()].map(key=>[key,new Set()]));
  for(const c of t.channels){
    if(channels.has(c.channelId))return 'CHANNEL_DUPLICATE';
    const link=links.get(c.linkId);if(!link)return 'CHANNEL_LINK_UNKNOWN';
    const forward=c.fromPortId===link.aPortId&&c.toPortId===link.bPortId;
    const reverse=c.fromPortId===link.bPortId&&c.toPortId===link.aPortId;
    if(!forward&&!reverse)return 'CHANNEL_ENDPOINT_MISMATCH';
    const direction=forward?'forward':'return';
    if(directions.get(c.linkId).has(direction))return 'CHANNEL_DIRECTION_DUPLICATE';
    directions.get(c.linkId).add(direction);channels.set(c.channelId,c);
    if(c.permission==='ALLOW'){
      const from=nodes.get(ports.get(c.fromPortId).nodeId),to=nodes.get(ports.get(c.toPortId).nodeId);
      if(!tensorEqual(plugins.get(from.revisionSha256).output,plugins.get(to.revisionSha256).input))return 'CHANNEL_TENSOR_MISMATCH';
    }
  }
  if([...directions.values()].some(d=>d.size!==2))return 'CHANNEL_PAIR_MISSING';
  // Conservative declared reservations include DENY channels, not only routes.
  // This is payload capacity only: a future runtime must separately admit queue
  // overhead, tensors, workers and model memory under its global device budget.
  const queuedMessages=t.channels.reduce((total,c)=>total+c.queueLimit,0);
  const queuedPayloadBytes=t.channels.reduce((total,c)=>total+c.queueLimit*c.maxPayloadBytes,0);
  if(queuedMessages>t.transportBudget.maxQueuedMessages)return 'TRANSPORT_QUEUE_BUDGET';
  if(queuedPayloadBytes>t.transportBudget.maxQueuedPayloadBytes)return 'TRANSPORT_PAYLOAD_BUDGET';
  const expected=new Set(g.edges.map(e=>JSON.stringify([e.from,e.to]))),seen=new Set();
  for(const route of p.routes){
    const key=JSON.stringify([route.fromNodeId,route.toNodeId]);
    if(!expected.has(key)||seen.has(key))return 'ROUTE_EDGE_MEMBERSHIP';
    seen.add(key);
    const channel=channels.get(route.channelId);if(!channel)return 'ROUTE_CHANNEL_UNKNOWN';
    if(channel.permission!=='ALLOW')return 'ROUTE_CHANNEL_DENIED';
    if(ports.get(channel.fromPortId).nodeId!==route.fromNodeId||ports.get(channel.toPortId).nodeId!==route.toNodeId)return 'ROUTE_DIRECTION_MISMATCH';
  }
  if(seen.size!==expected.size)return 'ROUTE_EDGE_MEMBERSHIP';
  return null;
}

/** Both inputs are bounded raw declarations. ALLOW is an unproven declaration,
 * not authority. No caller paths, weights, policy/evidence objects or code are
 * resolved. A rehashed change is new metadata, not a current/admitted revision.
 */
export function validateDualFaceBytes(baseBytes, bytes) {
  try {
    // Copy bounded inputs before validating/parsing to avoid retaining mutable
    // caller views between the base check and graph-binding semantics.
    const baseCopy=Buffer.isBuffer(baseBytes)&&baseBytes.byteLength<=BN01_LIMITS.bytes?Buffer.from(baseBytes):baseBytes;
    const baseResult=validateBn01Bytes(baseCopy);
    if(!baseResult.ok)return result('BASE_CONTRACT_REFUSED');
    if(!Buffer.isBuffer(bytes))return result('INPUT_TYPE');
    if(bytes.byteLength===0||bytes.byteLength>DUAL_FACE_LIMITS.bytes)return result('INPUT_SIZE');
    let text,dual;
    try{text=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(Buffer.from(bytes));}
    catch{return result('UTF8_INVALID');}
    try{dual=JSON.parse(text);}catch{return result('JSON_INVALID');}
    if(!boundedTree(dual))return result('TREE_LIMIT');
    if(!checkSchema(dual))return result('SCHEMA_INVALID');
    if(canonical(dual)!==text)return result('NONCANONICAL_BYTES');
    if(hash(dual.topology.record)!==dual.topology.sha256)return result('TOPOLOGY_DIGEST_MISMATCH');
    if(hash(dual.plan.record)!==dual.plan.sha256)return result('PLAN_DIGEST_MISMATCH');
    if(dual.plan.record.topologySha256!==dual.topology.sha256)return result('PLAN_TOPOLOGY_MISMATCH');
    const failure=semantics(JSON.parse(baseCopy.toString('utf8')),dual);
    if(failure)return result(failure);
    return result('PASS_BN01_DUAL_FACE_METADATA_BINDING_ONLY',{topologySha256:dual.topology.sha256,planSha256:dual.plan.sha256});
  } catch {
    // Unexpected input/runtime exceptions remain explicit failure, never PASS.
    return result('VALIDATION_ERROR');
  }
}
