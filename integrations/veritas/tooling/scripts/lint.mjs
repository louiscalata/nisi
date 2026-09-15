import { ESLint } from "eslint";
import { relative, resolve } from "node:path";

import {
  emitDeterministic,
  repositoryRoot,
  sha256Canonical,
  toolingRoot,
} from "./common.mjs";

const eslint = new ESLint({
  cwd: repositoryRoot,
  overrideConfigFile: resolve(toolingRoot, "eslint.config.mjs"),
  errorOnUnmatchedPattern: true,
  fix: false,
});
const results = await eslint.lintFiles([resolve(repositoryRoot, "veritas.ts")]);
const messages = results.flatMap((result) =>
  result.messages.map((message) => ({
    column: message.column,
    endColumn: message.endColumn ?? null,
    endLine: message.endLine ?? null,
    file: relative(repositoryRoot, result.filePath),
    line: message.line,
    message: message.message,
    ruleId: message.ruleId ?? null,
    severity: message.severity,
  })),
);
const errorCount = results.reduce((sum, result) => sum + result.errorCount, 0);
const warningCount = results.reduce((sum, result) => sum + result.warningCount, 0);
const output = {
  schemaVersion: 1,
  status: errorCount === 0 && warningCount === 0 ? "PASS" : "FAIL",
  files: results.map((result) => relative(repositoryRoot, result.filePath)).sort(),
  errorCount,
  warningCount,
  messages,
  resultDigest: sha256Canonical({ errorCount, warningCount, messages }),
};
emitDeterministic(output);
if (output.status !== "PASS" || output.files.length !== 1 || output.files[0] !== "veritas.ts") {
  process.exitCode = 1;
}
