// Closed internal queue-response boundary. No trust in a success string alone.
const flagNames=['authorizing','modelExecuted','promotionGranted','certificationGranted'];
const common=['ok','code',...flagNames];
const id=v=>typeof v==='string'&&v.length<=96&&/^[a-z][a-z0-9_.-]*(?![\s\S])/.test(v);
const int=(v,min,max=Number.MAX_SAFE_INTEGER)=>Number.isSafeInteger(v)&&v>=min&&v<=max;
const states=['QUEUED','IN_FLIGHT','DELIVERED','EXPIRED','CANCELLED'];
const enqueueRefusals=new Set(['PACKET_BYTES_REFUSED','UTF8_INVALID','JSON_INVALID','PACKET_SCHEMA_INVALID',
 'NONCANONICAL_PACKET','GENERATION_MISMATCH','IDENTITY_MISMATCH','ROUTE_REFUSED','ENDPOINT_MISMATCH',
 'TENSOR_MISMATCH','NONFINITE_PAYLOAD','TASK_CONFLICT','PAYLOAD_LIMIT','HOP_LIMIT','TTL_LIMIT',
 'DEADLINE_OVERFLOW','FUTURE_PACKET','EXPIRED','TASK_HISTORY_FULL','CHANNEL_FULL','CAPACITY_FULL']);
function record(value,keys){
  if(!value||Object.getPrototypeOf(value)!==Object.prototype)throw Error('QUEUE_FAILURE');
  const descriptors=Object.getOwnPropertyDescriptors(value);
  if(Reflect.ownKeys(descriptors).length!==keys.length)throw Error('QUEUE_FAILURE');
  const copy={};
  for(const key of keys){const d=descriptors[key];if(!d||!Object.hasOwn(d,'value'))throw Error('QUEUE_FAILURE');copy[key]=d.value;}
  return Object.freeze(copy);
}
function header(value){
  // Capture headers without invoking getters, then select the exact closed shape.
  if(!value||Object.getPrototypeOf(value)!==Object.prototype)throw Error('QUEUE_FAILURE');
  const d=Object.getOwnPropertyDescriptors(value);
  if(!d.ok||!Object.hasOwn(d.ok,'value')||!d.code||!Object.hasOwn(d.code,'value'))throw Error('QUEUE_FAILURE');
  if(typeof d.ok.value!=='boolean'||typeof d.code.value!=='string')throw Error('QUEUE_FAILURE');
  return {ok:d.ok.value,code:d.code.value};
}
function shape(value,extra=[]){
  const r=record(value,[...common,...extra]);
  if(!flagNames.every(k=>r[k]===false)||typeof r.ok!=='boolean'||typeof r.code!=='string')throw Error('QUEUE_FAILURE');
  return r;
}
function emptyTicket(ticket){
  return ticket!==null&&typeof ticket==='object'&&Object.getPrototypeOf(ticket)===null&&
    Object.isFrozen(ticket)&&Reflect.ownKeys(ticket).length===0;
}
function capture(value){
  if(!value||Object.getPrototypeOf(value)!==Object.prototype)throw Error('QUEUE_FAILURE');
  const d=Object.getOwnPropertyDescriptors(value),keys=Reflect.ownKeys(d);
  if(keys.length>20)throw Error('QUEUE_FAILURE');
  const copy={};
  for(const key of keys){
    if(typeof key!=='string'||!Object.hasOwn(d[key],'value'))throw Error('QUEUE_FAILURE');
    Object.defineProperty(copy,key,{value:d[key].value,enumerable:true});
  }
  return Object.freeze(copy);
}

