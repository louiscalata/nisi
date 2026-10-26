import test from 'node:test';
import assert from 'node:assert/strict';
import {open} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';

const JOURNAL_SHA256 = '0164f10da27f6d12cfd1f3d443bd8e0f7c237b46363353570ae4a759a97f749b';
const PARSER_SHA256 = '0405808adc77b2f4e2b166bbab96213b881d9d3090711e3bc39dc8bebdbc1aa5';
const JOURNAL_LIMIT = 65536;
const PARSER_LIMIT = 8192;
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

async function readBounded(url, limit, label) {
  const file = await open(url, 'r');
  try {
    const buffer = Buffer.alloc(limit + 1);
    let length = 0;
    while (length < buffer.length) {
      const {bytesRead} = await file.read(buffer, length, buffer.length - length, length);
      if (bytesRead === 0) break;
      length += bytesRead;
    }
    assert(length <= limit, `${label} exceeds ${limit} byte read limit`);
    const bytes = buffer.subarray(0, length);
    return {bytes, text: new TextDecoder('utf-8', {fatal: true}).decode(bytes)};
  } finally {
    await file.close();
  }
}

function moduleRequests(source, parser) {
  const result = spawnSync(process.execPath,
    ['--experimental-vm-modules', '--input-type=module', '-e', parser],
    {input: source, encoding: 'utf8', timeout: 5000, maxBuffer: 131072, windowsHide: true});
  if (result.error) assert.fail(`VM parser child failed: ${result.error.code ?? result.error.message}`);
  if (result.status === 86 || result.status === 88)
    assert.fail(`VM SourceTextModule parser capability unavailable: ${result.stderr}`);
  if (result.status === 87) assert.fail('VM parser source bound exceeded');
  assert.equal(result.status, 0, `VM parser failed: ${result.stderr}`);
  assert.equal(result.signal, null);
  return JSON.parse(result.stdout);
}

test('source import and ambient-effect policy passes before journal module load', async () => {
  const journalUrl = new URL('../history/run-journal-v1.mjs', import.meta.url);
  const parserUrl = new URL('./parse-static-imports-child.mjs', import.meta.url);
  const source = await readBounded(journalUrl, JOURNAL_LIMIT, 'journal source');
  const parser = await readBounded(parserUrl, PARSER_LIMIT, 'parser child');
  assert.equal(sha256(source.bytes), JOURNAL_SHA256, 'journal source identity before parser');
  assert.equal(sha256(parser.bytes), PARSER_SHA256, 'parser child identity');
  assert.doesNotMatch(source.text, /\b(?:process|require|fetch|XMLHttpRequest|eval|Function|Date|performance|setTimeout|setInterval)\b|Math\.random|import\s*\(/);
  const imports = moduleRequests(source.text, parser.text);
  assert.deepEqual([...new Set(imports)].sort(), ['node:crypto', 'node:util']);
  assert.doesNotMatch(source.text, /node:(?:fs|child_process|net|http|https)|randomUUID|randomBytes/);

  const beforeImport = await readBounded(journalUrl, JOURNAL_LIMIT, 'journal source before import');
  assert.equal(sha256(beforeImport.bytes), JOURNAL_SHA256, 'journal source identity immediately before import');
  const journal = await import(journalUrl.href);
  const afterImport = await readBounded(journalUrl, JOURNAL_LIMIT, 'journal source after import');
  assert.equal(sha256(afterImport.bytes), JOURNAL_SHA256, 'journal source identity immediately after import');
  assert.deepEqual(Object.keys(journal).sort(), ['createRunJournal', 'reopen']);
});
