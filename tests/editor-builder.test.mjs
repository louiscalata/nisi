// Copyright 2026 Louis Calata
// SPDX-License-Identifier: Apache-2.0
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const editorDir = path.join(root, 'docs/editor');
const sourceState = file => JSON.parse(fs.readFileSync(file, 'utf8').match(/<script id="state" type="application\/json">([\s\S]*?)<\/script>/)[1]);

function buildFixture(run) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nisi-editor-build-'));
  try {
    const base = path.join(dir, 'editor'); fs.mkdirSync(base);
    for (const name of ['build-editor.py', 'editor.js', 'editor.css', 'chrome.html']) fs.copyFileSync(path.join(editorDir, name), path.join(base, name));
    const markdown = '# Synthetic draft\n\nCafé & <script>text only</script>\n';
    fs.writeFileSync(path.join(dir, 'README-draft.md'), markdown);
    const state = { about: 'Synthetic about', sections: [{ id: 'section-one', current: markdown, baseline: '# Original\n' }] };
    const stateFile = path.join(dir, 'state.json');
    const build = (supplied, { optimize = false } = {}) => {
      fs.writeFileSync(stateFile, JSON.stringify(supplied));
      return spawnSync('python3', [...(optimize ? ['-O'] : []), path.join(base, 'build-editor.py'), 'result.html', stateFile], {
        encoding: 'utf8', timeout: 10_000, env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' },
      });
    };
    run({ base, markdown, state, build });
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

test('editor generation rejects unsafe supplied section IDs, including optimized Python', () => {
  buildFixture(({ base, state, build }) => {
    for (const id of ['section-" autofocus onfocus="alert(1)', 'section-<img src=x onerror=alert(1)>', '', 'A', 'a_b', 'a b', 'a/b', 'a\n', 'a\r', 'a\r\n', 'a\u2028', 'a\u2029', 'é', null, 7]) {
      for (const optimize of [false, true]) {
        const result = build({ ...state, sections: [{ ...state.sections[0], id }] }, { optimize });
        assert.notEqual(result.status, 0, `unsafe ID ${JSON.stringify(id)}, optimize=${optimize}`);
        assert.match(result.stderr, /Invalid section ID/);
        assert.equal(fs.existsSync(path.join(base, 'result.html')), false, 'invalid state creates no artifact');
      }
    }
  });
});

test('editor generation preserves every permitted ID form and manuscript bytes', () => {
  buildFixture(({ base, markdown, state, build }) => {
    for (const id of ['section-one', 'section-123-4', 'a', '0', '-', '--', '9-section-', 'abcdefghijklmnopqrstuvwxyz0123456789-']) {
      const supplied = { ...state, sections: [{ ...state.sections[0], id }] };
      const result = build(supplied); assert.equal(result.status, 0, result.stderr);
      const output = sourceState(path.join(base, 'result.html'));
      assert.deepEqual(output.sections, supplied.sections); assert.equal(output.about, state.about);
      assert.equal(output.sections.map(section => section.current).join(''), markdown);
    }
    const result = build({ ...state, sections: state.sections.map(({ baseline, ...section }) => section) });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(sourceState(path.join(base, 'result.html')).sections[0].baseline, markdown);
  });
});

test('generated editor artifacts reproduce the current source and preserve both manuscripts', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nisi-editor-artifacts-'));
  try {
    const base = path.join(dir, 'editor'); fs.mkdirSync(base);
    for (const name of ['build-editor.py', 'editor.js', 'editor.css', 'chrome.html']) fs.copyFileSync(path.join(editorDir, name), path.join(base, name));
    const markdown = fs.readFileSync(path.join(root, 'docs/README-draft.md'));
    fs.writeFileSync(path.join(dir, 'README-draft.md'), markdown);
    for (const name of ['index.html', 'index-typing-revision.html']) {
      const original = fs.readFileSync(path.join(editorDir, name), 'utf8');
      const state = sourceState(path.join(editorDir, name));
      assert.equal(state.sections.map(section => section.current).join(''), markdown.toString('utf8'));
      const stateFile = path.join(dir, 'state.json'); fs.writeFileSync(stateFile, JSON.stringify(state));
      const result = spawnSync('python3', [path.join(base, 'build-editor.py'), name, stateFile], {
        encoding: 'utf8', timeout: 10_000, env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' },
      });
      assert.equal(result.status, 0, result.stderr);
      assert.equal(fs.readFileSync(path.join(base, name), 'utf8'), original, name);
    }
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('editor regeneration preserves a supplied manuscript revision for browser recovery', () => {
  buildFixture(({ base, state, build }) => {
    const baseRevision = 'a'.repeat(64);
    const result = build({ ...state, baseRevision }); assert.equal(result.status, 0, result.stderr);
    assert.equal(sourceState(path.join(base, 'result.html')).baseRevision, baseRevision);
  });
});

test('editor generation refuses malformed supplied manuscript revisions', () => {
  buildFixture(({ base, state, build }) => {
    for (const baseRevision of ['', 'A'.repeat(64), 'a'.repeat(63), 'a'.repeat(65), 'g'.repeat(64), 'a'.repeat(64) + '\n', null, 7]) {
      const result = build({ ...state, baseRevision });
      assert.notEqual(result.status, 0, JSON.stringify(baseRevision));
      assert.match(result.stderr, /Invalid base revision/);
      assert.equal(fs.existsSync(path.join(base, 'result.html')), false);
    }
  });
});
