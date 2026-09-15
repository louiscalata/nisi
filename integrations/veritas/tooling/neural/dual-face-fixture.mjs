// Independent synthetic encoder/fixture; never imported by the checker.
// Gemma draft corrected for domain separation, hexadecimal digests, safe key
// construction and matching channel IDs. No real models, permissions or data.
import { createHash } from 'node:crypto';

export function canonicalFixtureBytes(value) {
  const ordered = (item) => item === null || typeof item !== 'object' ? item
    : Array.isArray(item) ? item.map(ordered)
    : Object.fromEntries(Object.entries(item)
      .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
      .map(([key, child]) => [key, ordered(child)]));
  return Buffer.from(JSON.stringify(ordered(value)), 'utf8');
}

export function dualFixtureDigest(record) {
  return createHash('sha256')
    .update(`veritas/bn01-dual-face/${record.kind}\0`)
    .update(canonicalFixtureBytes(record)).digest('hex');
}

export function sealDualFixture(fixture) {
  fixture.topology.sha256 = dualFixtureDigest(fixture.topology.record);
  fixture.plan.record.topologySha256 = fixture.topology.sha256;
  fixture.plan.sha256 = dualFixtureDigest(fixture.plan.record);
  return fixture;
}

export function makeDualFixture(base) {
  const ports = [
    { portId: 'n0.a', nodeId: 'node.0', face: 'A' },
    { portId: 'n0.b', nodeId: 'node.0', face: 'B' },
    { portId: 'n1.a', nodeId: 'node.1', face: 'A' },
    { portId: 'n1.b', nodeId: 'node.1', face: 'B' },
  ];
  const links = [
    { linkId: 'link.0', aPortId: 'n0.a', bPortId: 'n1.b' },
    { linkId: 'link.1', aPortId: 'n1.a', bPortId: 'n0.b' },
  ];
  const channels = links.flatMap((link, index) => ['forward', 'return'].map((direction) => ({
    channelId: `channel.${index}.${direction}`, linkId: link.linkId,
    fromPortId: direction === 'forward' ? link.aPortId : link.bPortId,
    toPortId: direction === 'forward' ? link.bPortId : link.aPortId,
    permission: 'ALLOW', queueLimit: 4, maxPayloadBytes: 256, hopLimit: 4, ttlMs: 1000,
  })));
  return sealDualFixture({
    schemaVersion: 1, profile: 'veritas-bn01-dual-face-v1',
    topology: { record: {
      kind: 'dual-face-topology-v1', topologyId: 'synthetic.topology', revision: 1,
      scopeId: base.graph.record.scopeId, baseGraphSha256: base.graph.sha256,
      transportBudget: {maxQueuedMessages:256,maxQueuedPayloadBytes:1048576},
      ports, links, channels,
    }, sha256: null },
    plan: { record: {
      kind: 'dual-face-plan-v1', runSha256: base.run.sha256, topologySha256: null,
      routes: [{ fromNodeId: 'node.0', toNodeId: 'node.1', channelId: 'channel.0.forward' }],
    }, sha256: null },
  });
}
