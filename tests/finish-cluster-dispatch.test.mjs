import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CLUSTER_RELATIVE = 'work-orders/v02-finish-cluster-v1/cluster.json';
const DISPATCH_RELATIVE = 'work-orders/v02-finish-cluster-v1/dispatch-check.mjs';
const PACKET_ROOT = '.packets';

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function normalizedContractHash(packet) {
  const front = packet.match(/^---\n[\s\S]*?\n---\n/);
  assert(front, 'fixture packet must have frontmatter');
  const status = front[0].match(/^status: [a-z]+$/m);
  assert(status, 'fixture packet must have one status line');
  return createHash('sha256').update(
    packet.replace(front[0], front[0].replace(status[0], 'status: ready')),
  ).digest('hex');
}

function makeFixture(t) {
  const scratch = mkdtempSync(join(tmpdir(), 'nisi-finish-cluster-dispatch-'));
  t.after(() => rmSync(scratch, { recursive: true, force: true }));

  const clusterPath = join(ROOT, CLUSTER_RELATIVE);
  const dispatchPath = join(ROOT, DISPATCH_RELATIVE);
  const cluster = JSON.parse(readFileSync(clusterPath, 'utf8'));
  const scratchClusterPath = join(scratch, CLUSTER_RELATIVE);
  const scratchDispatchPath = join(scratch, DISPATCH_RELATIVE);
  mkdirSync(dirname(scratchClusterPath), { recursive: true });
  mkdirSync(join(scratch, PACKET_ROOT), { recursive: true });
  cpSync(dispatchPath, scratchDispatchPath);

  const packets = new Map();
  for (const row of cluster.packets) {
    const source = join(ROOT, row.packet);
    const target = join(scratch, row.packet);
    mkdirSync(dirname(target), { recursive: true });
    cpSync(source, target);
    packets.set(row.id, readFileSync(source, 'utf8'));
  }

  const c01 = cluster.packets.find(row => row.id === 'C01');
  assert(c01, 'cluster must contain C01');
  const c01Packet = packets.get('C01');
  c01.state = 'READY';
  c01.implementationAccepted = false;
  c01.ownerRelease = {
    ...c01.ownerRelease,
    writeOwner: 'opencode',
    contractSha256: normalizedContractHash(c01Packet),
  };

  return {
    scratch,
    clusterPath: scratchClusterPath,
    packetPath: join(scratch, c01.packet),
    dispatchPath: scratchDispatchPath,
    baseCluster: cluster,
    packets,
    basePacket: c01Packet,
  };
}

function runDispatch(fixture, { id = 'C01', packet, cluster = fixture.baseCluster } = {}) {
  const row = cluster.packets.find(candidate => candidate.id === id);
  if (row) {
    const packetText = packet ?? fixture.packets.get(id);
    assert(packetText, `fixture must contain packet ${id}`);
    const target = join(fixture.scratch, row.packet);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, packetText);
  }
  writeFileSync(fixture.clusterPath, JSON.stringify(cluster));
  const child = spawnSync(process.execPath, [fixture.dispatchPath, id], {
    cwd: fixture.scratch,
    encoding: 'utf8',
    timeout: 3000,
  });
  assert.equal(child.error, undefined, child.error?.message);
  assert.equal(child.signal, null, child.stderr);
  assert.equal(child.stdout, '');
  return {
    exitCode: child.status,
    payload: JSON.parse(child.stderr.trim()),
  };
}

function assertHeld(result, code = undefined) {
  assert.equal(result.exitCode, 2);
  assert.equal(result.payload.status, 'HELD');
  assert.equal(result.payload.dispatchApproved, false);
  assert.equal(result.payload.publicationAuthorized, false);
  if (code !== undefined) assert.equal(result.payload.code, code);
}

test('dispatch approves only the four packet-run status transitions after normalization', t => {
  const fixture = makeFixture(t);
  for (const status of ['ready', 'executing', 'done', 'blocked']) {
    const packet = fixture.basePacket.replace(/^status: [a-z]+$/m, `status: ${status}`);
    const result = runDispatch(fixture, { packet });
    assert.equal(result.exitCode, 0, status);
    assert.equal(result.payload.status, 'APPROVED', status);
    assert.equal(result.payload.code, 'READY', status);
    assert.equal(result.payload.packet, 'C01', status);
    assert.equal(result.payload.dispatchApproved, true, status);
    assert.equal(result.payload.publicationAuthorized, false, status);
    assert.equal(result.payload.contractSha256, normalizedContractHash(packet), status);
  }
});

test('dispatch rejects missing, duplicate, and invalid frontmatter statuses', t => {
  const fixture = makeFixture(t);
  const cases = [
    ['missing', fixture.basePacket.replace(/^status: [a-z]+\n/m, '')],
    ['duplicate', fixture.basePacket.replace(/^status: [a-z]+$/m, 'status: ready\nstatus: ready')],
    ['attacker-chosen', fixture.basePacket.replace(/^status: [a-z]+$/m, 'status: attacker-chosen')],
    ['uppercase', fixture.basePacket.replace(/^status: [a-z]+$/m, 'status: READY')],
    ['trailing-comment', fixture.basePacket.replace(/^status: [a-z]+$/m, 'status: ready # comment')],
    ['trailing-space', fixture.basePacket.replace(/^status: [a-z]+$/m, 'status: ready ')],
    ['no-frontmatter', fixture.basePacket.replace(/^---\n/, '')],
  ];
  for (const [label, packet] of cases) {
    const result = runDispatch(fixture, { packet });
    assertHeld(result, 'STATUS_INVALID');
    assert.equal(result.payload.packet, 'C01', label);
  }
});

