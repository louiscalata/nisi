import { readFile } from "node:fs/promises";
import ts from "typescript";
const path = process.argv[2];
const text = await readFile(path, "utf8");
const B = "// PURE-REGION-BEGIN", E = "// PURE-REGION-END";
const begin = text.indexOf(B), end = text.indexOf(E) + E.length;
const forbiddenCalls = new Map([
  ["process-spawn", /(?:^|\.)(?:spawn|spawnSync|exec|execSync|execFile|execFileSync|fork)$/u],
  ["filesystem-write", /(?:^|\.)(?:writeFile|writeFileSync|appendFile|appendFileSync|rename|renameSync|unlink|unlinkSync|rm|rmSync|rmdir|rmdirSync|mkdir|mkdirSync|chmod|chmodSync|chown|chownSync|truncate|truncateSync)$/u],
  ["network-effect", /(?:^|\.)(?:fetch|connect|createConnection|createServer|listen)$/u],
  ["dynamic-code", /(?:^|\.)(?:eval|Function)$/u],
  ["module-load", /(?:^|\.)(?:require|dlopen)$/u],
  ["process-mutation", /^process\.(?:exit|kill|chdir|umask|setuid|setgid|seteuid|setegid|setgroups)$/u],
]);
const sf = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
if (sf.parseDiagnostics.length) { console.log("PARSE FAIL", sf.parseDiagnostics.length); process.exit(1); }
const findings = [];
function visit(node) {
  const s = node.getStart(sf, false), e = node.getEnd();
  if (e < begin || s > end) return;
  if (s >= begin && e <= end) {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node) || ts.isExportAssignment(node)) findings.push(["module-surface", node.getText(sf)]);
    if (ts.isCallExpression(node)) {
      if (node.expression.kind === ts.SyntaxKind.ImportKeyword) findings.push(["dynamic-import", node.getText(sf)]);
      else { const ex = node.expression.getText(sf); for (const [r, p] of forbiddenCalls) if (p.test(ex)) findings.push([r, ex]); }
    }
    if (ts.isNewExpression(node)) { const ex = node.expression.getText(sf); if (/^(?:Function|Worker|SharedWorker|WebSocket)$/u.test(ex)) findings.push(["dynamic-or-worker-construction", ex]); }
  }
  ts.forEachChild(node, visit);
}
visit(sf);
console.log("pure-region findings:", findings.length, JSON.stringify(findings));
// imports anywhere
const imports = [];
for (const st of sf.statements) if (ts.isImportDeclaration(st)) imports.push(st.moduleSpecifier.getText(sf));
console.log("imports:", JSON.stringify(imports));
