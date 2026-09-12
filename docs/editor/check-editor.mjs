// Regression checks for saved HTML and arbitrary user-authored Markdown.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { execFileSync } from 'node:child_process';
import ts from 'typescript';

const source = fs.readFileSync(new URL('./editor.js', import.meta.url), 'utf8');
const html = fs.readFileSync(new URL(process.argv[2] || './index.html', import.meta.url), 'utf8');
const draft = fs.readFileSync(new URL('../README-draft.md', import.meta.url), 'utf8');
const ast = ts.createSourceFile('editor.js', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
function functionSource(name) {
  let found;
  function visit(node) {
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) found = node.getText(ast);
    if (ts.isVariableStatement(node) && node.declarationList.declarations.some(declaration => declaration.name?.text === name)) found = node.getText(ast);
    ts.forEachChild(node, visit);
  }
  visit(ast); assert.ok(found, name); return found;
}
function stateFrom(text) { return JSON.parse(text.match(/<script id="state" type="application\/json">([\s\S]*?)<\/script>/)[1]); }
function documentFor(text) {
  return { getElementById(id) {
    if (id === 'editor-style') return { textContent: text.match(/<style id="editor-style">([\s\S]*?)<\/style>/)[1] };
    if (id === 'editor-app') return { textContent: text.match(/<script id="editor-app">([\s\S]*?)<\/script>/)[1] };
    if (id === 'chrome') return { innerHTML: text.match(/<template id="chrome">([\s\S]*?)<\/template>/)[1] };
    throw new Error(`Unexpected element: ${id}`);
  } };
}
const state = stateFrom(html), context = { state, document: documentFor(html), Date, URL, syncFields() {} };
vm.createContext(context);
vm.runInContext(functionSource('allMarkdown') + '\n' + functionSource('buildDocument'), context);
assert.equal(vm.runInContext('allMarkdown()', context), draft, 'Initial export preserves source bytes');
const tricky = '\n\n## Editor test  \r\nCafé & "quotes"  \r\n</script><script>alert(1)</script>\n```\n# Inside a fence\n```\n';
state.sections[0].current += tricky;
const edited = vm.runInContext('allMarkdown()', context);
let saved = vm.runInContext('buildDocument()', context);
const scriptCount = Number(execFileSync('python3', ['-c', `
from html.parser import HTMLParser
import sys
class Tags(HTMLParser):
    count = 0
    def handle_starttag(self, tag, attrs):
        if tag == 'script': self.count += 1
parser = Tags()
parser.feed(sys.stdin.read())
print(parser.count)
`], { input: saved, encoding: 'utf8' }).trim());
assert.equal(scriptCount, 2, 'User text cannot create a script element');
assert.equal(stateFrom(saved).sections[0].current, state.sections[0].current, 'Save preserves user text exactly');
assert.ok(saved.includes('<template id="chrome">'), 'Saved copy retains its save template');
context.state = stateFrom(saved); context.document = documentFor(saved);
new vm.Script(context.document.getElementById('editor-app').textContent);
saved = vm.runInContext('buildDocument()', context);
context.state = stateFrom(saved); context.document = documentFor(saved);
assert.equal(vm.runInContext('allMarkdown()', context), edited, 'Second save preserves all text and spacing');
assert.equal(context.document.getElementById('editor-app').textContent, source, 'Save leaves app code unescaped and intact');
assert.ok(state.baseRevision && state.baseRevision.length === 64, 'Backups use a source revision');
vm.runInContext(functionSource('safeHref'), context);
assert.equal(vm.runInContext('safeHref("javascript:alert(1)")', context), '#', 'Unsafe link scheme blocked');
assert.equal(vm.runInContext('safeHref("data:text/html,test")', context), '#', 'Data links blocked');
assert.equal(vm.runInContext('safeHref("CONTRIBUTING.md")', context), 'https://github.com/louiscalata/nisi/blob/main/CONTRIBUTING.md');
vm.runInContext(functionSource('esc') + '\n' + functionSource('plateChart'), context);
context.chart = draft.match(/```mermaid\n([\s\S]*?)```/)[1];
const renderedChart = vm.runInContext('plateChart(chart)', context);
assert.ok(renderedChart.includes('Return to step 4; repeat checks, tests and review'), 'Repair resumes checking its replacement candidate');
context.chart = context.chart.replace('repair --> checks', 'repair --> cook');
assert.equal(vm.runInContext('plateChart(chart)', context), null, 'Unsupported repair path remains visible as source instead of a misleading chart');
console.log(JSON.stringify({ status: 'PASS', checks: 12, sections: state.sections.length, secondSaveRoundTrip: true, markdownByteParity: true, repairResumesChecks: true }));
