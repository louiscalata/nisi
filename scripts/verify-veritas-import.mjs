// Private integration tooling. Drift detection, not a security or release attestation.
import { createHash } from 'node:crypto';
import { lstatSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const roots = ['.npmrc', 'native/macos', 'package-lock.json', 'package.json', 'tooling', 'veritas.ts'];
const directoryRoots = ['native/macos', 'tooling'];
const ignored = name => name.startsWith('.') || ['node_modules', 'DerivedData'].includes(name) || name.endsWith('.xcresult');
const fail = code => { throw new Error(code); };
const exact = (value, keys, code) => {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).sort().join('\0') !== [...keys].sort().join('\0')) fail(code);
};
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

// root and its ancestors must be stable, trusted host paths. This is not an
// atomic snapshot or an adversarial filesystem sandbox. Symlinks within the
// included source are refused. Excluded paths are inventoried, never traversed.
export function inspectImportedTree(root) {
  const files = [], excluded = [];
  let total = 0;
  const walk = relative => {
    const full = path.join(root, relative);
    const stat = lstatSync(full);
    if (stat.isSymbolicLink()) fail('IMPORT_SYMLINK');
    if (stat.isDirectory()) {
      for (const name of readdirSync(full).sort()) {
        const next = `${relative}/${name}`;
        if (ignored(name)) excluded.push(next);
        else walk(next);
      }
    } else {
      if (!stat.isFile()) fail('IMPORT_NOT_REGULAR');
      if (stat.size > 16 * 1024 * 1024 || total + stat.size > 128 * 1024 * 1024) fail('IMPORT_BYTE_LIMIT');
      const bytes = readFileSync(full);
      if (bytes.length !== stat.size) fail('IMPORT_CHANGED_DURING_READ');
      total += bytes.length;
      files.push({ path: relative, bytes: bytes.length, sha256: sha256(bytes) });
    }
  };
  for (const relative of roots) walk(relative);
  files.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  return { files, excluded: excluded.sort() };
}

export function verifyImportedTree(root, manifest) {
  exact(manifest, ['schemaVersion', 'purpose', 'frozenAt', 'source', 'roots', 'exclusionPolicy', 'files'], 'IMPORT_MANIFEST_SCHEMA');
  if (manifest.schemaVersion !== 1 || manifest.purpose !== 'PRIVATE_VERITAS_SOURCE_FREEZE') fail('IMPORT_MANIFEST_VERSION');
  if (typeof manifest.frozenAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(manifest.frozenAt) || !Number.isFinite(Date.parse(manifest.frozenAt))) fail('IMPORT_MANIFEST_DATE');
  exact(manifest.source, ['root', 'head', 'treeState', 'comparison'], 'IMPORT_SOURCE_SCHEMA');
  if (typeof manifest.source.root !== 'string' || !path.isAbsolute(manifest.source.root) ||
      typeof manifest.source.head !== 'string' || !/^[0-9a-f]{40}$/u.test(manifest.source.head) ||
      manifest.source.treeState !== 'DIRTY_INCLUDING_UNTRACKED_SOURCE' ||
      manifest.source.comparison !== 'EACH_INCLUDED_FILE_BYTE_MATCHED_AT_FREEZE') fail('IMPORT_SOURCE_INVALID');
  if (JSON.stringify(manifest.roots) !== JSON.stringify(roots) ||
      manifest.exclusionPolicy !== 'explicit-root-files; subtree-exclusions:hidden-entries,node_modules,DerivedData,*.xcresult') fail('IMPORT_SCOPE_INVALID');
  if (!Array.isArray(manifest.files) || manifest.files.length === 0 || manifest.files.length > 10_000) fail('IMPORT_FILES_INVALID');
  let previous = '';
  for (const entry of manifest.files) {
    exact(entry, ['path', 'bytes', 'sha256'], 'IMPORT_ENTRY_SCHEMA');
    if (typeof entry.path !== 'string' || entry.path.length > 1024 || entry.path.includes('\\') || entry.path.includes('\0') ||
        !(roots.includes(entry.path) || directoryRoots.some(root => entry.path.startsWith(`${root}/`))) ||
        entry.path.split('/').some(part => !part || part === '..' || part === '.' || (entry.path !== '.npmrc' && ignored(part))) || entry.path <= previous) fail('IMPORT_ENTRY_PATH');
    if (!Number.isSafeInteger(entry.bytes) || entry.bytes < 0 || typeof entry.sha256 !== 'string' || !/^[0-9a-f]{64}$/u.test(entry.sha256)) fail('IMPORT_ENTRY_DIGEST');
    previous = entry.path;
  }
  const actual = inspectImportedTree(root);
  if (JSON.stringify(actual.files.map(file => file.path)) !== JSON.stringify(manifest.files.map(file => file.path))) fail('IMPORT_INVENTORY_DRIFT');
  for (let index = 0; index < actual.files.length; index += 1) {
    const observed = actual.files[index], expected = manifest.files[index];
    if (observed.bytes !== expected.bytes || observed.sha256 !== expected.sha256) fail('IMPORT_CONTENT_DRIFT');
  }
  return {
    status: 'PASS_SOURCE_FREEZE_ONLY', files: actual.files.length,
    totalBytes: actual.files.reduce((sum, file) => sum + file.bytes, 0),
    excluded: actual.excluded, originRechecked: false,
    integrationVerified: false, legalClearance: false,
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length !== 2) fail('IMPORT_ARGUMENTS');
    const root = fileURLToPath(new URL('../integrations/veritas/', import.meta.url));
    const raw = readFileSync(path.join(root, 'import-manifest.json'));
    if (raw.length > 4 * 1024 * 1024) fail('IMPORT_MANIFEST_TOO_LARGE');
    const manifest = JSON.parse(raw.toString('utf8'));
    // Frozen manifests use this exact representation: no duplicate keys, BOM,
    // hidden trailing frame, alternate whitespace or alternate key encoding.
    if (!raw.equals(Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`))) fail('IMPORT_MANIFEST_ENCODING');
    console.log(JSON.stringify(verifyImportedTree(root, manifest), null, 2));
  } catch (error) {
    console.error(JSON.stringify({ status: 'FAIL_SOURCE_FREEZE', code: error.message }));
    process.exitCode = 1;
  }
}
