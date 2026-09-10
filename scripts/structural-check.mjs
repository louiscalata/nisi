// Copyright 2026 Louis Calata
// SPDX-License-Identifier: Apache-2.0

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import ts from "typescript";

import {
  emitDeterministic,
  readJson,
  repositoryRoot,
  sha256Canonical,
  sha256Bytes,
} from "./common.mjs";

const beginMarker = "// PURE-REGION-BEGIN";
const endMarker = "// PURE-REGION-END";
const forbiddenCalls = new Map([
  ["process-spawn", /(?:^|\.)(?:spawn|spawnSync|exec|execSync|execFile|execFileSync|fork)$/u],
  ["filesystem-write", /(?:^|\.)(?:writeFile|writeFileSync|appendFile|appendFileSync|rename|renameSync|unlink|unlinkSync|rm|rmSync|rmdir|rmdirSync|mkdir|mkdirSync|chmod|chmodSync|chown|chownSync|truncate|truncateSync)$/u],
  ["network-effect", /(?:^|\.)(?:fetch|connect|createConnection|createServer|listen)$/u],
  ["dynamic-code", /(?:^|\.)(?:eval|Function)$/u],
  ["module-load", /(?:^|\.)(?:require|dlopen)$/u],
  ["process-mutation", /^process\.(?:exit|kill|chdir|umask|setuid|setgid|seteuid|setegid|setgroups)$/u],
]);

function findMarkerRange(text) {
  const begin = text.indexOf(beginMarker);
  const end = text.indexOf(endMarker);
  if (begin < 0 || end < 0 || begin !== text.lastIndexOf(beginMarker) || end !== text.lastIndexOf(endMarker) || begin >= end) {
    throw new Error("Pure-region markers must exist exactly once, in order.");
  }
  return { begin, end: end + endMarker.length };
}

function inspectSource(text, filename) {
  const range = findMarkerRange(text);
  const sourceFile = ts.createSourceFile(filename, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  if (sourceFile.parseDiagnostics.length > 0) {
    const diagnostics = sourceFile.parseDiagnostics.map((diagnostic) => ({
      code: diagnostic.code,
      start: diagnostic.start ?? null,
      length: diagnostic.length ?? null,
      message: ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"),
    }));
    throw new Error(`Structural input does not parse: ${JSON.stringify({ filename, diagnostics })}`);
  }
  const findings = [];
  function record(rule, node, detail) {
    const position = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
    findings.push({
      rule,
      detail,
      line: position.line + 1,
      column: position.character + 1,
    });
  }
  function visit(node) {
    const start = node.getStart(sourceFile, false);
    const end = node.getEnd();
    if (end < range.begin || start > range.end) return;
    if (start >= range.begin && end <= range.end) {
      if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node) || ts.isExportAssignment(node)) {
        record("module-surface", node, node.getText(sourceFile));
      }
      if (ts.isCallExpression(node)) {
        if (node.expression.kind === ts.SyntaxKind.ImportKeyword) {
          record("dynamic-import", node, node.getText(sourceFile));
        } else {
          const expression = node.expression.getText(sourceFile);
          for (const [rule, pattern] of forbiddenCalls) {
            if (pattern.test(expression)) record(rule, node, expression);
          }
        }
      }
      if (ts.isNewExpression(node)) {
        const expression = node.expression.getText(sourceFile);
        if (/^(?:Function|Worker|SharedWorker|WebSocket)$/u.test(expression)) {
          record("dynamic-or-worker-construction", node, expression);
        }
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return findings;
}

const subject = "canonical/canonical-json-v1.mjs";
const sourcePath = resolve(repositoryRoot, subject);
const sourceText = await readFile(sourcePath, "utf8");
const sourceFindings = inspectSource(sourceText, subject);
const fixtures = await readJson(resolve(repositoryRoot, "contracts/structural-fixtures.json"));
const mutationResults = fixtures.mutations.map((fixture) => {
  const wrapped = `${beginMarker}\n${fixture.source}\n${endMarker}\n`;
  const findings = inspectSource(wrapped, `${fixture.id}.ts`);
  return {
    id: fixture.id,
    expectedRule: fixture.expectedRule,
    observedRules: [...new Set(findings.map((finding) => finding.rule))].sort(),
    caught: findings.some((finding) => finding.rule === fixture.expectedRule),
  };
});
const positiveResults = fixtures.allowed.map((fixture) => {
  const wrapped = `${beginMarker}\n${fixture.source}\n${endMarker}\n`;
  const findings = inspectSource(wrapped, `${fixture.id}.ts`);
  return { id: fixture.id, findingCount: findings.length };
});
const status =
  sourceFindings.length === 0 &&
  mutationResults.every((result) => result.caught) &&
  positiveResults.every((result) => result.findingCount === 0)
    ? "PASS"
    : "FAIL";
const output = {
  schemaVersion: 1,
  status,
  sourceDigest: sha256Bytes(sourceText),
  sourceFindings,
  mutationResults,
  positiveResults,
  resultDigest: sha256Canonical({ sourceFindings, mutationResults, positiveResults }),
};
emitDeterministic(output);
if (status !== "PASS") process.exitCode = 1;
