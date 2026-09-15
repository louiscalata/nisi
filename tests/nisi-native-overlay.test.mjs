// Pins the Nisi macOS overlay package to the frozen Veritas import: every
// frozen module reaches the package by symlink (never a copy), the two branded
// app files are EXACT product-name transforms of their originals, the mirror
// manifest matches the frozen one and declares nothing else, the bundle
// metadata is fixed, and the receipt script's subprocess surface is three
// absolute system tools. No Swift toolchain is invoked here.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { verifyImportedTree } from '../scripts/verify-veritas-import.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const overlay = path.join(root, 'native/macos/Nisi');
const frozen = path.join(root, 'integrations/veritas/native/macos/CodenameVeritasFramework');
const frozenApp = path.join(frozen, 'Sources/CodenameVeritasApp');
const read = (p) => fs.readFileSync(p, 'utf8');
const sha256 = (p) => createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const imported = path.join(root, 'integrations/veritas');
const manifest = JSON.parse(read(path.join(imported, 'import-manifest.json')));
const manifestByPath = new Map(manifest.files.map((f) => [f.path, f]));
const inside = (child, parent) => { const rel = path.relative(parent, child); return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel); };

const MIRRORED = ['VeritasSQLiteSupport', 'VeritasCore', 'VeritasAppleFoundation'];
// Symlinked, never copied: AppModel carries no product wording; IncidentHistoryCoordinator's
// product-name strings are Application Support path components (storage identity, not wording).
const LINKED_APP_FILES = ['AppModel.swift', 'IncidentHistoryCoordinator.swift'];
// The complete branding transform. Anything beyond these replacements is not branding.
// ShellTruthV1's platform-message prefix is matched with hasPrefix against the frozen
// VeritasCore message and therefore stays; only display wording changes.
const BRANDED = [
  { overlay: 'NisiApp.swift', frozen: 'CodenameVeritasApp.swift', replace: [['struct CodenameVeritasApp: App {', 'struct NisiMenuBarApp: App {'], ['MenuBarExtra("Codename Veritas Framework", systemImage: "circle.dashed")', 'MenuBarExtra("Nisi", systemImage: "circle.dashed")']] },
  { overlay: 'MenuBarView.swift', frozen: 'MenuBarView.swift', replace: [['Text("Codename Veritas Framework")', 'Text("Nisi")'], ['panel.message = "Choose a new file. Veritas refuses to replace existing files."', 'panel.message = "Choose a new file. Nisi refuses to replace existing files."']] },
  { overlay: 'ShellTruthV1.swift', frozen: 'ShellTruthV1.swift', replace: [['static let clientCoverage = "the Codename Veritas Framework menu bar, the only covered client"', 'static let clientCoverage = "the Nisi menu bar, the only covered client"']] },
  { overlay: 'PrivateVerifiedFileWriter.swift', frozen: 'PrivateVerifiedFileWriter.swift', replace: [['case .destinationExists: "The destination already exists; Veritas will not replace it."', 'case .destinationExists: "The destination already exists; Nisi will not replace it."']] },
];
// Identity-bearing strings that must survive every branding pass, verbatim.
const IDENTITY_PINS = [
  ['ShellTruthV1.swift', 'private static let platformMessagePrefix = "Codename Veritas Framework requires macOS"'],
  ['ShellTruthV1.swift', 'static let truthBlock = "veritas.shell.truth"'],
  ['IncidentHistoryCoordinator.swift', 'let names = ["Codename Veritas Framework", "Private Incident History"]'],
  ['IncidentHistoryCoordinator.swift', 'scopeID: "scope/veritas-private",'],
  ['IncidentHistoryCoordinator.swift', 'projectDigest: digest("codename-veritas-framework-founder-alpha-v1"),'],
];
const PLIST_KEYS = ['CFBundleDevelopmentRegion', 'CFBundleDisplayName', 'CFBundleExecutable', 'CFBundleIdentifier', 'CFBundleInfoDictionaryVersion', 'CFBundleName', 'CFBundlePackageType', 'CFBundleShortVersionString', 'CFBundleVersion', 'LSMinimumSystemVersion', 'LSUIElement', 'NSPrincipalClass'];

