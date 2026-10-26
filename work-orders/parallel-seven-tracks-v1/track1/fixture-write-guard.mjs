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
import ts from 'typescript';
// PRIVATE C05 draft helper. Test-only; never import this from the runner.
// No method below performs a network operation. Every installed replacement
// records a label and throws before reaching the original implementation.
import dgram from 'node:dgram';
import dns from 'node:dns';
import http from 'node:http';
import http2 from 'node:http2';
import https from 'node:https';
import net from 'node:net';
import tls from 'node:tls';

let activeGuard = null;

const failure = (code, detail) => Object.assign(new Error(detail ?? code), { code });
const ownDescriptor = (target, key) => Object.getOwnPropertyDescriptor(target, key);
const descriptorKeys = ['configurable', 'enumerable', 'get', 'set', 'value', 'writable'];

function sameDescriptor(a, b) {
  if (a === undefined || b === undefined) return a === b;
  return descriptorKeys.every(key => a[key] === b[key]);
}

function inheritedDescriptor(target, key) {
  for (let current = Object.getPrototypeOf(target); current !== null; current = Object.getPrototypeOf(current)) {
    const descriptor = Object.getOwnPropertyDescriptor(current, key);
    if (descriptor !== undefined) return descriptor;
  }
  return undefined;
}

function installMethod(target, key, label, restores, deny) {
  if (target === null || target === undefined) throw failure('NETWORK_GUARD_API_MISSING', label);
  const before = ownDescriptor(target, key);
  if (before && !('value' in before)) throw failure('NETWORK_GUARD_DESCRIPTOR_UNSUPPORTED', label);
  const inherited = before === undefined ? inheritedDescriptor(target, key) : before;
  if (!inherited || !('value' in inherited) || typeof inherited.value !== 'function') {
    throw failure('NETWORK_GUARD_API_MISSING', label);
  }

  const replacement = { value: deny(label) };
  if (before) {
    Object.defineProperty(target, key, { ...before, ...replacement });
  } else {
    // Some Node 24 methods (notably TLSSocket.connect) are inherited. An own
    // denial is installed temporarily and close() deletes it, restoring the
    // original inherited/absent shape rather than leaving a shadow property.
    Object.defineProperty(target, key, { value: replacement.value, writable: true, enumerable: false, configurable: true });
  }
  restores.push({ target, key, before });
}

