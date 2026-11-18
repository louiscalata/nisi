// SPDX-License-Identifier: Apache-2.0
// A tiny Windows path model; this is not native Windows filesystem execution.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { win32 } from 'node:path';

// Actual module text is loaded with only its node:path binding changed. The store
// needs the same binding for its directory-open and rename path calculations.
// Journal parsing and all anchor/store algorithms remain the production text.
const dataModule = text => 'data:text/javascript;base64,' + Buffer.from(text).toString('base64');
export async function loadAnchorWithPaths(flavor, anchorSource, historyUrl = new URL('../../history/', import.meta.url)) {
  assert.ok(['posix', 'win32'].includes(flavor));
  const journalUrl = new URL('run-journal-v1.mjs', historyUrl).href;
  const storeUrl = new URL('run-journal-store-v1.mjs', historyUrl);
  let store = readFileSync(storeUrl, 'utf8');
  const storeImport = "import { dirname, sep } from 'node:path';";
  assert.equal(store.split(storeImport).length, 2, 'store path import occurs once');
  store = store.replace(storeImport, `import { ${flavor} } from 'node:path'; const { dirname, sep } = ${flavor};`)
    .replace("'./run-journal-v1.mjs'", JSON.stringify(journalUrl));
  let source = anchorSource ?? readFileSync(new URL('run-journal-anchor-v1.mjs', historyUrl), 'utf8');
  const pathImport = "import { basename, dirname, isAbsolute, parse, relative, resolve, sep } from 'node:path';";
  assert.equal(source.split(pathImport).length, 2, 'anchor path import occurs once');
  source = source.replace(pathImport,
    `import { ${flavor} } from 'node:path'; const { basename, dirname, isAbsolute, parse, relative, resolve, sep } = ${flavor};`)
    .replace("'./run-journal-v1.mjs'", JSON.stringify(journalUrl))
    .replace("'./run-journal-store-v1.mjs'", JSON.stringify(dataModule(store)));
  return import(dataModule(source));
}

export const loadWindowsAnchor = (source, historyUrl) => loadAnchorWithPaths('win32', source, historyUrl);

const failure = code => Object.assign(new Error('synthetic filesystem refusal'), { code });
const keyOf = path => win32.normalize(path).toLowerCase();