test('every mirrored library target is a directory symlink into the frozen package, never a copy', () => {
  for (const name of MIRRORED) {
    const link = path.join(overlay, 'Sources', name);
    assert.ok(fs.lstatSync(link).isSymbolicLink(), `${name} must be a symlink`);
    const target = fs.realpathSync.native(link);
    assert.equal(target, fs.realpathSync.native(path.join(frozen, 'Sources', name)));
    assert.ok(inside(target, fs.realpathSync.native(frozen)));
  }
  assert.deepEqual(fs.readdirSync(path.join(overlay, 'Sources')).sort(), ['NisiApp', ...MIRRORED].sort(), 'no other target directories');
});

test('the app target covers every frozen app file: two file symlinks plus the four branded copies', () => {
  for (const name of LINKED_APP_FILES) {
    const link = path.join(overlay, 'Sources/NisiApp', name);
    assert.ok(fs.lstatSync(link).isSymbolicLink(), `${name} must be a symlink`);
    assert.equal(fs.realpathSync.native(link), fs.realpathSync.native(path.join(frozenApp, name)));
  }
  assert.deepEqual(fs.readdirSync(path.join(overlay, 'Sources/NisiApp')).sort(), [...LINKED_APP_FILES, ...BRANDED.map((b) => b.overlay)].sort(), 'the app target holds exactly six files');
  assert.deepEqual(fs.readdirSync(frozenApp).sort(), [...LINKED_APP_FILES, ...BRANDED.map((b) => b.frozen)].sort(), 'the overlay covers every frozen app file; a re-import that adds one must be mirrored');
});

test('each branded copy is exactly the frozen original with the product-name replacements applied, nothing else', () => {
  for (const { overlay: name, frozen: original, replace } of BRANDED) {
    const p = path.join(overlay, 'Sources/NisiApp', name);
    assert.ok(!fs.lstatSync(p).isSymbolicLink(), `${name} is an owned copy`);
    let expected = read(path.join(frozenApp, original));
    for (const [from, to] of replace) { assert.equal(expected.split(from).length, 2, `${original} carries "${from}" exactly once`); expected = expected.replace(from, to); }
    assert.equal(read(p), expected, `${name} is the exact transform of ${original}`);
    if (name !== 'ShellTruthV1.swift') assert.doesNotMatch(read(p), /Codename Veritas Framework/);
  }
  for (const [name, line] of IDENTITY_PINS) assert.ok(read(path.join(overlay, 'Sources/NisiApp', name)).includes(line), `${name} keeps identity line: ${line}`);
  assert.equal((read(path.join(overlay, 'Sources/NisiApp/ShellTruthV1.swift')).match(/Codename Veritas Framework/g) ?? []).length, 1, 'only the platform-message prefix remains in ShellTruthV1');
});

