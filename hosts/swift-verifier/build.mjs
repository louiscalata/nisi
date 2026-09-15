// PRIVATE developer build helper. Compiles only the reviewed fixed native sources.
// Never builds/runs user candidate code. Generated output stays in a unique .build dir.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { hashBytes } from './protocol.mjs';
import { cloneFreeze } from '../../workflow/contracts.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const nativeRoot = 'native/macos/CodenameVeritasFramework/Sources/VeritasCore/';
const names = ['ArtifactSnapshot.swift', 'StrictJSONDocumentValidator.swift', 'DeterministicChecks.swift'];
const fail = code => { throw Object.assign(new Error(code), { code }); };
const issuedBuilds = new WeakSet();
export const isIssuedNativeArtifactBuild = value => issuedBuilds.has(value);

export function buildNativeArtifactKernel() {
  if (process.platform !== 'darwin' || process.arch !== 'arm64') fail('SWIFT_BUILD_PLATFORM_NOT_SUPPORTED');
  const importManifest = JSON.parse(fs.readFileSync(path.join(root, 'integrations/veritas/import-manifest.json')));
  const sources = names.map(name => {
    const relative = nativeRoot + name;
    const file = path.join(root, 'integrations/veritas', relative);
    const bytes = fs.readFileSync(file);
    const entry = importManifest.files.find(f => f.path === relative);
    if (!entry || bytes.length !== entry.bytes || hashBytes(bytes) !== entry.sha256) fail('SWIFT_IMPORTED_SOURCE_DRIFT');
    return { name, path: `integrations/veritas/${relative}`, bytes, sha256: entry.sha256 };
  });
  const main = fs.readFileSync(path.join(root, 'hosts/swift-verifier/main.swift'));
  sources.push({ name: 'main.swift', path: 'hosts/swift-verifier/main.swift', bytes: main, sha256: hashBytes(main) });
  fs.mkdirSync(path.join(root, '.build'), { recursive: true });
  const directory = fs.mkdtempSync(path.join(root, '.build/nisi-swift-kernel-'));
  const sourceFiles = sources.map(({ path: sourcePath, sha256 }) => ({ path: sourcePath, sha256 }));
  const sourceFingerprint = hashBytes(Buffer.from(`nisi/swift-kernel-source/v1\0${JSON.stringify(sourceFiles)}`));
  for (const source of sources) fs.writeFileSync(path.join(directory, source.name), source.bytes, { flag: 'wx' });
  const identity = `enum NisiBuildIdentity { static let sourceFingerprint = "${sourceFingerprint}" }\n`;
  fs.writeFileSync(path.join(directory, 'BuildIdentity.swift'), identity, { flag: 'wx' });
  const environment = { PATH: '/usr/bin:/bin', LANG: 'C', LC_ALL: 'C', TMPDIR: directory };
  const commands = [];
  function run(executable, argv, label) {
    const result = spawnSync(executable, argv, { cwd: directory, env: environment,
      timeout: 30_000, killSignal: 'SIGKILL', maxBuffer: 1_048_576, encoding: 'utf8' });
    commands.push({ executable, argv, exitCode: result.status, signal: result.signal,
      errorCode: result.error?.code ?? null, stdout: result.stdout ?? '', stderr: result.stderr ?? '' });
    fs.writeFileSync(path.join(directory, 'build-commands.json'), JSON.stringify(commands, null, 2));
    if (result.error || result.status !== 0 || result.signal) fail(`SWIFT_BUILD_${label}_FAILED`);
    return result.stdout.trim();
  }
  const compiler = run('/usr/bin/xcrun', ['--find', 'swiftc'], 'DISCOVERY');
  const sdk = run('/usr/bin/xcrun', ['--sdk', 'macosx', '--show-sdk-path'], 'SDK');
  if (!path.isAbsolute(compiler) || !path.isAbsolute(sdk)) fail('SWIFT_BUILD_PATH_INVALID');
  const compilerVersion = run(compiler, ['--version'], 'VERSION');
  const executable = path.join(directory, 'nisi-artifact-verifier');
  const argv = ['-swift-version', '6', '-O', '-sdk', sdk, '-target', 'arm64-apple-macosx27.0',
    '-module-name', 'NisiArtifactVerifier', ...names, 'main.swift', 'BuildIdentity.swift', '-o', executable];
  run(compiler, argv, 'COMPILE');
  for (const source of sources) {
    if (hashBytes(fs.readFileSync(path.join(directory, source.name))) !== source.sha256 ||
        hashBytes(fs.readFileSync(path.join(root, source.path))) !== source.sha256) fail('SWIFT_BUILD_SOURCE_CHANGED');
  }
  if (fs.readFileSync(path.join(directory, 'BuildIdentity.swift'), 'utf8') !== identity) fail('SWIFT_BUILD_IDENTITY_CHANGED');
  const manifest = { schemaVersion: 1, status: 'COMPILED_FIXED_KERNEL_ONLY', directory, sourceFiles,
    sourceFingerprint, compiler, compilerVersion, compilerSha256: hashBytes(fs.readFileSync(compiler)), sdk,
    argv, identitySha256: hashBytes(Buffer.from(identity)), executable, executableSha256: hashBytes(fs.readFileSync(executable)),
    hostEnvironment: environment, generatedAt: new Date().toISOString(), authorizing: false };
  fs.writeFileSync(path.join(directory, 'build-manifest.json'), JSON.stringify(manifest, null, 2));
  const issued = cloneFreeze(manifest);
  issuedBuilds.add(issued);
  return issued;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const manifest = buildNativeArtifactKernel();
  console.log(JSON.stringify({ status: manifest.status, manifest: path.join(manifest.directory, 'build-manifest.json') }));
}
