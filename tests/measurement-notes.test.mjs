// Copyright 2026 Louis Calata
// SPDX-License-Identifier: Apache-2.0
// A measured-results table has to say how many runs those numbers come from.
// The note is one of: "single run", "one run", "run once", "runs:", or "n =",
// in the same Markdown section as the table. Tables are those whose header
// names a measured score (accuracy, tokens/s, solved, AUC, contract matches,
// or reported tokens), or that sit in a "Measured results" or "Results so far"
// section, which is how the published tables appear in this repo.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const HEADER = /accuracy|tokens\/s|solved|\bAUC\b|contract matches|reported tokens/i;
const NOTE = /single runs?|one run|run once|run twice|runs:|n\s*=/;
const MEASURED_SECTION = /measured results|results so far/i;

function headingLevel(line) {
  const match = /^(#{1,6})\s+\S/u.exec(line);
  return match ? match[1].length : 0;
}

function headingText(line) {
  const match = /^(#{1,6})\s+(.+?)\s*$/u.exec(line);
  return match ? match[2] : '';
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

function sectionBounds(lines, index) {
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
  const heading = headingLevel(lines[start]) ? headingText(lines[start]) : '';
  return { start, end, heading };
}

function sectionText(lines, index) {
  const { start, end } = sectionBounds(lines, index);
  return lines.slice(start, end).join('\n');
}

function isMeasuredResultsTable(header, sectionHeading) {
  return HEADER.test(header) || MEASURED_SECTION.test(sectionHeading);
}

export function measurementTablesMissingRunNote(markdown) {
  const lines = publishedLines(markdown);
  const gaps = [];
  for (let i = 0; i < lines.length - 1; i += 1) {
    const header = lines[i];
    if (!header.trim().startsWith('|') || !isDelimiter(lines[i + 1])) continue;
    const { heading } = sectionBounds(lines, i);
    if (!isMeasuredResultsTable(header, heading)) continue;
    if (!NOTE.test(sectionText(lines, i))) gaps.push({ line: i + 1, header: header.trim() });
  }
  return gaps;
}

function collectMarkdown(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ent.name === '.git' || ent.name === 'node_modules') continue;
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) collectMarkdown(p, out);
    else if (ent.name.endsWith('.md')) out.push(p);
  }
  return out;
}

function docsAndReadmeFiles() {
  const files = [];
  const readme = path.join(root, 'README.md');
  if (fs.existsSync(readme)) files.push(readme);
  collectMarkdown(path.join(root, 'docs'), files);
  collectMarkdown(path.join(root, 'benchmarks'), files);
  return files;
}

test('docs and README measured-results tables say how many runs', () => {
  const gaps = [];
  for (const file of docsAndReadmeFiles()) {
    const rel = path.relative(root, file).split(path.sep).join('/');
    const markdown = fs.readFileSync(file, 'utf8');
    for (const gap of measurementTablesMissingRunNote(markdown)) {
      gaps.push(`${rel}:${gap.line} ${gap.header}`);
    }
  }
  assert.deepEqual(gaps, []);
});

test('a measured-results table without a run count fails, and the accepted notes pass', () => {
  const bare = '## Scores\n\n| Solved | AUC |\n| --- | --- |\n| 14 | 0.78 |\n';
  assert.equal(measurementTablesMissingRunNote(bare).length, 1);

  const contract = '## Local pilot\n\n| Arm | Contract matches | Reported tokens |\n| --- | --- | --- |\n| Nisi | 12 / 12 | 8,291 |\n';
  assert.equal(measurementTablesMissingRunNote(contract).length, 1);

  const resultsSoFar = '## Results so far\n\n| Flags | One draft | Nisi | Time |\n| --- | --- | --- | --- |\n| none | 14 | 14 | 14.0 min |\n';
  assert.equal(measurementTablesMissingRunNote(resultsSoFar).length, 1);

  for (const note of ['Each row is a single run.', 'Each row is one run.', 'Each setting was run once.', 'runs: 1', 'n = 16']) {
    assert.deepEqual(measurementTablesMissingRunNote(`## Scores\n\n${note}\n\n| tokens/s | accuracy |\n| --- | --- |\n| 3 | 0.5 |\n`), []);
  }
  assert.deepEqual(
    measurementTablesMissingRunNote('## Results so far\n\nEach row is one run.\n\n| Flags | One draft | Nisi | Time |\n| --- | --- | --- | --- |\n| none | 14 | 14 | 14.0 min |\n'),
    [],
  );
  assert.deepEqual(measurementTablesMissingRunNote('| Option | Default |\n| --- | --- |\n| timeout | 120 |\n'), []);
  assert.deepEqual(measurementTablesMissingRunNote('| File | Settings | Notes |\n| --- | --- | --- |\n| run.json | defaults | |\n'), []);
  const fenced = '```\n| Solved | AUC |\n| --- | --- |\n| 1 | 0.5 |\n```\n';
  assert.deepEqual(measurementTablesMissingRunNote(fenced), []);
  const sibling = '## Other\n\nn = 4\n\n## Scores\n\n| Solved |\n| --- |\n| 14 |\n';
  assert.equal(measurementTablesMissingRunNote(sibling).length, 1);
});
