#!/usr/bin/env node
// Copyright 2026 Louis Calata
// SPDX-License-Identifier: Apache-2.0
import { realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const MINIMUM_NODE_MAJOR = 22;
const runtimeMajor = Number.parseInt(process.versions.node.split('.')[0], 10);
const packageMetadata = runtimeMajor >= MINIMUM_NODE_MAJOR
  ? createRequire(import.meta.url)('../package.json')
  : { version: 'unavailable' };

const HELP = `Nisi ${packageMetadata.version}

Usage:
  nisi --help
  nisi --version
  nisi demo
  nisi local-model ENDPOINT AUTHOR_MODEL REVIEWER_MODEL

Commands:
  demo          Run the deterministic workflow example. No model is called.
  local-model   Run the JSON workflow against two configured loopback models.

The local-model command may make inference requests to the endpoint you provide.
`;

const USAGE_ERROR = `Invalid command or arguments. Run "nisi --help" for usage.`;
const MAX_ENDPOINT_LENGTH = 2_048;
const MAX_MODEL_NAME_LENGTH = 128;

const writeLine = (stream, value) => stream.write(`${value}\n`);

function summarize(report) {
  return {
    outcome: report?.outcome ?? 'ERROR',
    code: report?.code ?? null,
    repairAttempts: Number.isSafeInteger(report?.repairAttempts) ? report.repairAttempts : 0,
  };
}

export async function runCli(args, options = {}) {
  const stdout = options.stdout ?? process.stdout;
  const stderr = options.stderr ?? process.stderr;
  const nodeVersion = options.nodeVersion ?? process.versions.node;
  const currentMajor = typeof nodeVersion === 'string'
    ? Number.parseInt(nodeVersion.split('.')[0], 10)
    : Number.NaN;
  if (!Number.isSafeInteger(currentMajor) || currentMajor < MINIMUM_NODE_MAJOR) {
    writeLine(stderr, 'Nisi requires Node.js 22 or newer.');
    return 2;
  }
  if (!Array.isArray(args) || args.some(value => typeof value !== 'string')) {
    writeLine(stderr, USAGE_ERROR);
    return 2;
  }

  if (args.length === 1 && (args[0] === '--help' || args[0] === '-h')) {
    writeLine(stdout, HELP.trimEnd());
    return 0;
  }
  if (args.length === 1 && (args[0] === '--version' || args[0] === '-V')) {
    writeLine(stdout, packageMetadata.version);
    return 0;
  }

  if (args.length === 1 && args[0] === 'demo') {
    try {
      const runExample = options.runExample ?? (await import('../examples/workflow.mjs')).runExample;
      const { report } = await runExample();
      writeLine(stdout, JSON.stringify({ ...summarize(report), reportStored: report?.reportStored === true, modelCalls: 0 }, null, 2));
      return report?.outcome === 'COMPLETED' && report?.reportStored === true ? 0 : 1;
    } catch {
      writeLine(stderr, 'The deterministic workflow demo failed.');
      return 1;
    }
  }

  if (args[0] === 'local-model' && args.length === 4) {
    const [, endpoint, authorModel, reviewerModel] = args;
    if (endpoint.length > MAX_ENDPOINT_LENGTH || authorModel.length > MAX_MODEL_NAME_LENGTH || reviewerModel.length > MAX_MODEL_NAME_LENGTH) {
      writeLine(stderr, USAGE_ERROR);
      return 2;
    }
    let local;
    let config;
    try {
      local = options.localModel ?? await import('../examples/local-model-workflow.mjs');
      config = local.parseLocalModelCLI([endpoint, authorModel, reviewerModel]);
    } catch {
      writeLine(stderr, USAGE_ERROR);
      return 2;
    }
    try {
      const result = await local.runLocalModelExample(config);
      const report = result?.report;
      const output = {
        ...summarize(report),
        authorCalls: Array.isArray(result?.authorReceipts) ? result.authorReceipts.length : 0,
        reviewerCalls: Array.isArray(result?.reviewerReceipts) ? result.reviewerReceipts.length : 0,
      };
      writeLine(stdout, JSON.stringify(output, null, 2));
      return report?.outcome === 'COMPLETED' ? 0 : 1;
    } catch {
      // Deliberately omit provider errors because they can contain configured
      // endpoint or model input. Never echo CLI arguments in diagnostics.
      writeLine(stderr, 'The local-model workflow failed. Check the local endpoint and model configuration.');
      return 1;
    }
  }

  writeLine(stderr, USAGE_ERROR);
  return 2;
}

let invokedAsMain = false;
try {
  invokedAsMain = Boolean(process.argv[1]) && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href;
} catch {
  // A missing argv path means this module was imported, not invoked.
}
if (invokedAsMain) {
  process.exitCode = await runCli(process.argv.slice(2));
}
