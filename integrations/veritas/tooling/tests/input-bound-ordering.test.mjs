import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import vm from "node:vm";
import ts from "typescript";

// Exercise the actual private helpers without running the CLI, exporting product
// internals, or opening a store. AST extraction fails closed on missing names.
const source = readFileSync(new URL("../../veritas.ts", import.meta.url), "utf8");
const ast = ts.createSourceFile("veritas.ts", source, ts.ScriptTarget.Latest, true);
assert.equal(ast.parseDiagnostics.length, 0);
const names = [
  "VeritasError", "fail", "hasLoneUtf16Surrogate",
  "M46_DEPENDENCY_GRAPH_LIMITS", "M46_RECALL_LIMITS", "M47_ORACLE_LIMITS",
  "M47B_REDUCER_LIMITS", "M4J_JOURNEY_LIMITS", "FI0_LIMITS", "C5_COMPONENT_LIMITS",
  "m46DependencyNodeId", "m46RecallId", "m47OracleId", "m47bReducerId",
  "m4jJourneyId", "fi0Identifier", "c5F3B2E1IsBoundedText",
  "validateC5ComponentVector", "gitBasePortableNameKey",
];
const declarations = new Map();
for (const statement of ast.statements) {
  if ((ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)) && statement.name) {
    assert.equal(declarations.has(statement.name.text), false);
    declarations.set(statement.name.text, statement.getText(ast));
  } else if (ts.isVariableStatement(statement)) {
    for (const declaration of statement.declarationList.declarations) {
      if (ts.isIdentifier(declaration.name)) {
        assert.equal(declarations.has(declaration.name.text), false);
        declarations.set(declaration.name.text, `const ${declaration.getText(ast)};`);
      }
    }
  }
}
const helpers = stripTypeScriptTypes(names.map((name) => {
  assert.ok(declarations.has(name), `missing source declaration: ${name}`);
  return declarations.get(name);
}).join("\n"));

function fixture() {
  const metrics = { bytes: 0, normalize: 0 };
  const context = vm.createContext({
    Buffer: { byteLength: (...args) => { metrics.bytes += 1; return Buffer.byteLength(...args); } },
    recordNormalization: () => { metrics.normalize += 1; },
  });
  vm.runInContext(`${helpers}
    const originalNormalize = String.prototype.normalize;
    String.prototype.normalize = function(...args) {
      recordNormalization();
      return originalNormalize.apply(this, args);
    };
    globalThis.subjects = [
      ["m46-node", M46_DEPENDENCY_GRAPH_LIMITS.maxNodeIdBytes, "M46_DEPENDENCY_NODE_ID_INVALID", m46DependencyNodeId],
      ["m46-receipt", M46_RECALL_LIMITS.maxReceiptIdBytes, "M46_RECALL_ID_INVALID", v => m46RecallId(v, "receipt")],
      ["m46-event", M46_RECALL_LIMITS.maxEventIdBytes, "M46_RECALL_ID_INVALID", v => m46RecallId(v, "event")],
      ...["check", "record", "vector", "dependency", "owner"].map(label =>
        ["m47-" + label, M47_ORACLE_LIMITS.maxCheckIdBytes, "M47_ORACLE_ID_INVALID", v => m47OracleId(v, label)]),
      ...["event", "receipt", "node"].map(label =>
        ["m47b-" + label, M47B_REDUCER_LIMITS["max" + label[0].toUpperCase() + label.slice(1) + "IdBytes"], "M47B_REDUCER_ID_INVALID", v => m47bReducerId(v, label)]),
      ...["operation", "path", "scope", "receipt", "node"].map(label =>
        ["m4j-" + label, M4J_JOURNEY_LIMITS.maxStageIdBytes, "M4J_JOURNEY_ID_INVALID", v => m4jJourneyId(v, label)]),
      ["fi0", FI0_LIMITS.maxIdentifierBytes, "FI0_IDENTIFIER_INVALID", v => fi0Identifier(v, "test")],
      ["c5-text", 128, null, v => c5F3B2E1IsBoundedText(v, 1, 128)],
      ["c5-component", C5_COMPONENT_LIMITS.maxComponentBytes, "C5_COMPONENT_VECTOR_INVALID", v => validateC5ComponentVector([v], "test")],
      ["git-name", 255, "GIT_BASE_PATH_INVALID", gitBasePortableNameKey],
    ];`, context, { timeout: 1000 });
  return { subjects: context.subjects, metrics };
}

function refuses(invoke, value, code) {
  if (code === null) assert.equal(invoke(value), false);
  else assert.throws(() => invoke(value), (error) => error.name === "VeritasError" && error.code === code);
}

for (const [name, maximum] of fixture().subjects) {
  test(`${name}: oversized strings refuse before any byte scan or normalization`, () => {
    const { subjects, metrics } = fixture();
    const [, , code, invoke] = subjects.find(([id]) => id === name);
    for (const value of ["a".repeat(maximum + 1), "e\u0301".repeat(maximum + 1)]) {
      refuses(invoke, value, code);
      assert.deepEqual(metrics, { bytes: 0, normalize: 0 });
    }
  });

  test(`${name}: UTF-8 overflow refuses before normalization even within code-unit cap`, () => {
    const { subjects, metrics } = fixture();
    const [, , code, invoke] = subjects.find(([id]) => id === name);
    const value = "é".repeat(Math.floor(maximum / 2) + 1);
    assert.ok(value.length <= maximum && Buffer.byteLength(value) > maximum);
    refuses(invoke, value, code);
    assert.deepEqual(metrics, { bytes: 1, normalize: 0 });
  });

  test(`${name}: exact ASCII limit still passes through canonical validation`, () => {
    const { subjects, metrics } = fixture();
    const [, , , invoke] = subjects.find(([id]) => id === name);
    assert.doesNotThrow(() => assert.notEqual(invoke("a".repeat(maximum)), false));
    assert.equal(metrics.normalize, 1);
  });

  test(`${name}: short noncanonical text and forbidden control characters still refuse`, () => {
    const { subjects } = fixture();
    const [, , code, invoke] = subjects.find(([id]) => id === name);
    refuses(invoke, "e\u0301", code);
    refuses(invoke, "a\u0000b", code);
  });
}

test("Unicode text/component/name profiles retain exact multibyte boundaries", () => {
  const { subjects } = fixture();
  for (const name of ["c5-text", "c5-component", "git-name"]) {
    const [, maximum, code, invoke] = subjects.find(([id]) => id === name);
    const value = "é".repeat(Math.floor(maximum / 2)) + (maximum % 2 ? "a" : "");
    assert.equal(Buffer.byteLength(value), maximum);
    assert.notEqual(invoke(value), false);
    refuses(invoke, value + "a", code);
  }
});

test("ordering control: the pre-fix pattern really reaches normalization before refusing", () => {
  const { metrics } = fixture();
  const context = vm.createContext({
    Buffer,
    observed: () => { metrics.normalize += 1; },
  });
  const oldGuard = vm.runInContext(`
    String.prototype.normalize = function() { observed(); return String(this); };
    value => typeof value !== "string" || value.normalize("NFC") !== value || Buffer.byteLength(value, "utf8") > 128
  `, context);
  assert.equal(oldGuard("a".repeat(129)), true);
  assert.equal(metrics.normalize, 1);
});