/** Inputs are the same owned canonical copies already validated by the queue. */
export function makeQueueResponseReader(baseBytes,dualBytes,generation,maxHistory){
  const base=JSON.parse(baseBytes.toString('utf8')),dual=JSON.parse(dualBytes.toString('utf8'));
  const pins={graphSha256:base.graph.sha256,runSha256:base.run.sha256,
    topologySha256:dual.topology.sha256,planSha256:dual.plan.sha256,generation};
  const plugins=new Map(base.plugins.map(p=>[p.sha256,p.record]));
  const nodes=new Map(base.graph.record.nodes.map(n=>[n.nodeId,n]));
  const channels=new Map(dual.topology.record.channels.map(c=>[c.channelId,c]));
  const routes=new Map(dual.plan.record.routes.map(r=>[r.channelId,{
    channel:channels.get(r.channelId),tensor:plugins.get(nodes.get(r.fromNodeId).revisionSha256).output}]));
  const metadataKeys=['kind','taskId','traveler','graphSha256','runSha256','topologySha256','planSha256',
    'generation','channelId','fromPortId','toPortId','createdAtMs','ttlMs','hopCount','spaceSha256'];

  return (method,value,now)=>{
    // One point-in-time data capture; a proxy cannot switch ok/code between
    // header selection and closed-shape validation. Accessors are not invoked.
    value=capture(value);
    const h=header(value);let r;
    if(method==='inspect'){
      r=shape(value,['state','queued','inFlight','payloadBytes','retainedTaskIds']);
      if(!r.ok||r.code!=='SNAPSHOT'||!['ACTIVE','OFF'].includes(r.state)||
        !int(r.queued,0,256)||!int(r.inFlight,0,256)||!int(r.payloadBytes,0,1048576)||
        !int(r.retainedTaskIds,0,maxHistory)||r.queued+r.inFlight>Math.min(256,r.retainedTaskIds)||
        (r.state==='OFF'&&(r.queued!==0||r.inFlight!==0||r.payloadBytes!==0)))throw Error('QUEUE_FAILURE');
      return r;
    }
    if(method==='stop'){
      r=shape(value);
      if(!((r.ok&&r.code==='STOPPED')||(!r.ok&&r.code==='OFF')))throw Error('QUEUE_FAILURE');
      return r;
    }
    if(!h.ok){
      r=shape(value);
      const allowed=method==='enqueue'?enqueueRefusals.has(r.code)
        :method==='take'?r.code==='EMPTY'
        :method==='cancel'?['TASK_ID_INVALID','TASK_UNKNOWN'].includes(r.code)
        :['consume','cancelTicket'].includes(method)?r.code==='INVALID_TICKET':false;
      if(!allowed)throw Error('QUEUE_FAILURE');return r;
    }
    if(['enqueue','cancel','cancelTicket'].includes(method)){
      r=shape(value,['taskId','taskState']);
      const allowed=method==='enqueue'?((r.code==='QUEUED'&&r.taskState==='QUEUED')||
          (r.code==='DUPLICATE'&&states.includes(r.taskState)))
        :((r.code==='CANCELLED'&&r.taskState==='CANCELLED')||
          (method==='cancel'&&r.code==='ALREADY_TERMINAL'&&['DELIVERED','EXPIRED','CANCELLED'].includes(r.taskState)));
      if(!id(r.taskId)||!allowed)throw Error('QUEUE_FAILURE');return r;
    }
    if(method==='take'){
      r=shape(value,['ticket']);if(r.code!=='TAKEN'||!emptyTicket(r.ticket))throw Error('QUEUE_FAILURE');return r;
    }
    if(method==='consume'){
      r=shape(value,['taskId','packet','payload']);
      const p=record(r.packet,metadataKeys),route=routes.get(p.channelId);
      if(r.code!=='DELIVERED'||!id(r.taskId)||p.taskId!==r.taskId||p.kind!=='veritas-courier-f32-v1'||
        !['PROTON','ELECTRON','NEUTRON'].includes(p.traveler)||!Object.entries(pins).every(([k,v])=>p[k]===v)||
        !route||route.channel.permission!=='ALLOW'||p.fromPortId!==route.channel.fromPortId||
        p.toPortId!==route.channel.toPortId||p.spaceSha256!==route.tensor.spaceSha256||
        !int(p.createdAtMs,0,now)||!int(p.ttlMs,1,route.channel.ttlMs)||
        !int(p.hopCount,1,route.channel.hopLimit)||!int(p.createdAtMs+p.ttlMs,0)||now>=p.createdAtMs+p.ttlMs||
        !Buffer.isBuffer(r.payload)||r.payload.buffer instanceof SharedArrayBuffer||
        r.payload.length!==4*route.tensor.width||r.payload.length>route.channel.maxPayloadBytes)throw Error('QUEUE_FAILURE');
      const payload=Buffer.from(r.payload);
      for(let i=0;i<payload.length;i+=4)if(!Number.isFinite(payload.readFloatLE(i)))throw Error('QUEUE_FAILURE');
      return Object.freeze({...r,packet:p,payload});
    }
    throw Error('QUEUE_FAILURE');
  };
}
