// PRIVATE operator-exclusive local filesystem, not hostile-writer isolation.
// Resolves only an explicit existing state directory; never creates or chmods it.
import fs from 'node:fs';
import path from 'node:path';
const fail = () => { throw Object.assign(Error('NISI_STATE_DIRECTORY_INVALID'), { code: 'NISI_STATE_DIRECTORY_INVALID' }); };
const within = (parent, child) => { const relative = path.relative(parent, child);
  return relative === '' || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative)); };
export function resolveExternalDemoStateV1(value, sourceRoot) {
  if (typeof value !== 'string' || value.length === 0 || value.length > 4096 || value.includes('\0') || !path.isAbsolute(value)) fail();
  try {
    // Lexically normalize the absolute selection before lstat: a trailing '/'
    // or '/.' must not cause the kernel to follow a final-component symlink.
    const named = path.resolve(value), original = fs.lstatSync(named);
    if (!original.isDirectory() || original.isSymbolicLink()) fail();
    const resolved = fs.realpathSync(named), source = fs.realpathSync(sourceRoot), stat = fs.lstatSync(resolved);
    if (!stat.isDirectory() || stat.isSymbolicLink() || within(source, resolved) || within(resolved, source)) fail();
    // Confidential task/evidence storage requires a private, caller-owned root.
    if ((stat.mode & 0o077) !== 0 || (typeof process.getuid === 'function' && stat.uid !== process.getuid())) fail();
    fs.accessSync(resolved, fs.constants.W_OK | fs.constants.X_OK);
    return Object.freeze({ directory: resolved, dev: String(stat.dev), ino: String(stat.ino) });
  } catch { fail(); }
}
export function recheckExternalDemoStateV1(observation, sourceRoot) {
  const current = resolveExternalDemoStateV1(observation.directory, sourceRoot);
  if (current.dev !== observation.dev || current.ino !== observation.ino || current.directory !== observation.directory) fail();
  return current.directory;
}
