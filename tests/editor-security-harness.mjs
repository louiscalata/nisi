// Deterministic section-ID differential and mutation checks, using synthetic data only.
// Run directly with: node tests/editor-security-harness.mjs
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { editor, initial, saved, source } from './editor-support.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const builderSource = fs.readFileSync(path.join(root, 'docs/editor/build-editor.py'), 'utf8');
const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789-';
function permitted(value) {
  if (typeof value !== 'string' || value.length === 0) return false;
  for (const character of value) {
    const code = character.codePointAt(0);
    if (code !== 45 && !(code >= 48 && code <= 57) && !(code >= 97 && code <= 122)) return false;
  }
  return true;
}
let seed = 0x6e697369;
function next() {
  seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
  return seed >>> 0;
}
const forbidden = ['A', '_', '.', ' ', '/', '\\', '"', "'", '<', '>', '&', '\n', '\r', '\u2028', '\u2029', '\0', ':', 'é', '中', '😀'];
const generated = [];
for (let index = 0; index < 2048; index++) {
  let id = `${index.toString(36)}-`;
  for (let length = 1 + next() % 24; length > 0; length--) id += alphabet[next() % alphabet.length];
  generated.push(id);
  const position = next() % (id.length + 1);
  generated.push(id.slice(0, position) + forbidden[index % forbidden.length] + id.slice(position));
}
const probes = ['a', '0', '-', '--', 'a-9', 'abcdefghijklmnopqrstuvwxyz0123456789-', '', ...forbidden.map(c => `a${c}`),
  'section-" autofocus onfocus="alert(1)', 'section-</textarea><script>alert(1)</script>', null, 7, {}, []];
const allIds = [...probes, ...generated];

async function checkRuntime(appSource, ids) {
  let startup = 0, recovery = 0;
  for (const id of ids) {
    const expected = permitted(id), documentState = initial(); documentState.sections[0].id = id;
    if (expected) {
      const e = editor({ documentState, appSource }); await e.ready();
      const section = e.get('sections').children[0], field = e.get(`edit-${id}`);
      assert.ok(field, 'each admitted ID has a text field');
      assert.equal(section.id, id); assert.equal(field, section.querySelector('textarea'));
      assert.equal(section.querySelector('label').htmlFor, field.id);
      assert.equal(section.querySelector('.number').textContent, '01');
      assert.equal(e.get('contents').children[0].href, `#${id}`);
    } else {
      assert.throws(() => editor({ documentState, appSource }), /Invalid section ID/, JSON.stringify(id));
    }
    startup++;
    const backup = saved(); backup.sections[0].id = id;
    const e = editor({ backup, appSource }); await e.ready();
    assert.equal(e.get('recovery').hidden, !expected, JSON.stringify(id));
    assert.equal(e.writes.length, 0);
    if (expected) {
      await e.get('restore').click();
      assert.equal(e.get(`edit-${id}`).value, backup.sections[0].current);
    }
    recovery++;
  }
  return { startup, recovery };
}

function change(text, before, after) {
  assert.ok(text.includes(before), `mutation target missing: ${before}`);
  assert.notEqual(before, after);
  return text.replace(before, after);
}
const runtimeMutations = [
  ['embedded admission removed', change(source, "if (!state.sections.every(section => section && validSectionId(section.id))) throw new Error('Invalid section ID');", '')],
  ['empty ID admitted', change(source, 'value.length > 0 && ', '')],
  ['recovery ID admission removed', change(source, 'validSectionId(s.id)', 'true')],
  ['multiline ID predicate admits line terminator', change(source, '!/[^a-z0-9-]/.test(value)', '/^[a-z0-9-]+$/m.test(value)')],
  ['valid digits rejected', change(source, '[^a-z0-9-]', '[^a-z-]')],
  ['valid hyphens rejected', change(source, '[^a-z0-9-]', '[^a-z0-9]')],
  ['valid letters rejected', change(source, '[^a-z0-9-]', '[^0-9-]')],
  ['section ID changed', change(source, 'element.id = section.id', 'element.id = `section-${section.id}`')],
  ['navigation target changed', change(source, 'link.href = `#${section.id}`', 'link.href = `#missing-${section.id}`')],
  ['current text replaced by baseline', change(source, 'textarea.value = section.current', 'textarea.value = section.baseline')],
  ['text field association lost', change(source, 'textarea.id = `edit-${section.id}`', 'textarea.id = `field-${section.id}`')],
  ['label association lost', change(source, "element.querySelector('label').htmlFor = textarea.id", "element.querySelector('label').htmlFor = section.id")],
  ['section ordinal lost', change(source, "element.querySelector('.number').textContent = String(index + 1).padStart(2, '0')", "element.querySelector('.number').textContent = String(index + 1)")],
  ...[
    ['uppercase', 'A-Z'], ['underscore', '_'], ['period', '.'], ['space', ' '],
    ['slash', '\\/'], ['quote', '"'], ['angle bracket', '<'], ['ampersand', '&'],
    ['newline', '\\n'], ['carriage return', '\\r'], ['Unicode separator', '\\u2028'],
  ].map(([name, characters]) => [`${name} admitted`, change(source, '[^a-z0-9-]', `[^a-z0-9${characters}-]`)]),
];

