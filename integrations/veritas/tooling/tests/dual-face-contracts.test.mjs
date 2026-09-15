import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { validateDualFaceBytes } from '../neural/dual-face.mjs';
import { makeBn01Fixture, fixtureBytes, resealFixture, fakeDigest } from '../neural/bn01-fixture.mjs';
import { makeDualFixture, sealDualFixture, canonicalFixtureBytes, dualFixtureDigest } from '../neural/dual-face-fixture.mjs';

// Task-derived oracle, blind to the implementation. The local test draft was
// rejected: it invented object paths, changed positive expectations, truncated,
// and attempted to manufacture the output flags instead of asserting them.
const PASS = 'PASS_BN01_DUAL_FACE_METADATA_BINDING_ONLY';
const cases = [];
const pair = () => { const base = makeBn01Fixture(); return { base, dual: makeDualFixture(base) }; };
const add = (id, ok, edit = () => {}, options = {}) => cases.push({ id, ok, input() {
  const p = options.factory ? options.factory() : pair();
  edit(p.dual, p.base);
  if (options.seal !== false) sealDualFixture(p.dual);
  return [fixtureBytes(p.base), canonicalFixtureBytes(p.dual)];
} });
const raw = (id, second) => cases.push({ id, ok: false, input: () => [fixtureBytes(makeBn01Fixture()), second()] });

function larger(count, disconnected = false) {
  const base = makeBn01Fixture();
  for (let i = 2; i < count; i++) {
    const p = structuredClone(base.plugins[0]); p.record.pluginId = `local.veritas.extra${i}`;
    base.plugins.push(p);
  }
  base.graph.record.nodes = base.plugins.map((p, i) => ({nodeId:`node.${i}`,pluginId:p.record.pluginId,revisionSha256:p.sha256}));
  base.graph.record.executionOrder = base.graph.record.nodes.map(n => n.nodeId);
  base.graph.record.edges = disconnected ? [{from:'node.0',to:'node.1'},{from:'node.2',to:'node.3'}]
    : Array.from({length:count-1}, (_, i) => ({from:`node.${i}`,to:`node.${i+1}`}));
  if (disconnected) base.run.record.inputBindings.push({...base.run.record.inputBindings[0],nodeId:'node.2'});
  base.graph.record.budgets = {maxResidentBytes:4096*count,maxOperations:1000*count,maxInferenceMs:50*count,maxOutputBytes:512*count};
  resealFixture(base);
  const dual = makeDualFixture(base), t = dual.topology.record;
  t.ports = base.graph.record.nodes.flatMap((node, i) => ['A','B'].map(face => ({portId:`n${i}.${face.toLowerCase()}`,nodeId:node.nodeId,face})));
  t.links = base.graph.record.nodes.map((_, i) => ({linkId:`link.${i}`,aPortId:`n${i}.a`,bPortId:`n${disconnected ? i ^ 1 : (i+1)%count}.b`}));
  t.channels = t.links.flatMap((link, i) => ['forward','return'].map(direction => ({
    channelId:`channel.${i}.${direction}`,linkId:link.linkId,
    fromPortId:direction==='forward'?link.aPortId:link.bPortId,
    toPortId:direction==='forward'?link.bPortId:link.aPortId,
    permission:'ALLOW',queueLimit:4,maxPayloadBytes:256,hopLimit:4,ttlMs:1000,
  })));
  dual.plan.record.routes = base.graph.record.edges.map(e => ({fromNodeId:e.from,toNodeId:e.to,channelId:`channel.${e.from.slice(5)}.forward`}));
  return {base,dual:sealDualFixture(dual)};
}

