// Test-only Node 24 registerHooks fault injector. Never imported by production.
// The loader wraps only canonical adapter owner/constructor exports in this child.
import { registerHooks } from 'node:module';

const fault = process.argv[2];
if (!['author-adapter','reviewer-owner','reviewer-adapter','rollback-throw','rollback-idle'].includes(fault)) throw Error('UNKNOWN_FAULT');
let transportCalls=0;
globalThis.__NISI_BOOTSTRAP_STOP__ = () => { if(fault==='rollback-throw') throw Error('STOP_FAILED'); return fault==='rollback-idle'; };
const expected = new Error(`BOOTSTRAP_${fault}`);
const owners = [];
let ownerAttempts = 0;
globalThis.__NISI_BOOTSTRAP_OWNER_ATTEMPT__ = () => {
  ownerAttempts += 1;
  if (fault === 'reviewer-owner' && ownerAttempts === 2) throw expected;
};
globalThis.__NISI_BOOTSTRAP_OWNER__ = (owner, kind) => { owners.push({ owner, kind }); };
globalThis.__NISI_BOOTSTRAP_ADAPTER__ = kind => {
  if (kind === fault || (fault.startsWith('rollback-') && kind === 'reviewer-adapter')) throw expected;
};

const target = suffix => new URL('../../'+suffix, import.meta.url).href;
const transforms = new Map([
  [target('adapters/local-chat.mjs'), [
    ['stop() { state.stopped=true;', 'stop() { if(globalThis.__NISI_BOOTSTRAP_STOP__()) return; state.stopped=true;'],
    ["export function createLocalChatTransportOwner() {", "export function createLocalChatTransportOwner() { globalThis.__NISI_BOOTSTRAP_OWNER_ATTEMPT__();"],
    ['transportOwners.set(owner,state);return owner;', "transportOwners.set(owner,state);globalThis.__NISI_BOOTSTRAP_OWNER__(owner,'local-owner');return owner;"],
    ["export function createLocalChatGuidedAuthorAdapterV1(input, registration) {", "export function createLocalChatGuidedAuthorAdapterV1(input, registration) { globalThis.__NISI_BOOTSTRAP_ADAPTER__('author-adapter');"],
    ["export function createLocalChatReviewerAdapter(input) {", "export function createLocalChatReviewerAdapter(input) { globalThis.__NISI_BOOTSTRAP_ADAPTER__('reviewer-adapter');"],
  ]],
  [target('adapters/native-chat-v1.mjs'), [
    ['stop() { state.stopped = true;', 'stop() { if(globalThis.__NISI_BOOTSTRAP_STOP__()) return; state.stopped = true;'],
    ["export function createNativeChatTransportOwnerV1() {", "export function createNativeChatTransportOwnerV1() { globalThis.__NISI_BOOTSTRAP_OWNER_ATTEMPT__();"],
    ['owners.set(owner, state); return owner;', "owners.set(owner, state); globalThis.__NISI_BOOTSTRAP_OWNER__(owner, 'native-owner'); return owner;"],
    ["export const createNativeChatAuthorAdapterV1 = input => adapter(input, 'author');", "export const createNativeChatAuthorAdapterV1 = input => { globalThis.__NISI_BOOTSTRAP_ADAPTER__('author-adapter'); return adapter(input, 'author'); };"],
    ["export const createNativeChatReviewerAdapterV1 = input => adapter(input, 'reviewer');", "export const createNativeChatReviewerAdapterV1 = input => { globalThis.__NISI_BOOTSTRAP_ADAPTER__('reviewer-adapter'); return adapter(input, 'reviewer'); };"],
    ["export const createNativeChatGuidedAuthorAdapterV1 = (input, registration) =>\n  adapter(input, 'author', readRepairGuidanceV1(registration, 'NATIVE_API'));", "export const createNativeChatGuidedAuthorAdapterV1 = (input, registration) => { globalThis.__NISI_BOOTSTRAP_ADAPTER__('author-adapter'); return adapter(input, 'author', readRepairGuidanceV1(registration, 'NATIVE_API')); };"],
  ]],
]);

registerHooks({ load(url, context, nextLoad) {
  const loaded = nextLoad(url, context), replacements = transforms.get(url);
  if (!replacements) return loaded;
  let source = typeof loaded.source === 'string' ? loaded.source : Buffer.from(loaded.source).toString('utf8');
  for (const [from, to] of replacements) {
    if (source.split(from).length !== 2) throw new Error(`FAULT_SITE_NOT_UNIQUE:${url}:${from}`);
    source = source.replace(from, to);
  }
  return { ...loaded, source };
} });

// Load all fixture dependencies after hook registration: selection's fixture
// also imports adapters, which must not be cached before fault instrumentation.
const { createReviewedLiveFixtureV1 } = await import('../../examples/repository-task/reviewed-live-fixture-v1.mjs');
const { registerRepairGuidanceV1 } = await import('../../adapters/repair-guidance-v1.mjs');
const { selection } = await import('./live-model-v3-fixture.mjs');
const { createReviewedLiveModelLaneWithTransportV4: create } = await import('../../hosts/repository/reviewed-live-model-v4.mjs');
const fixture = await createReviewedLiveFixtureV1();
const treatment = registerRepairGuidanceV1({ arm: 'ON', api: 'NATIVE_API', binding: {
  taskFingerprint: fixture.preparations[0].taskFingerprint, baselineFingerprint: fixture.baseline.fingerprint,
  suiteFingerprint: fixture.suite.fingerprint, reviewedSourceFingerprint: fixture.reviewedSourceFingerprint,
} });
const value = { suite: fixture.suite, reviewedSourceFingerprint: fixture.reviewedSourceFingerprint,
  author: selection('author', 'NATIVE_API'), reviewer: selection('reviewer', 'CHAT_COMPLETIONS'),
  timeoutMs: 1000, maxOutputTokens: 512, approval: { id: 'synthetic.approval', expiresAtMs: 10000 }, arm: 'ON', treatment };
const transport = async () => { transportCalls++; throw new Error('TRANSPORT_MUST_NOT_BE_CALLED'); };
let caught = null;
try { create(value, { author: transport, reviewer: transport }); }
catch (error) { caught = error; }
const states = owners.map(({ owner, kind }) => ({ kind, state: owner.status().state, pendingTransports: owner.status().pendingTransports }));
if(transportCalls!==0)throw Error('UNEXPECTED_TRANSPORT');
if(fault.startsWith('rollback-')) {
  if(caught?.code!=='LIVE_CONSTRUCTOR_ROLLBACK_UNCONFIRMED'||states.some(item=>item.state!=='IDLE'))throw Error('ROLLBACK_UNCERTAINTY_NOT_REPORTED');
} else {
  if(caught!==expected)throw Error('ORIGINAL_ERROR_IDENTITY_NOT_RETHROWN');
  if(!states.length||states.some(item=>item.state!=='STOPPED'||item.pendingTransports!==0))throw Error('OWNER_NOT_STOPPED');
}
process.stdout.write(JSON.stringify({ fault, error: caught.message, states, ownerCount: states.length, transportCalls }));
