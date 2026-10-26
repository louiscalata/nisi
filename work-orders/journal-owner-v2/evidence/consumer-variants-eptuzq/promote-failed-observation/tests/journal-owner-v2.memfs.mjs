// Deterministic in-memory fs double exposing exactly the sync methods the
// store uses, with per-call fault injection. Test helper only; not a product file.
import { createHash } from 'node:crypto';
export const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');
export function memfs(faults = {}) {
  const files = new Map();     // path -> Buffer
  const fds = new Map();       // fd -> { path, flags, pos }
  let next = 3;
  const events = [];
  const enoent = (p) => Object.assign(new Error(`ENOENT: ${p}`), { code: 'ENOENT' });
  const eexist = (p) => Object.assign(new Error(`EEXIST: ${p}`), { code: 'EEXIST' });
  const maybe = (name, args) => { events.push({ name, args }); const f = faults[name]; if (typeof f === 'function') { const e = f(args, events.length); if (e) throw e; } };
  const fs = {
    readFileSync(p) { maybe('readFileSync', [p]); if (!files.has(p)) throw enoent(p); return Buffer.from(files.get(p)); },
    openSync(p, flags, mode) { maybe('openSync', [p, flags, mode]); if (flags === 'wx') { if (files.has(p)) throw eexist(p); files.set(p, Buffer.alloc(0)); } else if (flags === 'r') { if (!files.has(p) && !p.endsWith('/') && !dirs.has(p)) throw enoent(p); } const fd = next++; fds.set(fd, { path: p, flags, pos: 0 }); return fd; },
    writeSync(fd, buf, off, len) { maybe('writeSync', [fd, len]); const h = fds.get(fd); const chunk = buf.subarray(off, off + len); files.set(h.path, Buffer.concat([files.get(h.path), chunk])); return len; },
    fsyncSync(fd) { maybe('fsyncSync', [fd, fds.get(fd)?.path]); },
    closeSync(fd) { maybe('closeSync', [fd, fds.get(fd)?.path]); if (!fds.has(fd)) throw Object.assign(new Error('EBADF'), { code: 'EBADF' }); fds.delete(fd); },
    renameSync(a, b) { maybe('renameSync', [a, b]); if (!files.has(a)) throw enoent(a); files.set(b, files.get(a)); files.delete(a); },
    unlinkSync(p) { maybe('unlinkSync', [p]); if (!files.has(p)) throw enoent(p); files.delete(p); }
  };
  const dirs = new Set(['/j', '/j/']);
  return { fs, files, fds, events, seed(p, bytes) { files.set(p, Buffer.from(bytes)); }, bytes(p) { return files.get(p); }, names() { return [...files.keys()].sort(); } };
}