function installFixtureNetworkGuard() {
  if (activeGuard !== null) throw failure('NETWORK_GUARD_NESTED', 'nested network guard installation');

  const attempts = [];
  const restores = [];
  let state = 'OPEN';
  const seen = new Set();
  const deny = label => function guardedNetworkAttempt() {
    attempts.push(label);
    throw failure(`TEST_FORBIDDEN_SIDE_EFFECT:${label}`);
  };
  const patch = (target, key, label, required = true) => {
    const token = `${String(key)}\u0000${label}`;
    if (seen.has(token)) return;
    if (!required) {
      const descriptor = target === null || target === undefined ? undefined
        : ownDescriptor(target, key) ?? inheritedDescriptor(target, key);
      if (!descriptor || !('value' in descriptor) || typeof descriptor.value !== 'function') return;
    }
    installMethod(target, key, label, restores, deny);
    seen.add(token);
  };

  const restoreAll = () => {
    let firstError = null;
    for (const { target, key, before } of [...restores].reverse()) {
      try {
        if (before === undefined) delete target[key];
        else Object.defineProperty(target, key, before);
      } catch (error) { firstError ??= error; }
    }
    for (const { target, key, before } of restores) {
      if (!sameDescriptor(ownDescriptor(target, key), before)) {
        firstError ??= failure('NETWORK_GUARD_RESTORE_FAILED', `${String(key)} descriptor did not restore`);
      }
    }
    try { syncBuiltinESMExports(); } catch (error) { firstError ??= error; }
    if (firstError) {
      // Keep the realm latched. A second guard must never claim clean
      // ownership after a partial restore, even if the original exception was
      // thrown during rollback of a failed installation.
      state = 'RESTORE_FAILED';
      if (activeGuard) activeGuard.restoreError = firstError;
      throw firstError;
    }
    activeGuard = null;
    state = 'CLOSED';
  };

  activeGuard = { attempts, restores };
  try {
    // Required baseline entry points. A missing method is a failed guard
    // installation, never a silent skip.
    patch(globalThis, 'fetch', 'fetch');
    for (const [object, prefix] of [[http, 'http'], [https, 'https']]) {
      patch(object, 'request', `${prefix}.request`);
      patch(object, 'get', `${prefix}.get`);
    }
    patch(net, 'connect', 'net.connect');
    patch(net, 'createConnection', 'net.createConnection');
    patch(net.Socket.prototype, 'connect', 'net.Socket.prototype.connect');
    patch(tls, 'connect', 'tls.connect');
    patch(tls.TLSSocket.prototype, 'connect', 'tls.TLSSocket.prototype.connect');
    patch(dgram, 'createSocket', 'dgram.createSocket');
    patch(dgram.Socket.prototype, 'send', 'dgram.Socket.prototype.send');
    patch(dgram.Socket.prototype, 'sendto', 'dgram.Socket.prototype.sendto');
    patch(dgram.Socket.prototype, 'connect', 'dgram.Socket.prototype.connect');
    patch(http2, 'connect', 'http2.connect');

    const resolveMethods = [
      'resolve', 'resolve4', 'resolve6', 'resolveAny', 'resolveCaa', 'resolveCname',
      'resolveMx', 'resolveNaptr', 'resolveNs', 'resolvePtr', 'resolveSoa',
      'resolveSrv', 'resolveTxt', 'reverse',
    ];
    // Both top-level namespaces require lookup and lookupService as well as
    // the full resolve/reverse family on the supported Node runtime.
    for (const key of ['lookup', 'lookupService', ...resolveMethods]) patch(dns, key, `dns.${key}`);
    for (const key of ['lookup', 'lookupService', ...resolveMethods]) patch(dns.promises, key, `dns.promises.${key}`);
    const resolverPrototypes = [
      [dns.Resolver?.prototype, 'dns.Resolver.prototype'],
      [dns.promises?.Resolver?.prototype, 'dns.promises.Resolver.prototype'],
    ];
    for (const [prototype, prefix] of resolverPrototypes) {
      if (!prototype) throw failure('NETWORK_GUARD_API_MISSING', prefix);
      for (const key of resolveMethods) patch(prototype, key, `${prefix}.${key}`);
    }
    // Additional runtime-present resolve* methods are also guarded, while
    // unexpected missing baseline methods above remain installation failures.
    for (const [object, prefix] of [[dns, 'dns'], [dns.promises, 'dns.promises']]) {
      for (const key of Object.getOwnPropertyNames(object)) {
        if (/^resolve/.test(key)) patch(object, key, `${prefix}.${key}`, false);
      }
    }
    for (const [prototype, prefix] of resolverPrototypes) {
      for (const key of Object.getOwnPropertyNames(prototype)) {
        if (/^resolve/.test(key)) patch(prototype, key, `${prefix}.${key}`, false);
      }
    }
    syncBuiltinESMExports();
  } catch (error) {
    try { restoreAll(); } catch (rollbackError) { error.rollbackError = rollbackError; }
    throw error;
  }

  const guard = {
    attempts,
    close() {
      if (state === 'CLOSED') return;
      restoreAll();
    },
    assertClean() {
      if (state !== 'CLOSED' || activeGuard !== null) throw failure('NETWORK_GUARD_NOT_CLOSED');
      for (const { target, key, before } of restores) {
        if (!sameDescriptor(ownDescriptor(target, key), before)) {
          throw failure('NETWORK_GUARD_RESTORE_FAILED', `${String(key)} was not restored`);
        }
      }
    },
  };
  return Object.freeze(guard);
}

export { installFixtureNetworkGuard };