test('the mirror manifest declares exactly the frozen library targets (same declarations), the app target and three products', () => {
  const ours = read(path.join(overlay, 'Package.swift')), theirs = read(path.join(frozen, 'Package.swift'));
  assert.match(ours, /^\/\/ swift-tools-version: 6\.2/);
  assert.match(ours, /\n    name: "Nisi",\n/);
  assert.match(ours, /\n    platforms: \[\n        \.macOS\("27\.0"\),\n    \],\n/);
  assert.match(theirs, /\.macOS\("27\.0"\)/);
  assert.doesNotMatch(ours, /\n    dependencies: \[/, 'no package dependencies: one package identity');
  assert.doesNotMatch(ours, /unsafeFlags|path: |\.binaryTarget|\.plugin|swiftSettings|cSettings/);
  const section = (source, key, close) => { const m = source.match(new RegExp(`\\n    ${key}: \\[\\n([\\s\\S]*?)\\n    \\]${close}`)); assert.ok(m, `${key} array found`); return m[1]; };
  const names = (body, kinds) => [...body.matchAll(new RegExp(`\\.(${kinds})\\(\\s*name: "([^"]+)"`, 'g'))].map((m) => m[2]);
  const products = section(ours, 'products', ','), targets = section(ours, 'targets', '\n\\)');
  assert.deepEqual(names(products, 'library|executable|plugin|snippet'), ['VeritasCore', 'VeritasAppleFoundation', 'Nisi']);
  assert.deepEqual(names(targets, 'target|executableTarget|testTarget|binaryTarget|plugin|systemLibrary|macro'), ['VeritasSQLiteSupport', 'VeritasCore', 'VeritasAppleFoundation', 'NisiApp']);
  assert.equal((ours.match(/\.\w+\(\s*name:/g) ?? []).length, 7, 'seven declarations in total: three products, four targets');
  const block = (source, name) => { const m = source.match(new RegExp(`\\.(?:executable)?[tT]arget\\(\\s*name: "${name}",[\\s\\S]*?\\n        \\)`)); assert.ok(m, `${name} declared`); return m[0].replace(/\s+/g, ' '); };
  for (const name of MIRRORED) assert.equal(block(ours, name), block(theirs, name), `${name} declaration mirrors the frozen manifest`);
  assert.equal(block(theirs, 'CodenameVeritasApp').replace('CodenameVeritasApp', 'NisiApp'), block(ours, 'NisiApp'));
  assert.match(products, /\.library\(name: "VeritasCore", targets: \["VeritasCore"\]\)/);
  assert.match(products, /\.library\(name: "VeritasAppleFoundation", targets: \["VeritasAppleFoundation"\]\)/);
  assert.match(products, /\.executable\(name: "Nisi", targets: \["NisiApp"\]\)/);
});

test('Info.plist has exactly the twelve agent-app keys, named Nisi, placeholder identifier, no icon', () => {
  const plist = read(path.join(overlay, 'Info.plist'));
  assert.deepEqual([...plist.matchAll(/<key>([^<]+)<\/key>/g)].map((m) => m[1]), PLIST_KEYS);
  const value = (key) => { const m = plist.match(new RegExp(`<key>${key}</key>\\s*<(string|true|false)(?:>([^<]*)</string>|/>)`)); return m ? (m[1] === 'string' ? m[2] : m[1] === 'true') : undefined; };
  assert.equal(value('CFBundleName'), 'Nisi');
  assert.equal(value('CFBundleDisplayName'), 'Nisi');
  assert.equal(value('CFBundleExecutable'), 'Nisi');
  assert.equal(value('CFBundlePackageType'), 'APPL');
  assert.equal(value('CFBundleIdentifier'), 'com.louiscalata.nisi', 'confirmed by Louis 2026-09-14');
  assert.equal(value('LSMinimumSystemVersion'), '27.0');
  assert.equal(value('LSUIElement'), true, 'menu-bar-only app: no Dock icon');
  assert.equal(value('NSPrincipalClass'), 'NSApplication');
  assert.equal(value('CFBundleShortVersionString'), '0.2.0');
  assert.doesNotMatch(plist, /Veritas|Icon|LSBackgroundOnly|NSAppleEventsUsageDescription/);
  assert.ok(!fs.existsSync(path.join(overlay, 'Assets.xcassets')), 'no asset catalog yet');
});

test('the overlay owns exactly seven regular files, adds nothing to the frozen import, and the frozen package carries only its known pre-existing hidden entries', () => {
  const regular = [];
  const walk = (dir) => { for (const name of fs.readdirSync(dir).sort()) { const p = path.join(dir, name); const st = fs.lstatSync(p);
    if (st.isSymbolicLink()) assert.ok(inside(fs.realpathSync.native(p), fs.realpathSync.native(frozen)), `${p} resolves inside the frozen package`);
    else if (st.isDirectory()) walk(p); else regular.push(path.relative(overlay, p)); } };
  walk(overlay);
  assert.deepEqual(regular, ['Info.plist', 'Package.swift', 'README.md', 'Sources/NisiApp/MenuBarView.swift', 'Sources/NisiApp/NisiApp.swift', 'Sources/NisiApp/PrivateVerifiedFileWriter.swift', 'Sources/NisiApp/ShellTruthV1.swift']);
  assert.ok(!fs.existsSync(path.join(overlay, '.build')) && !fs.existsSync(path.join(overlay, '.swiftpm')) && !fs.existsSync(path.join(overlay, 'Package.resolved')), 'builds use --scratch-path; nothing lands in the package');
  assert.deepEqual(fs.readdirSync(frozen).sort(), ['.build', 'Package.swift', 'Scripts', 'Sources', 'Tests']);
  // Two 10- and 209-byte SwiftPM markers were written into the frozen package on
  // 2026-09-14T05:02Z by a build without --scratch-path (before any retained
  // receipt). They are recorded here so any further hidden write is a failure.
  assert.deepEqual(fs.readdirSync(path.join(frozen, '.build')).sort(), ['.buildSystem_debug', 'CACHEDIR.TAG']);
  assert.ok(!fs.existsSync(path.join(frozen, 'Package.resolved')) && !fs.existsSync(path.join(frozen, '.swiftpm')));
});

test('every file SwiftPM would compile through the symlinks is a manifest entry with the same hash; no dot entries, no foreign kinds', () => {
  // The import verifier skips node_modules/, DerivedData/ and *.xcresult without
  // traversing them, but SwiftPM compiles any non-hidden .swift under a target
  // directory. This walk follows the symlinks the way the compiler does.
  const problems = [];
  const walk = (dir, rel) => { for (const name of fs.readdirSync(dir).sort()) { const p = path.join(dir, name); const st = fs.statSync(p); const r = rel ? `${rel}/${name}` : name;
    if (name.startsWith('.')) { problems.push(`dot entry ${r}`); continue; }
    if (st.isDirectory()) { walk(p, r); continue; }
    if (!['.swift', '.c', '.h'].includes(path.extname(name))) { problems.push(`foreign file ${r}`); continue; }
    if (!fs.lstatSync(p).isSymbolicLink() && r.startsWith('NisiApp/')) continue; // owned copies are pinned by the transform test
    const frozenRel = path.relative(imported, fs.realpathSync.native(p));
    const entry = manifestByPath.get(frozenRel);
    if (!entry) problems.push(`compiled but not in manifest: ${r} -> ${frozenRel}`);
    else if (sha256(p) !== entry.sha256) problems.push(`hash differs from manifest: ${r}`); } };
  walk(path.join(overlay, 'Sources'), '');
  assert.deepEqual(problems, []);
  const result = verifyImportedTree(imported, manifest);
  assert.equal(result.status, 'PASS_SOURCE_FREEZE_ONLY');
  assert.deepEqual(result.excluded, ['native/macos/CodenameVeritasFramework/.build'], 'the only verifier exclusion is the stale .build; any other excluded name is a hidden compile surface');
});

test('the receipt script spawns only three absolute system tools, never signs with an identity, launches, notarizes or installs, and fails closed', () => {
  const script = read(path.join(root, 'work-orders/parallel-seven-tracks-v1/build-nisi-macos.mjs'));
  assert.match(script, /^import \{spawnSync\} from 'node:child_process';$/m, 'child_process is imported as spawnSync only');
  assert.doesNotMatch(script, /\b(exec|execSync|execFile|execFileSync|spawn|fork|Worker|eval|import\()\s*\(/);
  const spawns = [...script.matchAll(/\bspawnSync\(([^,]+),/g)].map((m) => m[1].trim());
  assert.deepEqual(spawns, ['TOOLS[tool]'], 'exactly one spawn site, routed through the tool table');
  assert.match(script, /^const TOOLS=\{xcrun:'\/usr\/bin\/xcrun',plutil:'\/usr\/bin\/plutil',codesign:'\/usr\/bin\/codesign'\};$/m);
  assert.deepEqual([...script.matchAll(/\brun\('(\w+)',/g)].map((m) => m[1]), ['xcrun', 'xcrun', 'xcrun', 'plutil', 'codesign', 'codesign']);
  assert.deepEqual([...script.matchAll(/\brun\('codesign',\[([^\]]*)\]/g)].map((m) => m[1]), ["'-dvv',app", "'-d','--entitlements',':-',app"], 'codesign is only ever asked to describe, never to sign');
  assert.match(script, /\brun\('xcrun',\['swift','--version'\]\)/);
  assert.match(script, /\brun\('xcrun',args,\{timeout:300000/);
  assert.match(script, /\brun\('xcrun',\[\.\.\.args,'--show-bin-path'\]/);
  assert.match(script, /^const args=\['swift','build','--package-path',overlay,'--product','Nisi','--configuration',configuration,'--scratch-path',scratch\];$/m);
  assert.match(script, /^const buildEnv=\{DEVELOPER_DIR:'\/Applications\/Xcode-27\.0\.app\/Contents\/Developer',CODE_SIGNING_ALLOWED:'NO',CODE_SIGNING_REQUIRED:'NO'\};$/m);
  assert.match(script, /signedWithIdentity:false,notarized:false,appLaunched:false,modelCalled:false,\s*installed:false,releaseAuthorized:false,authorizing:false/);
  assert.match(script, /c\.signature!=='adhoc'\|\|c\.authority!==null\|\|c\.teamIdentifier!=='not set'\)throw Error\('UNEXPECTED_SIGNATURE_STATE'\)/);
  for (const guard of ['OVERLAY_SYMLINK_ESCAPES_FROZEN_PACKAGE', 'FROZEN_APP_TARGET_NOT_COVERED', 'FROZEN_HIDDEN_ENTRY_DRIFT', 'FROZEN_HIDDEN_ENTRY_UNEXPECTED', 'IMPORT_UNEXPECTED_EXCLUSION', 'COMPILED_SOURCE_NOT_IN_MANIFEST', 'COMPILED_SOURCE_HASH_MISMATCH', 'COMPILED_TREE_DOT_ENTRY', 'COMPILED_TREE_DRIFT_DURING_BUILD', 'OVERLAY_DRIFT_DURING_BUILD', 'MANIFEST_DRIFT', 'BIN_PATH_OUTSIDE_SCRATCH', 'FROZEN_IMPORT_NOT_VERIFIED_BEFORE', 'FROZEN_IMPORT_NOT_VERIFIED_AFTER']) assert.match(script, new RegExp(`throw Error\\('${guard}`), guard);
  assert.match(script, /^const KNOWN_EXCLUDED=\['native\/macos\/CodenameVeritasFramework\/\.build'\];$/m);
  assert.match(script, /^const KNOWN_HIDDEN=\['native\/macos\/CodenameVeritasFramework\/\.build\/\.buildSystem_debug','native\/macos\/CodenameVeritasFramework\/\.build\/CACHEDIR\.TAG'\];$/m);
  assert.match(script, /mkdtempSync\(path\.join\(root,`\.build\/nisi-app-bundle-/, 'everything the script writes lands under the gitignored evidence directory');
  assert.doesNotMatch(script, /--sign|'-s'|productbuild|notarytool|stapler|LaunchServices|\/Applications\/(?!Xcode-27\.0\.app\/Contents\/Developer')/);
  assert.match(script, /catch\(error\)\{record\.status='FAIL';record\.failure=error\.message;process\.exitCode=1;\}/);
});