add('two-node-dual-face-loop', true);
add('return-denied-forward-still-works', true, d => {d.topology.record.channels[1].permission='DENY';});
add('unused-attachment-directions-may-be-denied', true, d => {d.topology.record.channels[2].permission='DENY';d.topology.record.channels[3].permission='DENY';});
add('three-node-attachment-cycle-not-computation-cycle', true, () => {}, {factory:()=>larger(3)});
add('maximum-sixteen-node-connected-attachments', true, () => {}, {factory:()=>larger(16)});
add('no-computation-edges-retains-attachment-graph', true, (d,b) => {
  b.graph.record.edges=[];b.run.record.inputBindings.push({...b.run.record.inputBindings[0],nodeId:'node.1'});
  resealFixture(b);d.topology.record.baseGraphSha256=b.graph.sha256;d.plan.record.runSha256=b.run.sha256;d.plan.record.routes=[];
});
add('missing-route', false, d => {d.plan.record.routes=[];});
add('duplicate-route', false, d => {d.plan.record.routes.push({...d.plan.record.routes[0]});});
add('extra-reversed-route', false, d => {d.plan.record.routes.push({fromNodeId:'node.1',toNodeId:'node.0',channelId:'channel.0.return'});});
add('denied-route', false, d => {d.topology.record.channels[0].permission='DENY';});
add('wrong-route-direction', false, d => {d.plan.record.routes[0].channelId='channel.0.return';});
add('unknown-route-channel', false, d => {d.plan.record.routes[0].channelId='unknown';});
add('unknown-route-node', false, d => {d.plan.record.routes[0].toNodeId='unknown';});
add('duplicate-port-id', false, d => {d.topology.record.ports[1].portId='n0.a';});
add('unknown-port-node', false, d => {d.topology.record.ports[0].nodeId='unknown';});
add('missing-b-face', false, d => {d.topology.record.ports[1].face='A';});
add('swapped-link-faces', false, d => {const l=d.topology.record.links[0];[l.aPortId,l.bPortId]=[l.bPortId,l.aPortId];});
add('self-attachment', false, d => {d.topology.record.links[0].bPortId='n0.b';});
add('reused-port', false, d => {d.topology.record.links[1].aPortId='n0.a';d.topology.record.links[1].bPortId='n1.b';});
add('unlinked-extra-port', false, d => {d.topology.record.ports.push({portId:'extra.a',nodeId:'node.0',face:'A'});});
add('duplicate-link-id', false, d => {d.topology.record.links[1].linkId='link.0';});
add('unknown-link-port', false, d => {d.topology.record.links[0].aPortId='unknown';});
add('five-ports-on-one-face', false, d => {for(let i=0;i<4;i++)d.topology.record.ports.push({portId:`extra.${i}`,nodeId:'node.0',face:'A'});});
add('disconnected-components-with-valid-local-routes', false, () => {}, {factory:()=>larger(4,true)});
add('duplicate-channel-id', false, d => {d.topology.record.channels[1].channelId='channel.0.forward';});
add('duplicate-channel-direction', false, d => {const c=d.topology.record.channels[1];c.fromPortId='n0.a';c.toPortId='n1.b';});
add('missing-return-within-schema-minimum', false, d => {d.topology.record.channels.pop();}, {factory:()=>larger(3)});
add('unknown-channel-link', false, d => {d.topology.record.channels[0].linkId='unknown';});
add('wrong-channel-endpoint', false, d => {d.topology.record.channels[0].toPortId='n0.b';});
add('scope-substitution', false, d => {d.topology.record.scopeId='other.project';});
add('base-graph-substitution', false, d => {d.topology.record.baseGraphSha256=fakeDigest('other');});
add('base-run-substitution', false, d => {d.plan.record.runSha256=fakeDigest('other');});
add('stale-topology-envelope', false, d => {d.topology.record.revision++;}, {seal:false});
add('stale-plan-envelope', false, d => {d.plan.record.routes[0].channelId='channel.1.return';}, {seal:false});
add('plan-topology-substitution', false, d => {d.plan.record.topologySha256=fakeDigest('other');d.plan.sha256=dualFixtureDigest(d.plan.record);}, {seal:false});
add('wrong-digest-domain', false, d => {d.topology.sha256=createHash('sha256').update(canonicalFixtureBytes(d.topology.record)).digest('hex');}, {seal:false});
add('base-computation-cycle-refused', false, (d,b) => {b.graph.record.edges.push({from:'node.1',to:'node.0'});resealFixture(b);d.topology.record.baseGraphSha256=b.graph.sha256;d.plan.record.runSha256=b.run.sha256;});
add('allow-channel-incompatible-return-space', false, (d,b) => {
  b.plugins[0].record.input.spaceSha256=fakeDigest('different-root-space');resealFixture(b);
  d.topology.record.baseGraphSha256=b.graph.sha256;d.plan.record.runSha256=b.run.sha256;
});
add('denied-incompatible-return-remains-attached', true, (d,b) => {
  b.plugins[0].record.input.spaceSha256=fakeDigest('different-root-space');resealFixture(b);
  d.topology.record.baseGraphSha256=b.graph.sha256;d.plan.record.runSha256=b.run.sha256;
  d.topology.record.channels[1].permission='DENY';d.topology.record.channels[2].permission='DENY';
});
for (const field of ['queueLimit','maxPayloadBytes','hopLimit','ttlMs']) {
  add(`zero-${field}`, false, d => {d.topology.record.channels[0][field]=0;});
  add(`excess-${field}`, false, d => {d.topology.record.channels[0][field]=Number.MAX_SAFE_INTEGER;});
}
add('unknown-root-authority', false, d => {d.authorizing=true;});
add('unknown-nested-authority', false, d => {d.topology.record.channels[0].execute=true;});
add('path-in-id', false, d => {d.topology.record.topologyId='../escape';});
add('newline-in-id', false, d => {d.topology.record.topologyId='node\n';});
add('unicode-in-id', false, d => {d.topology.record.topologyId='café';});
add('too-long-id', false, d => {d.topology.record.topologyId='a'.repeat(97);});
add('floating-revision', false, d => {d.topology.record.revision=1.5;});
raw('non-buffer', () => '{}');
raw('empty', () => Buffer.alloc(0));
raw('raw-byte-limit', () => Buffer.alloc(131073,0xff));
raw('invalid-utf8', () => Buffer.from([0xff]));
raw('bad-json', () => Buffer.from('{'));
raw('depth-limit', () => Buffer.from('['.repeat(14)+'0'+']'.repeat(14)));
raw('value-limit', () => Buffer.from(JSON.stringify(Array(6001).fill(0))));
raw('bom', () => Buffer.concat([Buffer.from([0xef,0xbb,0xbf]),canonicalFixtureBytes(pair().dual)]));
raw('trailing-space', () => Buffer.concat([canonicalFixtureBytes(pair().dual),Buffer.from(' ')]));
raw('duplicate-json-key', () => Buffer.from(canonicalFixtureBytes(pair().dual).toString().replace('"schemaVersion":1','"schemaVersion":1,"schemaVersion":1')));
raw('noncanonical-number', () => Buffer.from(canonicalFixtureBytes(pair().dual).toString().replace('"revision":1','"revision":1.0')));
raw('unknown-schema-property', () => Buffer.from('{"__proto__":{"authorizing":true}}'));