// Direct-source regression scanner, not an evaluator or a JavaScript sandbox.
// This allowlist is independent of the literal expectation in the oracle.
const fixtureImports = new Set([
  'node:events', 'node:crypto', 'node:util', 'node:fs/promises', 'node:path',
  '../../../examples/repository-task/reviewed-live-fixture-v1.mjs',
  '../../../hosts/repository/reviewed-workflow-v1.mjs',
  '../../../hosts/repository/snapshot-contract.mjs',
  '../../../hosts/repository/node-executor-v1.mjs',
  '../../../hosts/repository/task-workspace-v1.mjs',
  '../../../hosts/swift-verifier/check-plan-v1.mjs',
  '../../../receipts/swift-static-group-v1.mjs',
  '../../../receipts/repository-run-v1.mjs',
  '../../../hosts/swift-verifier/protocol.mjs',
]);

export function inspectFixtureModuleSurfaceV1(source) {
  const result = { parseErrors: [], imports: [], violations: [] };
  if (typeof source !== 'string') {
    result.violations.push({ kind: 'SOURCE_TYPE', start: 0 });
    return result;
  }
  if (Buffer.byteLength(source, 'utf8') > 1_048_576) {
    result.violations.push({ kind: 'SOURCE_TOO_LARGE', start: 0 });
    return result;
  }
  const tree = ts.createSourceFile('fixture.mjs', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  result.parseErrors = tree.parseDiagnostics.map(diagnostic => ({
    code: diagnostic.code, start: diagnostic.start ?? 0,
    message: ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'),
  }));
  // Never count malformed syntax as successful detection of a semantic mutant.
  if (result.parseErrors.length) return result;
  const unwrap = node => {
    while (node && ts.isParenthesizedExpression(node)) node = node.expression;
    return node;
  };
  const identifier = (node, name) => ts.isIdentifier(unwrap(node)) && unwrap(node).text === name;
  const property = node => {
    node = unwrap(node);
    if (ts.isPropertyAccessExpression(node)) return node.name.text;
    if (ts.isElementAccessExpression(node)) {
      const key = node.argumentExpression;
      if (key && (ts.isStringLiteral(key) || ts.isNoSubstitutionTemplateLiteral(key))) return key.text;
    }
    return null;
  };
  const processMethods = new Set(['binding', '_linkedBinding', 'getBuiltinModule']);
  const processObject = node => identifier(node, 'process') ||
    (property(node) === 'process' && ['globalThis', 'global'].some(name => identifier(unwrap(node).expression, name)));
  const add = (kind, node) => result.violations.push({ kind, start: node.getStart(tree) });
  function visit(node) {
    if (ts.isImportDeclaration(node)) {
      const specifier = node.moduleSpecifier;
      if (!ts.isStringLiteral(specifier)) add('EXTRA_IMPORT', node);
      else {
        result.imports.push(specifier.text);
        if (!fixtureImports.has(specifier.text)) add('EXTRA_IMPORT', node);
      }
    }
    if (ts.isExportDeclaration(node) && node.moduleSpecifier) add('MODULE_REEXPORT', node);
    if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) add('REQUIRE_CALL', node);
    if (ts.isImportSpecifier(node) && (node.propertyName ?? node.name).text === 'createRequire') add('CREATE_REQUIRE', node);
    if (ts.isCallExpression(node)) {
      const callee = unwrap(node.expression), key = property(callee);
      if (callee.kind === ts.SyntaxKind.ImportKeyword) add('DYNAMIC_IMPORT', node);
      if (identifier(callee, 'require') || (key === 'require' &&
          ['module', 'globalThis', 'global'].some(name => identifier(callee.expression, name)))) add('REQUIRE_CALL', node);
      if (identifier(callee, 'createRequire') || key === 'createRequire') add('CREATE_REQUIRE', node);
    }
    if ((ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) &&
        processObject(node.expression) && processMethods.has(property(node))) add('PROCESS_BINDING', node);
    if (ts.isVariableDeclaration(node) && node.initializer && processObject(node.initializer) && ts.isObjectBindingPattern(node.name)) {
      for (const entry of node.name.elements) {
        const key = entry.propertyName ?? entry.name;
        if ((ts.isIdentifier(key) || ts.isStringLiteral(key)) && processMethods.has(key.text)) add('PROCESS_BINDING', entry);
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(tree);
  return result;
}

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
