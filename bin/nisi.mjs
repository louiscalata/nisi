#!/usr/bin/env node
// Copyright 2026 Louis Calata
// SPDX-License-Identifier: Apache-2.0
import { realpathSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const MINIMUM_NODE_MAJOR = 22;
const runtimeMajor = Number.parseInt(process.versions.node.split('.')[0], 10);
const physicalEntry = realpathSync(fileURLToPath(import.meta.url));
const physicalEntryURL = pathToFileURL(physicalEntry);
const packageMetadata = runtimeMajor >= MINIMUM_NODE_MAJOR
  ? createRequire(physicalEntryURL)('../package.json')
  : { version: 'unavailable' };

const MAX_ENDPOINT_LENGTH = 2_048;
const MAX_MODEL_NAME_LENGTH = 128;

const HELP = `Nisi ${packageMetadata.version}

Usage:
  nisi --help
  nisi --version
  nisi demo
  nisi local-model ENDPOINT AUTHOR_MODEL REVIEWER_MODEL

Commands:
  demo          Run the deterministic workflow example. No model is called.
  local-model   Run the JSON workflow against two configured loopback models.

local-model arguments:
  ENDPOINT        Full chat-completions URL over http:// at 127.0.0.1 or [::1],
                  such as http://127.0.0.1:1234/v1/chat/completions, at most
                  ${MAX_ENDPOINT_LENGTH} characters. Hostnames such as localhost, HTTPS,
                  credentials, query and fragment are refused.
  AUTHOR_MODEL    Configured model names, each non-blank and at most ${MAX_MODEL_NAME_LENGTH}
  REVIEWER_MODEL  characters. The two names must differ.

The local-model command may make inference requests to the endpoint you provide.
`;

const USAGE_ERROR = `Invalid command or arguments. Run "nisi --help" for usage.`;
const WORKFLOW_DIRECTORY_PREFIX = 'nisi-workflow-';
const ENDPOINT_RULE = 'use a full http:// chat-completions URL at 127.0.0.1 or [::1]; hostnames such as localhost, HTTPS, credentials, query and fragment are refused';
const MODEL_NAME_RULE = `use a non-blank configured model name of at most ${MAX_MODEL_NAME_LENGTH} characters`;

// Only fixed upper-case identifiers are printed. Error messages, paths, receipt
// fields and CLI arguments can carry configured input and are never echoed.
const fixedCode = value => typeof value === 'string' && /^[A-Z][A-Z0-9_]{0,63}$/.test(value) ? value : null;
const withCode = (text, value) => fixedCode(value) ? `${text} (${value})` : text;
const lastReceiptCode = receipts => Array.isArray(receipts) ? fixedCode(receipts.at(-1)?.code) : null;

function writeLine(stream, value) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const cleanup = ({ retainErrorListener = false } = {}) => {
      if (!retainErrorListener) stream.removeListener('error', onError);
      stream.removeListener('close', onClose);
    };
    const finish = (error, retainErrorListener = false) => {
      if (settled) return;
      settled = true;
      cleanup({ retainErrorListener });
      if (error) reject(error);
      else resolve();
    };
    const onError = error => finish(error ?? new Error('Output stream failed.'));
    const onClose = () => finish(new Error('Output stream closed before the write completed.'));
    stream.once('error', onError);
    stream.once('close', onClose);
    try {
      stream.write(`${value}\n`, error => finish(error, Boolean(error)));
    } catch (error) {
      finish(error);
    }
  });
}

async function emit(stream, value) {
  try {
    await writeLine(stream, value);
    return true;
  } catch {
    return false;
  }
}

function summarize(report) {
  return {
    outcome: report?.outcome ?? 'ERROR',
    code: report?.code ?? null,
    repairAttempts: Number.isSafeInteger(report?.repairAttempts) ? report.repairAttempts : 0,
  };
}

async function refuseArguments(stderr, subject, code, rule) {
  await emit(stderr, `${USAGE_ERROR}\nlocal-model refused ${subject} (${code}): ${rule}.`);
  return 2;
}

