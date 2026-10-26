// PRIVATE local exclusive reservation. This is NOT general durable workflow resume.
// Requires an operator-exclusive, static local parent directory; callers of the
// cooperating reservation protocol never rename/replace its entries. Same-account
// adversarial directory mutation is NOT contained by pathname lstat/unlink checks.
// Caller selects that path, never a candidate-provided path.
// A crash or uncertain cleanup leaves the marker; there is no stale-PID auto-clear.
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { hashBytes } from './protocol.mjs';
const issued = new WeakSet();
const fail = code => { throw Object.assign(new Error(code), { code }); };
function syncDirectory(file) {
  const fd = fs.openSync(path.dirname(file), fs.constants.O_RDONLY | fs.constants.O_DIRECTORY);
  try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
}
export function acquireKernelReservation(file, identity) {
  const contents = Buffer.from(JSON.stringify({ schemaVersion: 1, nonce: randomUUID(),
    ownerPid: process.pid, identity, recovery: 'EXPLICIT_RECONCILIATION_REQUIRED' }) + '\n');
  if (contents.length > 8192) fail('SWIFT_RESERVATION_SIZE');
  let fd = null;
  try {
    fd = fs.openSync(file, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o600);
    const stat = fs.fstatSync(fd, { bigint: true });
    if (!stat.isFile() || stat.nlink !== 1n) fail('SWIFT_RESERVATION_SHAPE');
    let offset = 0;
    while (offset < contents.length) {
      const count = fs.writeSync(fd, contents, offset, contents.length - offset);
      if (count <= 0) fail('SWIFT_RESERVATION_WRITE');
      offset += count;
    }
    fs.fsyncSync(fd);
    const closing = fd; fd = null; fs.closeSync(closing);
    syncDirectory(file);
    const ticket = Object.freeze({ file, dev: String(stat.dev), ino: String(stat.ino),
      sha256: hashBytes(contents), byteLength: contents.length });
    issued.add(ticket);
    return ticket;
  } catch (error) {
    // Never unlink a failed/uncertain acquisition. No executable has started.
    if (fd !== null) { try { fs.closeSync(fd); } catch {} }
    fail(error?.code === 'EEXIST' ? 'SWIFT_RESERVATION_PRESENT' : 'SWIFT_RESERVATION_UNCERTAIN');
  }
}
export function releaseKernelReservation(ticket) {
  if (!issued.has(ticket)) fail('SWIFT_RESERVATION_NOT_ISSUED');
  let fd = null;
  try {
    fd = fs.openSync(ticket.file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
    const stat = fs.fstatSync(fd, { bigint: true });
    if (!stat.isFile() || stat.nlink !== 1n || String(stat.dev) !== ticket.dev || String(stat.ino) !== ticket.ino ||
        stat.size !== BigInt(ticket.byteLength)) fail('SWIFT_RESERVATION_CHANGED');
    const bytes = Buffer.alloc(ticket.byteLength + 1);
    let offset = 0;
    while (offset < bytes.length) {
      const count = fs.readSync(fd, bytes, offset, bytes.length - offset, offset);
      if (count === 0) break;
      offset += count;
    }
    if (offset !== ticket.byteLength || hashBytes(bytes.subarray(0, offset)) !== ticket.sha256) fail('SWIFT_RESERVATION_CHANGED');
    const named = fs.lstatSync(ticket.file, { bigint: true });
    if (String(named.dev) !== ticket.dev || String(named.ino) !== ticket.ino) fail('SWIFT_RESERVATION_CHANGED');
    const closing = fd; fd = null; fs.closeSync(closing);
    fs.unlinkSync(ticket.file); // owned marker under the exclusive-directory precondition
    syncDirectory(ticket.file);
    issued.delete(ticket);
  } catch {
    if (fd !== null) { try { fs.closeSync(fd); } catch {} }
    fail('SWIFT_RESERVATION_RELEASE_UNCERTAIN');
  }
}