export function windowsFixture({ realpath = 'absent', readlink = 'present', stat = 'present' } = {}) {
  const nodes = new Map();
  const handles = new Map();
  const calls = [];
  const writes = [];
  let nextFd = 10;
  let nextIno = 2n ** 60n;
  const root = 'C:\\fixture';
  const journalDir = root + '\\journal';
  const anchorDir = root + '\\anchor';
  const journalPath = journalDir + '\\journal.jsonl';
  const record = (name, path, extra = {}) => calls.push({ name, path, ...extra });
  const add = (path, node) => {
    const normalized = win32.normalize(path);
    const value = { path: normalized, dev: 7n, ino: ++nextIno, ...node };
    nodes.set(keyOf(normalized), value);
    return value;
  };
  const directory = (path, identity = {}) => add(path, { kind: 'directory', ...identity });
  const link = (path, target) => add(path, { kind: 'link', target });
  const file = (path, bytes) => add(path, { kind: 'file', bytes: Buffer.from(bytes) });
  directory('C:\\');
  directory(root);
  directory(journalDir);
  directory(anchorDir);

  // This oracle deliberately differs from the production component walker:
  // normalize the complete syscall argument FIRST, then replace the first link
  // prefix by its target and recurse. Thus alias\\. and alias\\.. demonstrate
  // Windows normalization even though the host running this model is POSIX.
  const lookup = (input, followFinal = true, seen = new Set()) => {
    const normalized = win32.normalize(input);
    if (!win32.isAbsolute(normalized)) throw failure('EINVAL');
    const rootPart = win32.parse(normalized).root;
    const parts = normalized.slice(rootPart.length).split('\\').filter(Boolean);
    let prefix = rootPart;
    for (let index = 0; index < parts.length; index++) {
      prefix = win32.join(prefix, parts[index]);
      const node = nodes.get(keyOf(prefix));
      if (!node) throw failure('ENOENT');
      const final = index === parts.length - 1;
      if (node.kind === 'link' && (!final || followFinal)) {
        const identity = keyOf(node.path);
        if (seen.has(identity) || seen.size >= 64) throw failure('ELOOP');
        const nextSeen = new Set(seen).add(identity);
        const target = win32.resolve(win32.dirname(node.path), node.target);
        const rest = parts.slice(index + 1).join('\\');
        return lookup(rest ? win32.join(target, rest) : target, followFinal, nextSeen);
      }
      if (!final && node.kind !== 'directory') throw failure('ENOTDIR');
    }
    const node = nodes.get(keyOf(prefix));
    if (!node) throw failure('ENOENT');
    return node;
  };
  const shape = (node, options) => ({
    dev: options?.bigint ? BigInt(node.dev) : Number(node.dev),
    ino: options?.bigint ? BigInt(node.ino) : Number(node.ino),
    size: node.kind === 'file' ? node.bytes.length : 0,
    isDirectory: () => node.kind === 'directory',
    isSymbolicLink: () => node.kind === 'link',
    isFile: () => node.kind === 'file',
  });
  const descriptor = fd => {
    const handle = handles.get(fd);
    if (!handle) throw failure('EBADF');
    return handle;
  };
  const createPath = path => {
    const parent = lookup(win32.dirname(path));
    if (parent.kind !== 'directory') throw failure('ENOTDIR');
    return win32.join(parent.path, win32.basename(path));
  };
  const fs = {
    constants: { O_RDONLY: 0, O_NONBLOCK: 0 },
    lstatSync(path, options) {
      record('lstatSync', path, { bigint: options?.bigint });
      return shape(lookup(path, false), options);
    },
    openSync(path, flags) {
      record('openSync', path, { flags });
      let node;
      if (flags === 'wx') {
        const target = createPath(path);
        if (nodes.has(keyOf(target))) throw failure('EEXIST');
        writes.push({ name: 'openSync', path });
        node = file(target, Buffer.alloc(0));
      } else node = lookup(path);
      const fd = nextFd++;
      handles.set(fd, { node, path, offset: 0 });
      return fd;
    },
    fstatSync(fd, options) {
      const held = descriptor(fd);
      record('fstatSync', held.path);
      return shape(held.node, options);
    },
    readSync(fd, buffer, offset, length, position) {
      const held = descriptor(fd);
      record('readSync', held.path);
      if (held.node.kind !== 'file') throw failure('EISDIR');
      const start = position ?? held.offset;
      const count = held.node.bytes.copy(buffer, offset, start, start + length);
      if (position == null) held.offset += count;
      return count;
    },
    writeSync(fd, buffer, offset, length, position) {
      const held = descriptor(fd);
      record('writeSync', held.path);
      if (held.node.kind !== 'file') throw failure('EISDIR');
      const start = position ?? held.offset;
      const bytes = Buffer.alloc(Math.max(held.node.bytes.length, start + length));
      held.node.bytes.copy(bytes);
      buffer.copy(bytes, start, offset, offset + length);
      held.node.bytes = bytes;
      if (position == null) held.offset += length;
      writes.push({ name: 'writeSync', path: held.path });
      return length;
    },
    closeSync(fd) { record('closeSync', descriptor(fd).path); handles.delete(fd); },
    fsyncSync(fd) { record('fsyncSync', descriptor(fd).path); },
    readFileSync(path) {
      record('readFileSync', path);
      const node = lookup(path);
      if (node.kind !== 'file') throw failure('EISDIR');
      return Buffer.from(node.bytes);
    },
    renameSync(from, to) {
      record('renameSync', from, { to });
      const node = lookup(from, false);
      const target = createPath(to);
      writes.push({ name: 'renameSync', path: from, to });
      nodes.delete(keyOf(node.path));
      node.path = target;
      nodes.set(keyOf(target), node);
    },
    unlinkSync(path) {
      record('unlinkSync', path);
      const node = lookup(path, false);
      if (node.kind === 'directory') throw failure('EISDIR');
      writes.push({ name: 'unlinkSync', path });
      nodes.delete(keyOf(node.path));
    },
  };
  if (realpath !== 'absent') fs.realpathSync = path => {
    record('realpathSync', path);
    if (realpath === 'throws') throw failure('EIO');
    return lookup(path).path;
  };
  if (readlink !== 'absent') fs.readlinkSync = path => {
    record('readlinkSync', path);
    if (readlink === 'throws') throw failure('EIO');
    const node = lookup(path, false);
    if (node.kind !== 'link') throw failure('EINVAL');
    return node.target;
  };
  if (stat !== 'absent') fs.statSync = (path, options) => {
    record('statSync', path, { bigint: options?.bigint });
    if (stat === 'throws') throw failure('EIO');
    return shape(lookup(path), options);
  };
  return {
    fs, root, journalDir, anchorDir, journalPath, directory, link, file, calls, writes,
    options: { fs, journalPath, anchorDir, key: 'synthetic-host-key', sleep: () => {} },
    snapshot: () => [...nodes].map(([name, node]) => [name, node.kind,
      node.kind === 'file' ? node.bytes.toString('hex') : node.target ?? '', String(node.dev), String(node.ino)]),
    openDescriptors: () => handles.size,
  };
}