const python = `
import contextlib
import io
import json
import pathlib
import sys

payload = json.loads(sys.stdin.read())
base = pathlib.Path(payload['base'])
state_file = base.parent / 'state.json'
markdown = '# Synthetic draft\\n\\nText only.\\n'
(base.parent / 'README-draft.md').write_text(markdown, encoding='utf-8')

def run_case(code, identifier):
    state_file.write_text(json.dumps({'about': 'Synthetic', 'sections': [{'id': identifier, 'current': markdown, 'baseline': ''}]}), encoding='utf-8')
    sys.argv = [str(base / 'build-editor.py'), 'result.html', str(state_file)]
    try:
        with contextlib.redirect_stdout(io.StringIO()):
            exec(code, {'__file__': str(base / 'build-editor.py'), '__name__': '__main__'})
    except ValueError as error:
        if str(error) == 'Invalid section ID':
            return False
        raise
    return True

results = []
for entry in payload['sources']:
    code = compile(entry['source'], str(base / 'build-editor.py'), 'exec', optimize=entry.get('optimize', 0))
    ids = payload['allIds'] if entry['name'] == 'current' else payload['probes']
    checked = 0
    killed = False
    for identifier in ids:
        expected = isinstance(identifier, str) and len(identifier) > 0 and all(ord(c) == 45 or 48 <= ord(c) <= 57 or 97 <= ord(c) <= 122 for c in identifier)
        try:
            actual = run_case(code, identifier)
            agrees = actual == expected
        except Exception:
            agrees = False
        checked += 1
        if not agrees:
            if entry['name'] == 'current':
                raise AssertionError(repr(identifier))
            killed = True
            break
    results.append({'name': entry['name'], 'checked': checked, 'killed': killed})
print(json.dumps(results))
`;
const builderMutations = [
  ['generator ID admission removed', change(builderSource, "    if any(not isinstance(s.get('id'), str) or re.fullmatch(r'[a-z0-9-]+', s['id']) is None for s in supplied['sections']):\n        raise ValueError('Invalid section ID')\n", '')],
  ['generator searches substring', change(builderSource, "re.fullmatch(r'[a-z0-9-]+', s['id'])", "re.search(r'[a-z0-9-]+', s['id'])")],
  ['generator admits empty IDs', change(builderSource, "r'[a-z0-9-]+'", "r'[a-z0-9-]*'")],
  ['generator rejects digits', change(builderSource, "r'[a-z0-9-]+'", "r'[a-z-]+'")],
  ['generator rejects hyphens', change(builderSource, "r'[a-z0-9-]+'", "r'[a-z0-9]+'")],
  ...[
    ['uppercase', 'A-Z'], ['underscore', '_'], ['period', '.'], ['space', ' '],
    ['slash', '/'], ['quote', '"'], ['angle bracket', '<'], ['ampersand', '&'],
    ['newline', '\\n'], ['carriage return', '\\r'], ['Unicode separator', '\\u2028'],
  ].map(([name, characters]) => [`generator admits ${name}`, change(builderSource, "r'[a-z0-9-]+'", `r'[a-z0-9${characters}-]+'`)]),
];

const runtime = await checkRuntime(source, allIds);
const runtimeResults = [];
for (const [name, appSource] of runtimeMutations) {
  new vm.Script(appSource);
  let killed = false;
  try { await checkRuntime(appSource, probes); } catch { killed = true; }
  runtimeResults.push({ name, killed });
}
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nisi-editor-security-'));
let builderResults;
try {
  const base = path.join(dir, 'editor'); fs.mkdirSync(base);
  for (const name of ['editor.js', 'editor.css', 'chrome.html']) fs.copyFileSync(path.join(root, 'docs/editor', name), path.join(base, name));
  const result = spawnSync('python3', ['-c', python], {
    input: JSON.stringify({ base, allIds, probes, sources: [{ name: 'current', source: builderSource },
      { name: 'optimized', source: builderSource, optimize: 2 }, ...builderMutations.map(([name, source]) => ({ name, source }))] }),
    encoding: 'utf8', timeout: 120_000, maxBuffer: 1024 * 1024, env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' },
  });
  assert.equal(result.status, 0, result.stderr);
  builderResults = JSON.parse(result.stdout);
} finally { fs.rmSync(dir, { recursive: true, force: true }); }
const current = builderResults.find(result => result.name === 'current');
const optimized = builderResults.find(result => result.name === 'optimized');
assert.equal(current.checked, allIds.length); assert.equal(current.killed, false);
assert.equal(optimized.checked, probes.length); assert.equal(optimized.killed, false);
const mutationResults = [...runtimeResults, ...builderResults.filter(result => !['current', 'optimized'].includes(result.name))];
const survivors = mutationResults.filter(result => !result.killed).map(result => result.name);
console.log(JSON.stringify({ generatedInputs: generated.length, fixedInputs: probes.length, runtime,
  generatorDifferential: current.checked, optimizedGenerator: optimized.checked,
  runtimeMutants: runtimeResults.length, generatorMutants: builderMutations.length,
  killed: mutationResults.length - survivors.length, survivors }, null, 2));
assert.deepEqual(survivors, []);