add('aggregate-payload-exact-boundary', true, d => {
  d.topology.record.channels.forEach((c,i)=>{c.queueLimit=i===0?16:1;c.maxPayloadBytes=[65535,5,5,6][i];});
});
add('aggregate-payload-one-byte-over', false, d => {
  d.topology.record.channels.forEach((c,i)=>{c.queueLimit=i===0?16:1;c.maxPayloadBytes=[65535,5,5,7][i];});
});
add('aggregate-queue-exact-boundary', true, d => {
  d.topology.record.channels.forEach((c,i)=>{c.queueLimit=[64,64,64,62,1,1][i];c.maxPayloadBytes=1;});
}, {factory:()=>larger(3)});
add('aggregate-queue-one-message-over', false, d => {
  d.topology.record.channels.forEach((c,i)=>{c.queueLimit=[64,64,64,62,2,1][i];c.maxPayloadBytes=1;});
}, {factory:()=>larger(3)});
add('declared-queue-budget-exceeded', false, d => {d.topology.record.transportBudget.maxQueuedMessages=15;});
add('declared-payload-budget-exceeded', false, d => {d.topology.record.transportBudget.maxQueuedPayloadBytes=4095;});
add('denied-unused-channels-still-reserved', false, d => {
  d.topology.record.channels.forEach((c,i)=>{if(i)c.permission='DENY';});
  d.topology.record.transportBudget.maxQueuedMessages=4;
});
add('queue-profile-ceiling-one-over', false, d => {d.topology.record.transportBudget.maxQueuedMessages=257;});
add('payload-profile-ceiling-one-over', false, d => {d.topology.record.transportBudget.maxQueuedPayloadBytes=1048577;});
add('missing-transport-budget', false, d => {delete d.topology.record.transportBudget;});

