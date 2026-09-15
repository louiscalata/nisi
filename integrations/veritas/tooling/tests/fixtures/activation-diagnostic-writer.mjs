// Test-only fixed writer for a real process overlapping a diagnostic snapshot.
import { readFileSync, writeSync } from "node:fs";
import { claimActivationAttempt } from "../../learning/activation-journal.ts";
const input = readFileSync(0, "utf8");
if (input.length > 8192) throw new Error("fixture input bound");
const { root, project, requestText } = JSON.parse(input);
writeSync(1, JSON.stringify(claimActivationAttempt(root, project, requestText)) + "\n");