export async function runCli(args, options = {}) {
  const stdout = options.stdout ?? process.stdout;
  const stderr = options.stderr ?? process.stderr;
  const nodeVersion = options.nodeVersion ?? process.versions.node;
  const currentMajor = typeof nodeVersion === 'string'
    ? Number.parseInt(nodeVersion.split('.')[0], 10)
    : Number.NaN;
  if (!Number.isSafeInteger(currentMajor) || currentMajor < MINIMUM_NODE_MAJOR) {
    await emit(stderr, 'Nisi requires Node.js 22 or newer.');
    return 2;
  }
  if (!Array.isArray(args) || args.some(value => typeof value !== 'string')) {
    await emit(stderr, USAGE_ERROR);
    return 2;
  }

  if (args.length === 1 && (args[0] === '--help' || args[0] === '-h')) {
    return await emit(stdout, HELP.trimEnd()) ? 0 : 2;
  }
  if (args.length === 1 && (args[0] === '--version' || args[0] === '-V')) {
    return await emit(stdout, packageMetadata.version) ? 0 : 2;
  }

  if (args.length === 1 && args[0] === 'demo') {
    let directory;
    try {
      const runExample = options.runExample ?? (await import(new URL('../examples/workflow.mjs', physicalEntryURL).href)).runExample;
      const result = await runExample();
      directory = result?.directory;
      const report = result?.report;
      const written = await emit(stdout, JSON.stringify({ ...summarize(report), reportStored: report?.reportStored === true, modelCalls: 0 }, null, 2));
      if (!written) return 2;
      return report?.outcome === 'COMPLETED' && report?.reportStored === true ? 0 : 1;
    } catch (error) {
      // The demo takes no input, so a fixed cause code such as ENOENT is safe to print.
      return await emit(stderr, `${withCode('The deterministic workflow demo failed', error?.code)}.`) ? 1 : 2;
    } finally {
      // The store read the report back and verified its digest before the summary
      // was written. Remove only the demo's own mkdtemp directory.
      if (typeof directory === 'string' && path.basename(directory).startsWith(WORKFLOW_DIRECTORY_PREFIX)) {
        try {
          await rm(directory, { recursive: true, force: true, maxRetries: 5 });
        } catch (error) {
          await emit(stderr, `${withCode(`The deterministic workflow demo could not remove its ${WORKFLOW_DIRECTORY_PREFIX}* temporary directory`, error?.code)}.`);
        }
      }
    }
  }

  if (args[0] === 'local-model') {
    // Refusals name the argument and its rule by placeholder, never by value.
    if (args.length !== 4) {
      return refuseArguments(stderr, 'its arguments', 'LOCAL_MODEL_ARGUMENT_COUNT', 'give exactly ENDPOINT, AUTHOR_MODEL and REVIEWER_MODEL');
    }
    const [, endpoint, authorModel, reviewerModel] = args;
    if (endpoint.length > MAX_ENDPOINT_LENGTH) {
      return refuseArguments(stderr, 'ENDPOINT', 'LOCAL_MODEL_ARGUMENT_TOO_LONG', `use at most ${MAX_ENDPOINT_LENGTH} characters`);
    }
    for (const [subject, name] of [['AUTHOR_MODEL', authorModel], ['REVIEWER_MODEL', reviewerModel]]) {
      if (name.length > MAX_MODEL_NAME_LENGTH) return refuseArguments(stderr, subject, 'LOCAL_MODEL_ARGUMENT_TOO_LONG', MODEL_NAME_RULE);
      if (name.trim() === '') return refuseArguments(stderr, subject, 'LOCAL_MODEL_NAME_BLANK', MODEL_NAME_RULE);
    }
    if (authorModel.trim() === reviewerModel.trim()) {
      return refuseArguments(stderr, 'AUTHOR_MODEL and REVIEWER_MODEL', 'LOCAL_MODEL_NAMES_EQUAL', 'use two different configured model names');
    }
    // Loading is separate from argument parsing so that a broken installation is
    // never reported as a usage error.
    let local;
    let chat;
    try {
      local = options.localModel ?? await import(new URL('../examples/local-model-workflow.mjs', physicalEntryURL).href);
      chat = await import(new URL('../adapters/local-chat.mjs', physicalEntryURL).href);
      if (typeof local?.parseLocalModelCLI !== 'function' || typeof local?.runLocalModelExample !== 'function'
        || typeof chat.createLocalChatAuthorAdapter !== 'function') {
        throw Object.assign(new TypeError('Local-model workflow exports are missing.'), { code: 'LOCAL_MODEL_EXPORTS_MISSING' });
      }
    } catch (error) {
      return await emit(stderr, `${withCode('The local-model workflow could not be loaded', error?.code)}. Reinstall Nisi.`) ? 1 : 2;
    }
    // The adapter owns the destination rule; a placeholder model isolates ENDPOINT.
    try {
      chat.createLocalChatAuthorAdapter({ destination: 'LOOPBACK_HTTP', endpoint: endpoint.trim(), model: 'endpoint-check', id: 'local.author',
        fetch: () => { throw new Error('Argument validation must not request inference.'); } });
    } catch (error) {
      return refuseArguments(stderr, 'ENDPOINT', fixedCode(error?.code) ?? 'LOCAL_MODEL_ARGUMENTS_INVALID', ENDPOINT_RULE);
    }
    let config;
    try {
      config = local.parseLocalModelCLI([endpoint, authorModel, reviewerModel]);
    } catch {
      return refuseArguments(stderr, 'its arguments', 'LOCAL_MODEL_ARGUMENTS_INVALID', 'see the argument rules in "nisi --help"');
    }
    try {
      const result = await local.runLocalModelExample(config);
      const report = result?.report;
      const output = {
        ...summarize(report),
        authorCalls: Array.isArray(result?.authorReceipts) ? result.authorReceipts.length : 0,
        reviewerCalls: Array.isArray(result?.reviewerReceipts) ? result.reviewerReceipts.length : 0,
        // A failed last call leaves the adapter's fixed code on its receipt, such as
        // LOCAL_CHAT_UNAVAILABLE or LOCAL_CHAT_MODEL_MISMATCH; otherwise null.
        authorCode: lastReceiptCode(result?.authorReceipts),
        reviewerCode: lastReceiptCode(result?.reviewerReceipts),
      };
      if (!await emit(stdout, JSON.stringify(output, null, 2))) return 2;
      return report?.outcome === 'COMPLETED' ? 0 : 1;
    } catch {
      // Deliberately omit provider errors because they can contain configured
      // endpoint or model input. Never echo CLI arguments in diagnostics.
      return await emit(stderr, 'The local-model workflow failed. Check the local endpoint and model configuration.') ? 1 : 2;
    }
  }

  await emit(stderr, USAGE_ERROR);
  return 2;
}

let invokedAsMain = false;
try {
  invokedAsMain = Boolean(process.argv[1]) && realpathSync(process.argv[1]) === physicalEntry;
} catch {
  // A missing argv path means this module was imported, not invoked.
}
if (invokedAsMain) {
  process.exitCode = await runCli(process.argv.slice(2));
}
