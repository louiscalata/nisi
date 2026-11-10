// Copyright 2026 Louis Calata
// SPDX-License-Identifier: Apache-2.0
// A results table that names accuracy, tokens/s, solved, or AUC has to say
// how many runs that number comes from. The note is one of: "single run",
// "runs:", or "n =", in the same Markdown section as the table.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const FILES = ['README.md', 'docs/benchmarks.md', 'docs/local-models.md'];
const HEADER = /accuracy|tokens\/s|solved|\bAUC\b/i;
const NOTE = /single run|runs:|n =/;

function headingLevel(line) {
  const match = /^(#{1,6})\s+\S/u.exec(line);
  return match ? match[1].length : 0;
}

function isDelimiter(line) {
  const trimmed = line.trim();
  return trimmed.includes('-') && /^\|?[\s|:-]+\|?$/u.test(trimmed) && !/[^\s|:-]/u.test(trimmed);
}

// Markdown outside fenced code blocks. A sample table inside a fence is not a published table.
function publishedLines(markdown) {
  const lines = markdown.split(/\r?\n/u);
  const out = [];
  let fence = false;
  for (const line of lines) {
    if (/^(`{3,}|~{3,})/u.test(line.trim())) {
      fence = !fence;
      out.push('');
      continue;
    }
    out.push(fence ? '' : line);
  }
  return out;
}

function sectionText(lines, index) {
  let start = 0;
  let level = 1;
  for (let i = index; i >= 0; i -= 1) {
    const found = headingLevel(lines[i]);
    if (found) { start = i; level = found; break; }
  }
  let end = lines.length;
  for (let i = index + 1; i < lines.length; i += 1) {
    const found = headingLevel(lines[i]);
    if (found && found <= level) { end = i; break; }
  }
  return lines.slice(start, end).join('\n');
}

export function measurementTablesMissingRunNote(markdown) {
  const lines = publishedLines(markdown);
  const gaps = [];
  for (let i = 0; i < lines.length - 1; i += 1) {
    const header = lines[i];
    if (!header.trim().startsWith('|') || !isDelimiter(lines[i + 1])) continue;
    if (!HEADER.test(header)) continue;
    if (!NOTE.test(sectionText(lines, i))) gaps.push({ line: i + 1, header: header.trim() });
  }
  return gaps;
}

test('README, benchmarks, and local-models result tables say how many runs', () => {
  const gaps = [];
  for (const file of FILES) {
    const markdown = fs.readFileSync(path.join(root, file), 'utf8');
    for (const gap of measurementTablesMissingRunNote(markdown)) gaps.push(`${file}:${gap.line} ${gap.header}`);
  }
  assert.deepEqual(gaps, []);
});

test('a solved or AUC table without a run count fails, and the three notes pass', () => {
  const bare = '## Scores\n\n| Solved | AUC |\n| --- | --- |\n| 14 | 0.78 |\n';
  assert.equal(measurementTablesMissingRunNote(bare).length, 1);
  for (const note of ['Each row is a single run.', 'runs: 1', 'n = 16']) {
    assert.deepEqual(measurementTablesMissingRunNote(`## Scores\n\n${note}\n\n| tokens/s | accuracy |\n| --- | --- |\n| 3 | 0.5 |\n`), []);
  }
  assert.deepEqual(measurementTablesMissingRunNote('| Option | Default |\n| --- | --- |\n| timeout | 120 |\n'), []);
  const fenced = '```\n| Solved | AUC |\n| --- | --- |\n| 1 | 0.5 |\n```\n';
  assert.deepEqual(measurementTablesMissingRunNote(fenced), []);
  const sibling = '## Other\n\nn = 4\n\n## Scores\n\n| Solved |\n| --- |\n| 14 |\n';
  assert.equal(measurementTablesMissingRunNote(sibling).length, 1);
});
