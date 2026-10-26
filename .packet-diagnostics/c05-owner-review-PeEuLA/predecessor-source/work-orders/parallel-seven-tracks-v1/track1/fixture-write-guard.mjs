// Test-only regression oracle for the inert fixture runner. Not an OS sandbox.
// Trusted serial tests must await their operations and close handles before
// restoring this guard. Native syscalls, hostile concurrent filesystem changes
// and handles/functions captured before installation are outside its boundary.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { syncBuiltinESMExports } from 'node:module';
import { randomUUID } from 'node:crypto';

let installed = false;
const mutators = ['writeFile', 'appendFile', 'mkdir', 'mkdtemp', 'rm', 'rmdir',
  'unlink', 'rename', 'copyFile', 'cp', 'link', 'symlink', 'chmod', 'lchmod',
  'chown', 'lchown', 'utimes', 'lutimes', 'truncate'];
const twoPaths = new Set(['rename', 'copyFile', 'cp', 'link']);
const rootMetadata = new Set(['chmod', 'lchmod', 'chown', 'lchown', 'utimes', 'lutimes', 'rm', 'rmdir']);
const fdMutators = ['write', 'writev', 'ftruncate', 'fchmod', 'fchown', 'futimes', 'fsync', 'fdatasync'];

export async function installFixtureWriteGuard({ parentRoot, profileAccepted = true }) {
  if (installed) throw Object.assign(new Error('FIXTURE_GUARD_ALREADY_INSTALLED'), { code: 'FIXTURE_GUARD_ALREADY_INSTALLED' });
  // Node's JavaScript realpathSync normalizes dot segments before traversing
  // links. The native resolver preserves the kernel's symlink/.. semantics.
  const realpath = fs.realpathSync.native.bind(fs.realpathSync), lstat = fs.lstatSync.bind(fs);
  const cwd = process.cwd(), parent = realpath(parentRoot);
  if (!lstat(parent).isDirectory()) throw new Error('FIXTURE_GUARD_PARENT_REQUIRED');
  // Node lazily loads rimraf and captures fs callbacks. Initialize that module
  // before patching, otherwise a later test can inherit a CLOSED guard through
  // an internal cached callback. The target must be absent in this test parent;
  // no user file is removed and no temporary-directory inventory is performed.
  const absent = path.join(parent, `.guard-prime-${randomUUID()}`);
  try { lstat(absent); throw new Error('FIXTURE_GUARD_PRIME_TARGET_EXISTS'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  installed = true;
  try { await fsp.rm(absent, { recursive: true, force: true }); }
  catch (error) { installed = false; throw error; }
  const template = path.join(parent, 'nisi-fixture-');
  const restores = [], writes = [], forbidden = [], allocations = [], descriptors = new Map(), handles = new WeakMap();
  let state = 'PREVALIDATION', ownedRoot = null, identity = null;
  installed = true;

  function deny(label) {
    forbidden.push(label);
    throw Object.assign(new Error(`TEST_FORBIDDEN_SIDE_EFFECT:${label}`), { code: `TEST_FORBIDDEN_SIDE_EFFECT:${label}` });
  }
  function replace(object, key, value) {
    const descriptor = Object.getOwnPropertyDescriptor(object, key);
    if (descriptor && !('value' in descriptor)) return;
    if (!descriptor && typeof object[key] !== 'function') return;
    restores.push(() => descriptor ? Object.defineProperty(object, key, descriptor) : delete object[key]);
    Object.defineProperty(object, key, descriptor ? { ...descriptor, value } : { value, configurable: true, writable: true });
  }
  function rawPath(value) {
    let text;
    if (typeof value === 'string') text = value;
    else if (value instanceof URL) text = fileURLToPath(value);
    else if (Buffer.isBuffer(value)) {
      text = value.toString('utf8');
      if (!Buffer.from(text).equals(value)) return deny('non-UTF8 path');
    } else return deny('unsupported path type');
    if (!text || text.includes('\0')) return deny('invalid path');
    return path.isAbsolute(text) ? text : `${cwd}${path.sep}${text}`;
  }
  const inside = value => value === ownedRoot || value.startsWith(`${ownedRoot}${path.sep}`);
  function checkIdentity() {
    if (state !== 'ALLOCATED') return deny(`writes before allocation:${state}`);
    const stat = lstat(ownedRoot);
    if (!stat.isDirectory() || stat.isSymbolicLink() || stat.dev !== identity.dev || stat.ino !== identity.ino ||
        realpath(ownedRoot) !== ownedRoot) return deny('owned root identity changed');
  }
  function resolveTarget(value, allowRoot = false) {
    checkIdentity();
    const raw = rawPath(value);
    // Preserve filesystem traversal semantics. In particular, path.resolve()
    // before realpath() would erase the meaning of a symlink followed by '..'.
    let prefix = raw;
    const missing = [];
    let existing;
    for (;;) {
      try { existing = realpath(prefix); break; }
      catch (error) {
        if (error.code !== 'ENOENT') throw error;
        const separator = prefix.lastIndexOf(path.sep);
        if (separator < 0 || prefix === path.parse(prefix).root) throw error;
        missing.unshift(prefix.slice(separator + 1));
        prefix = prefix.slice(0, separator) || path.sep;
      }
    }
    if (missing.some(part => part === '.' || part === '..')) return deny('unresolved dot traversal');
    if (!inside(existing)) return deny('ancestor outside owned root');
    if (missing.length && !lstat(existing).isDirectory()) return deny('non-directory ancestor');
    const resolved = path.join(existing, ...missing);
    if (!inside(resolved) || (!allowRoot && resolved === ownedRoot)) return deny('target outside owned descendants');
    try { if (lstat(raw).isSymbolicLink()) return deny('final symlink'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    return resolved;
  }
  function checkDescriptor(value) {
    const entry = typeof value === 'number' ? descriptors.get(value) : handles.get(value);
    if (!entry?.writable) return deny('unknown or readonly descriptor mutation');
    resolveTarget(entry.target);
  }
  function checkWrite(name, args, label) {
    const target = args[0];
    writes.push([label, typeof target === 'number' ? target : typeof target === 'string' ? target : '<path-or-handle>',
      ...(twoPaths.has(name) || name === 'symlink' ? [args[1]] : [])]);
    if (typeof target === 'number' || (target && typeof target === 'object' && handles.has(target))) {
      if (name !== 'writeFile' && name !== 'appendFile' && name !== 'truncate') return deny('descriptor not supported here');
      checkDescriptor(target); return;
    }
    if (name === 'symlink') {
      const link = resolveTarget(args[1]);
      // A relative symlink target is interpreted from the link directory.
      const targetText = typeof target === 'string' ? target : Buffer.isBuffer(target) ? target.toString('utf8') : null;
      if (targetText === null) return deny('unsupported symlink target');
      resolveTarget(path.isAbsolute(targetText) ? targetText : `${path.dirname(link)}${path.sep}${targetText}`);
      return;
    }
    resolveTarget(target, rootMetadata.has(name));
    if (twoPaths.has(name)) resolveTarget(args[1]);
  }
  function recordDescendant(result) {
    const raw = rawPath(result), resolved = resolveTarget(raw), stat = lstat(raw);
    if (!stat.isDirectory() || stat.isSymbolicLink() || raw !== resolved) return deny('invalid descendant allocation');
    allocations.push(Object.freeze({ path: resolved, dev: stat.dev, ino: stat.ino }));
    return result;
  }
  function writeFlags(flags) {
    if (typeof flags === 'number' && Number.isInteger(flags)) {
      return (flags & (fs.constants.O_WRONLY | fs.constants.O_RDWR | fs.constants.O_CREAT |
        fs.constants.O_TRUNC | fs.constants.O_APPEND)) !== 0;
    }
    if (typeof flags !== 'string') return deny('unsupported open flags');
    if (flags === 'r' || flags === 'rs' || flags === 'sr') return false;
    if (/^(?:r[+]|rs[+]|sr[+]|[wa]x?[+]?|x[wa][+]?|as[+]?|sa[+]?)$/.test(flags)) return true;
    return deny('unsupported open flags');
  }
  function checkOpen(target, flags, label) {
    const writable = writeFlags(flags);
    if (writable) { writes.push([label, target]); resolveTarget(target); }
    return { target: rawPath(target), writable };
  }
  function wrapHandle(handle, entry) {
    descriptors.set(handle.fd, entry); handles.set(handle, entry);
    for (const name of ['write', 'writev', 'writeFile', 'appendFile', 'truncate', 'chmod', 'chown', 'utimes', 'sync', 'datasync']) {
      const original = handle[name];
      if (typeof original !== 'function') continue;
      replace(handle, name, async function (...args) {
        writes.push([`FileHandle.${name}`, entry.target]); checkDescriptor(handle);
        return original.apply(this, args);
      });
    }
    if (typeof handle.createWriteStream === 'function') replace(handle, 'createWriteStream', () => {
      writes.push(['FileHandle.createWriteStream', entry.target]); return deny('FileHandle.createWriteStream unsupported');
    });
    const originalClose = handle.close, fd = handle.fd;
    replace(handle, 'close', async function (...args) {
      const result = await originalClose.apply(this, args);
      descriptors.delete(fd); handles.delete(handle); return result;
    });
    return handle;
  }
  function close() {
    if (state === 'CLOSED') return;
    state = 'CLOSED';
    try { for (const restore of restores.reverse()) restore(); }
    finally { installed = false; syncBuiltinESMExports(); }
  }
  try {
    for (const name of mutators) {
      if (typeof fsp[name] === 'function') {
        const original = fsp[name];
        replace(fsp, name, async function (...args) {
          if (name === 'mkdtemp' && state === 'READY') {
            writes.push(['fsp.mkdtemp', args[0]]);
            if (rawPath(args[0]) !== template) return deny('unexpected fixture allocation template');
            state = 'ALLOCATING';
            const result = await original.apply(this, args);
            const returned = rawPath(result), stat = lstat(returned), physical = realpath(returned);
            if (state === 'CLOSED') return deny('allocation completed after close');
            if (!stat.isDirectory() || stat.isSymbolicLink() || returned !== physical ||
                path.dirname(physical) !== parent || !path.basename(physical).startsWith('nisi-fixture-')) {
              return deny('invalid allocated root');
            }
            ownedRoot = physical; identity = { dev: stat.dev, ino: stat.ino }; state = 'ALLOCATED';
            allocations.push(Object.freeze({ path: physical, ...identity }));
            return result;
          }
          checkWrite(name, args, `fsp.${name}`);
          const result = await original.apply(this, args);
          return name === 'mkdtemp' ? recordDescendant(result) : result;
        });
      }
      for (const suffix of ['', 'Sync']) {
        const key = name + suffix, original = fs[key];
        if (typeof original !== 'function') continue;
        replace(fs, key, function (...args) {
          checkWrite(name, args, `fs.${key}`);
          if (name !== 'mkdtemp') return original.apply(this, args);
          if (suffix) return recordDescendant(original.apply(this, args));
          const callback = args.pop();
          if (typeof callback !== 'function') throw new TypeError('mkdtemp callback required');
          return original.call(this, ...args, (error, result) => {
            if (error) return callback(error);
            try { recordDescendant(result); } catch (failure) { return callback(failure); }
            callback(null, result);
          });
        });
      }
    }
    const promiseOpen = fsp.open;
    replace(fsp, 'open', async function (target, flags, ...rest) {
      const entry = checkOpen(target, flags, 'fsp.open');
      return wrapHandle(await promiseOpen.call(this, target, flags, ...rest), entry);
    });
    const syncOpen = fs.openSync;
    replace(fs, 'openSync', function (target, flags, ...rest) {
      const entry = checkOpen(target, flags, 'fs.openSync');
      const fd = syncOpen.call(this, target, flags, ...rest); descriptors.set(fd, entry); return fd;
    });
    const callbackOpen = fs.open;
    replace(fs, 'open', function (target, flags, ...rest) {
      const entry = checkOpen(target, flags, 'fs.open');
      const callback = rest.pop();
      if (typeof callback !== 'function') throw new TypeError('open callback required');
      return callbackOpen.call(this, target, flags, ...rest, (error, fd) => {
        if (!error) descriptors.set(fd, entry); callback(error, fd);
      });
    });
    for (const name of fdMutators) for (const suffix of ['', 'Sync']) {
      const key = name + suffix, original = fs[key];
      if (typeof original !== 'function') continue;
      replace(fs, key, function (fd, ...rest) {
        writes.push([`fs.${key}`, fd]); checkDescriptor(fd); return original.call(this, fd, ...rest);
      });
    }
    const syncClose = fs.closeSync, callbackClose = fs.close;
    replace(fs, 'closeSync', function (fd) { const result = syncClose.call(this, fd); descriptors.delete(fd); return result; });
    replace(fs, 'close', function (fd, callback) {
      return callbackClose.call(this, fd, error => { if (!error) descriptors.delete(fd); callback(error); });
    });
    replace(fs, 'createWriteStream', target => {
      writes.push(['fs.createWriteStream', target]); return deny('fs.createWriteStream unsupported');
    });
    syncBuiltinESMExports();
  } catch (error) { close(); throw error; }

  return Object.freeze({
    writes, forbidden, allocations,
    get ownedRoot() { return ownedRoot; },
    get state() { return state; },
    markReady() {
      if (state === 'CLOSED') return false;
      if (!profileAccepted) return deny('profile not accepted');
      if (state === 'READY') return true;
      if (state !== 'PREVALIDATION') return deny('late readiness');
      state = 'READY'; return true;
    },
    close,
    assertClean() { assert.deepEqual(forbidden, [], 'fixture attempted forbidden filesystem side effects'); },
  });
}
