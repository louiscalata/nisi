# Install and use

How to run, install and call Nisi. Back to the [documentation index](README.md).

## Run the demo

Nisi needs Node.js 22 or newer and has no runtime dependencies, so the [v0.3.2 release](https://github.com/louiscalata/nisi/releases/tag/v0.3.2) archive runs as it is. On macOS or Linux:

```bash
mkdir nisi-0.3.2 && cd nisi-0.3.2
curl -fsSLO https://github.com/louiscalata/nisi/releases/download/v0.3.2/nisi-0.3.2.tgz
curl -fsSLO https://github.com/louiscalata/nisi/releases/download/v0.3.2/SHA256SUMS
shasum -a 256 -c SHA256SUMS    # or: sha256sum -c SHA256SUMS
tar -xzf nisi-0.3.2.tgz        # unpacks into ./package
node --version                 # v22 or newer
node package/bin/nisi.mjs --version
node package/bin/nisi.mjs demo
```

In Windows PowerShell, use the same steps with `curl.exe` and the built-in `tar`, and compare `(Get-FileHash nisi-0.3.2.tgz -Algorithm SHA256).Hash.ToLower()` with the hash in `SHA256SUMS`.

From source, `git clone --branch v0.3.2 --depth 1 https://github.com/louiscalata/nisi.git`, then run `node bin/nisi.mjs demo` inside `nisi`.

The demo drafts an intentionally incorrect JavaScript module, runs a syntax check and two assertions, repairs it once and collects a separate review result. It then writes a report to a temporary directory, verifies it by read-back and removes it. Run `node package/examples/workflow.mjs` (or `node examples/workflow.mjs` in a checkout) to keep the report.

The demo calls no model. It treats the candidate as data and never imports it. `--version` prints `0.3.2`, and a completed run prints:

```json
{
  "outcome": "COMPLETED",
  "code": null,
  "repairAttempts": 1,
  "reportStored": true,
  "modelCalls": 0
}
```

## Install the release archive into a project

To use Nisi from your own project, download and check `nisi-0.3.2.tgz` as above, then, in the project folder, install that downloaded file:

```bash
npm install /path/to/nisi-0.3.2.tgz --ignore-scripts
```

Then run the demo:

- macOS, Linux: `./node_modules/.bin/nisi demo`
- Windows PowerShell: `.\node_modules\.bin\nisi.cmd demo`

Nisi is not published to the npm registry; this installs only the file you downloaded. The archive does not install models or start a model server.

## Run Nisi's own checks

In a source checkout, run `npm ci`, then `npm run check`. The demo does not need them.

CI runs on Linux and Windows with Node.js 22 and 24. The [v0.1 verification record](verification.md) covers macOS, and the [Windows hardware check](verification-v0.3-windows.md) covers one real PC.

## Commands

`node bin/nisi.mjs --help` lists the commands.

- `nisi demo` runs the fixed workflow above with no model call.
- `nisi local-model ENDPOINT AUTHOR_MODEL REVIEWER_MODEL` runs one fixed JSON task against a chat server on literal `127.0.0.1` or `[::1]` that you run. It evaluates JSON as data, runs no model-generated program and changes no repository. See [Local models and Jev](local-models.md).
- `nisi validate --journal FILE` or `nisi validate --data-dir DIR` checks a run journal or a directory of journals and workflow reports. `NISI_JOURNAL` or `NISI_DATA_DIR` supplies the path when you omit the flag. The summary does not include payloads. In a source checkout, `scripts/validate-real-data.sh` is the same command, and `--smoke` checks only the synthetic files in `fixtures/sample-data/`.

The command line does not run arbitrary repositories. Applications use the workflow, journal and store APIs directly.

## Call the library

Import `runWorkflow` from `nisi/workflow`. It resolves inside a checkout and after you install the release archive. Start from `examples/workflow.mjs`, then read the [Workflow API](workflow-api.md) for the call shape, the task fields and the callbacks.

For the run journal and its store, see [Run journal and store](run-journal.md).