test('dispatch rejects non-status packet changes, including body status-like text and owner changes', t => {
  const fixture = makeFixture(t);
  assert.match(fixture.basePacket, /No automatic tier fallback/);
  const cases = [
    fixture.basePacket.replace('No automatic tier fallback', 'No automatic tier fallback changed'),
    fixture.basePacket.replace('write_owner: opencode', 'write_owner: another-owner'),
    fixture.basePacket.replace('No automatic tier fallback', 'status: ready\nNo automatic tier fallback'),
  ];
  for (const packet of cases) assertHeld(runDispatch(fixture, { packet }));
});

test('dispatch fails closed for wrong hash, unreleased, accepted, and non-C01 ledger rows', t => {
  const fixture = makeFixture(t);
  const mutations = [
    cluster => {
      cluster.packets.find(row => row.id === 'C01').ownerRelease.contractSha256 = '0'.repeat(64);
    },
    cluster => {
      cluster.packets.find(row => row.id === 'C01').state = 'REVIEW';
    },
    cluster => {
      cluster.packets.find(row => row.id === 'C01').implementationAccepted = true;
    },
    cluster => {
      cluster.packets.find(row => row.id === 'C01').ownerRelease.writeOwner = 'claude';
    },
    cluster => {
      cluster.packets.find(row => row.id === 'C01').ownerRelease = null;
    },
  ];
  for (const mutate of mutations) {
    const cluster = clone(fixture.baseCluster);
    mutate(cluster);
    assertHeld(runDispatch(fixture, { cluster }));
  }

  assertHeld(runDispatch(fixture, { id: 'C02' }));
  assertHeld(runDispatch(fixture, { id: 'UNKNOWN_PACKET' }), 'UNKNOWN_PACKET');
});

test('accepted C04 and forged repeat-dispatch states remain HELD',t=>{
  const fixture=makeFixture(t);
  const accepted=clone(fixture.baseCluster);
  assert.equal(accepted.packets[3].state,'NODE_IMPLEMENTATION_ACCEPTED');
  assert.equal(accepted.packets[3].implementationAccepted,true);
  assertHeld(runDispatch(fixture,{id:'C04',cluster:accepted}),'NODE_IMPLEMENTATION_ACCEPTED');
  for(const implemented of [false,true]){
    const forged=clone(accepted),row=forged.packets[3];
    row.state='READY';row.implementationAccepted=implemented;
    row.ownerRelease={writeOwner:'opencode',contractSha256:normalizedContractHash(fixture.packets.get('C04'))};
    row.ownerAcceptance.nativeBuildAccepted=true;row.ownerAcceptance.publicationAuthorized=true;
    assertHeld(runDispatch(fixture,{id:'C04',cluster:forged}),'READY');
  }
});

test('accepted C05 and forged READY states never authorize OpenCode dispatch',t=>{
  const fixture=makeFixture(t),accepted=clone(fixture.baseCluster);
  assert.equal(accepted.packets[4].state,'NODE_IMPLEMENTATION_ACCEPTED');
  assert.equal(accepted.packets[4].implementationAccepted,true);
  assertHeld(runDispatch(fixture,{id:'C05',cluster:accepted}),'NODE_IMPLEMENTATION_ACCEPTED');
  for(const implemented of [false,true]){
    const forged=clone(accepted),row=forged.packets[4];
    row.state='READY';row.implementationAccepted=implemented;
    row.ownerRelease={writeOwner:'opencode',contractSha256:normalizedContractHash(fixture.packets.get('C05'))};
    assertHeld(runDispatch(fixture,{id:'C05',cluster:forged}),'READY');
  }
});

test('C06 owner acceptance and forged release combinations never authorize dispatch',t=>{
  const fixture=makeFixture(t);
  // This is an explicit proposed control state, not a claim that C06 is accepted.
  for(const state of ['OWNER_ACCEPTANCE_REQUIRED','NODE_IMPLEMENTATION_ACCEPTED','READY']){
    for(const implemented of [false,true]){
      const proposed=clone(fixture.baseCluster),row=proposed.packets[5];
      assert.equal(row.id,'C06');
      row.state=state;row.implementationAccepted=implemented;
      row.ownerRelease={writeOwner:'opencode',contractSha256:normalizedContractHash(fixture.packets.get('C06'))};
      const packet=fixture.packets.get('C06').replace(/^status: blocked$/m,'status: ready');
      assertHeld(runDispatch(fixture,{id:'C06',cluster:proposed,packet}),state);
    }
  }
});

test('C07 owner integration does not open an OpenCode dispatch route',t=>{
  const fixture=makeFixture(t);
  for(const state of ['OWNER_ACCEPTANCE_REQUIRED','NODE_IMPLEMENTATION_ACCEPTED','READY']){
    for(const implemented of [false,true]){
      const proposed=clone(fixture.baseCluster),row=proposed.packets[6];
      assert.equal(row.id,'C07');
      row.state=state;row.implementationAccepted=implemented;
      row.ownerRelease={writeOwner:'opencode',contractSha256:normalizedContractHash(fixture.packets.get('C07'))};
      const packet=fixture.packets.get('C07').replace(/^status: blocked$/m,'status: ready');
      assertHeld(runDispatch(fixture,{id:'C07',cluster:proposed,packet}),state);
    }
  }
});