// Explicit refusal oracle. Never derive expected codes from the checker.
const refusalGroups = {
  ROUTE_EDGE_MEMBERSHIP:['missing-route','duplicate-route','extra-reversed-route','unknown-route-node'],
  ROUTE_CHANNEL_DENIED:['denied-route'],ROUTE_DIRECTION_MISMATCH:['wrong-route-direction'],ROUTE_CHANNEL_UNKNOWN:['unknown-route-channel'],
  PORT_DUPLICATE:['duplicate-port-id'],PORT_NODE_UNKNOWN:['unknown-port-node'],FACE_COVERAGE:['missing-b-face','five-ports-on-one-face'],
  LINK_FACE_MISMATCH:['swapped-link-faces'],LINK_SELF_ATTACHMENT:['self-attachment'],PORT_REUSED:['reused-port'],PORT_UNLINKED:['unlinked-extra-port'],
  LINK_DUPLICATE:['duplicate-link-id'],LINK_PORT_UNKNOWN:['unknown-link-port'],ATTACHMENTS_DISCONNECTED:['disconnected-components-with-valid-local-routes'],
  CHANNEL_DUPLICATE:['duplicate-channel-id'],CHANNEL_DIRECTION_DUPLICATE:['duplicate-channel-direction'],CHANNEL_PAIR_MISSING:['missing-return-within-schema-minimum'],
  CHANNEL_LINK_UNKNOWN:['unknown-channel-link'],CHANNEL_ENDPOINT_MISMATCH:['wrong-channel-endpoint'],
  SCOPE_MISMATCH:['scope-substitution'],BASE_GRAPH_MISMATCH:['base-graph-substitution'],BASE_RUN_MISMATCH:['base-run-substitution'],
  TOPOLOGY_DIGEST_MISMATCH:['stale-topology-envelope','wrong-digest-domain'],PLAN_DIGEST_MISMATCH:['stale-plan-envelope'],PLAN_TOPOLOGY_MISMATCH:['plan-topology-substitution'],
  BASE_CONTRACT_REFUSED:['base-computation-cycle-refused'],CHANNEL_TENSOR_MISMATCH:['allow-channel-incompatible-return-space'],
  SCHEMA_INVALID:['zero-queueLimit','excess-queueLimit','zero-maxPayloadBytes','excess-maxPayloadBytes','zero-hopLimit','excess-hopLimit','zero-ttlMs','excess-ttlMs',
    'unknown-root-authority','unknown-nested-authority','path-in-id','newline-in-id','unicode-in-id','too-long-id','floating-revision','unknown-schema-property',
    'queue-profile-ceiling-one-over','payload-profile-ceiling-one-over','missing-transport-budget'],
  INPUT_TYPE:['non-buffer'],INPUT_SIZE:['empty','raw-byte-limit'],UTF8_INVALID:['invalid-utf8'],JSON_INVALID:['bad-json','bom'],TREE_LIMIT:['depth-limit','value-limit'],
  NONCANONICAL_BYTES:['trailing-space','duplicate-json-key','noncanonical-number'],
  TRANSPORT_PAYLOAD_BUDGET:['aggregate-payload-one-byte-over','declared-payload-budget-exceeded'],
  TRANSPORT_QUEUE_BUDGET:['aggregate-queue-one-message-over','declared-queue-budget-exceeded','denied-unused-channels-still-reserved'],
};
const refusalEntries=Object.entries(refusalGroups).flatMap(([code,ids])=>ids.map(id=>[id,code]));
const refusalCodes=new Map(refusalEntries);
export const DUAL_FACE_CASE_VECTOR = Object.freeze(cases.map(c => Object.freeze([c.id,c.ok?PASS:refusalCodes.get(c.id)])));
const VECTOR_SHA256 = 'c75e7a678ce802874796f12aac5070535ae95873b53f41c074a1bad6f5b4051f';
const vectorDigest=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
function requireFrozenVector(v) {
  assert.equal(v.length,76);assert.equal(new Set(v.map(row=>row[0])).size,76);
  assert.equal(v.filter(row=>row[1]===PASS).length,9);
  assert.equal(vectorDigest(v),VECTOR_SHA256);
}
test('dual-face exact inventory and refusal oracle are frozen',()=>{
  assert.equal(refusalEntries.length,refusalCodes.size);
  assert.equal(refusalCodes.size,cases.filter(c=>!c.ok).length);
  assert.ok(DUAL_FACE_CASE_VECTOR.every(row=>typeof row[1]==='string'&&row[1]));
  requireFrozenVector(DUAL_FACE_CASE_VECTOR);
});
test('dual-face oracle rejects missing extra reordered duplicate and outcome mutants',()=>{
  for(const v of [[],DUAL_FACE_CASE_VECTOR.slice(1),[...DUAL_FACE_CASE_VECTOR,DUAL_FACE_CASE_VECTOR[0]],
    [DUAL_FACE_CASE_VECTOR[1],DUAL_FACE_CASE_VECTOR[0],...DUAL_FACE_CASE_VECTOR.slice(2)],
    [DUAL_FACE_CASE_VECTOR[1],...DUAL_FACE_CASE_VECTOR.slice(1)],
    [[DUAL_FACE_CASE_VECTOR[0][0],'SCHEMA_INVALID'],...DUAL_FACE_CASE_VECTOR.slice(1)]])assert.throws(()=>requireFrozenVector(v));
});
for (const c of cases) test(`dual-face ${c.id}`, () => {
  const [base,bytes]=c.input(),beforeBase=Buffer.from(base),before=Buffer.isBuffer(bytes)?Buffer.from(bytes):bytes;
  const result=validateDualFaceBytes(base,bytes);
  assert.equal(result.ok,c.ok,c.id);
  assert.equal(result.code,c.ok?PASS:refusalCodes.get(c.id),c.id);
  assert.equal(typeof result.code,'string');assert.notEqual(result.code,'');
  assert.deepEqual(base,beforeBase);assert.deepEqual(bytes,before);assert.equal(Object.isFrozen(result),true);
  for(const field of ['attachmentRuntimeObserved','modelExecuted','authorizing','certificationGranted','promotionGranted'])assert.equal(result[field],false,field);
  assert.equal(result.neuralRoadmapCredit,0);
  assert.deepEqual(validateDualFaceBytes(base,bytes),result,'repeat must preserve exact result');
});

test('dual-face malformed base cannot be bypassed', () => {
  const {dual}=pair();
  assert.equal(validateDualFaceBytes(Buffer.from('{}'),canonicalFixtureBytes(dual)).code,'BASE_CONTRACT_REFUSED');
});
