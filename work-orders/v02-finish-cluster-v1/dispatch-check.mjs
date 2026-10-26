// Staging latch, intentionally non-authorizing by default. Do not replace during a packet.
// Owner release 2026-09-18: C01 dispatch is approved ONLY while the row is READY,
// implementationAccepted is false, an ownerRelease record exists, and the live
// contract bytes hash to ownerRelease.contractSha256. Any other packet stays HELD.
// The executor cannot edit these files (not in any packet's allowedFiles), and
// packet-run's receipt still derives status from the real exit code of this command.
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const cluster = JSON.parse(readFileSync(new URL('./cluster.json', import.meta.url), 'utf8'));
const id = process.argv[2];
const row = cluster.packets.find(p => p.id === id);
const contract = row ? readFileSync(new URL('../../' + row.packet, import.meta.url), 'utf8') : null;
// packet-run rewrites only the frontmatter status line (ready -> executing -> done|blocked);
// the frozen contract is every other byte. Exactly one status line holding one of those four
// states is normalized to `ready` before hashing; any other status value keeps the row HELD.
const RUNNER_STATES = new Set(['ready', 'executing', 'done', 'blocked']);
const front = contract ? contract.match(/^---\n([\s\S]*?)\n---\n/) : null;
const statusLines = front ? front[1].split('\n').filter(line => line.startsWith('status:')) : [];
const statusValid = statusLines.length === 1 && /^status: [a-z]+$/.test(statusLines[0]) &&
  RUNNER_STATES.has(statusLines[0].slice('status: '.length));
const liveSha = statusValid ? createHash('sha256').update(
  contract.replace(front[0], front[0].replace(statusLines[0], 'status: ready'))).digest('hex') : null;
const approved = statusValid && id === 'C01' && row?.state === 'READY' &&
  row.implementationAccepted === false && row.ownerRelease &&
  row.ownerRelease.contractSha256 === liveSha &&
  row.ownerRelease.writeOwner === 'opencode';
if (approved) {
  console.error(JSON.stringify({status:'APPROVED', code:'READY', packet:id,
    dispatchApproved:true, publicationAuthorized:false, contractSha256:liveSha,
    reason:'Owner released the frozen C01 contract (2026-09-18).'}));
  process.exitCode = 0;
} else {
  console.error(JSON.stringify({status:'HELD', code:!row ? 'UNKNOWN_PACKET' : !statusValid ? 'STATUS_INVALID' : row.state,
    packet:id ?? null, dispatchApproved:false, publicationAuthorized:false,
    reason:row?.implementationAccepted === true
      ? 'Implementation already accepted in its recorded scope; repeat dispatch is closed. Native and release acceptance remain separate.'
      : 'Owner must freeze the contract, oracle, source revision and write ownership before dispatch.'}));
  process.exitCode = 2;
}
