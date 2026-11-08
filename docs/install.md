# Install and use

How to run, install and call Nisi. Back to the [documentation index](README.md).

## Run the demo

Install Node.js 22 or newer, then:

```bash
git clone --branch v0.3.0 --depth 1 https://github.com/louiscalata/nisi.git
cd nisi
node bin/nisi.mjs demo
```

The demo drafts an intentionally incorrect JavaScript module, runs a syntax check and two assertions, repairs it once and collects a separate review result. It then writes a report to a temporary directory, verifies it by read-back and removes it. Run `node examples/workflow.mjs` to keep the report.

The demo calls no model. It treats the candidate as data and never imports it. A completed run prints:

```json
{
  "outcome": "COMPLETED",
  "code": null,
  "repairAttempts": 1,
  "reportStored": true,
  "modelCalls": 0
}
```

## Install the release archive

Download `nisi-0.3.0.tgz` from the [GitHub release](https://github.com/louiscalata/nisi/releases/tag/v0.3.0). In a new folder, run:

```bash
npm install /path/to/nisi-0.3.0.tgz --ignore-scripts
```

Then run the demo:

- macOS, Linux: `./node_modules/.bin/nisi demo`
- Windows PowerShell: `.\node_modules\.bin\nisi.cmd demo`

Nisi is not published to the npm registry. The archive does not install models or start a model server.

## Run Nisi's own checks

In a source checkout, run `npm ci`, then `npm run check`. The demo does not need them.

CI runs on Linux and Windows with Node.js 22 and 24. The [v0.1 verification record](verification.md) covers macOS, and the [Windows hardware check](verification-v0.3-windows.md) covers one real PC.

## Commands

`node bin/nisi.mjs --help` lists the commands.

- `nisi demo` runs the fixed workflow above with no model call.
- `nisi local-model ENDPOINT AUTHOR_MODEL REVIEWER_MODEL` runs one fixed JSON task against a chat server on literal `127.0.0.1` or `[::1]` that you run. It evaluates JSON as data, runs no model-generated program and changes no repository. See [Local models and Jev](local-models.md).

The command line does not run arbitrary repositories. Applications use the workflow, journal and store APIs directly.

## Call the library

Import `runWorkflow` from `nisi/workflow`. It resolves inside a checkout and after you install the release archive. Start from `examples/workflow.mjs`, then read the [Workflow API](workflow-api.md) for the call shape, the task fields and the callbacks.

For the run journal and its store, see [Run journal and store](run-journal.md).
