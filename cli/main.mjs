// Import-pure dispatcher. The binary owns streams/exit status; the demo retains
// its existing approval, signal handling, model and candidate admission rules.
import { parseNisiArguments } from './arguments.mjs';
import { CLI_HELP, CLI_VERSION, errorOutput } from './text.mjs';

export async function runNisiCli(args) {
  try {
    const parsed = parseNisiArguments(args);
    if (parsed.command === 'help') return { exitCode: 0, stdout: CLI_HELP, stderr: '' };
    if (parsed.command === 'version') return { exitCode: 0, stdout: CLI_VERSION + '\n', stderr: '' };
    if (parsed.command === 'doctor') {
      const { collectNisiDoctor } = await import('./doctor.mjs');
      const report = await collectNisiDoctor();
      return { exitCode: report.exitCode, stdout: JSON.stringify(report, null, 2) + '\n', stderr: '' };
    }
    if (parsed.command === 'inspect') {
      const { inspectNisiRunDirectoryV1 } = await import('./inspect.mjs');
      const result = inspectNisiRunDirectoryV1(parsed.args[0]);
      // Exit zero is successful observation, never acceptance of the stored run.
      return { exitCode: 0, stdout: JSON.stringify(result, null, 2) + '\n', stderr: '' };
    }
    if (parsed.command === 'inspect-trial') {
      const { inspectTrialDirectoryV1 } = await import('./paired-trial-inspect.mjs');
      const result = inspectTrialDirectoryV1(parsed.args[0]);
      // Operational refusal is a bounded report; malformed usage stays stderr.
      return { exitCode: result.exitCode, stdout: JSON.stringify(result, null, 2) + '\n', stderr: '' };
    }
    if (parsed.command === 'inspect-arm-trial') {
      const { inspectArmTrialDirectoryV1 } = await import('./paired-arm-inspect.mjs');
      const result = inspectArmTrialDirectoryV1(parsed.args[0]);
      return { exitCode: result.exitCode, stdout: JSON.stringify(result, null, 2) + '\n', stderr: '' };
    }
    if (parsed.command === 'inspect-trial-diagnostic') {
      const { inspectTrialDiagnosticFileV1 } = await import('./paired-trial-diagnostic-inspect.mjs');
      const result = inspectTrialDiagnosticFileV1(parsed.args[0]);
      return { exitCode: result.exitCode, stdout: JSON.stringify(result, null, 2) + '\n', stderr: '' };
    }
    if (parsed.command !== 'demo') throw Object.assign(Error(), { code: 'NISI_CLI_ARGUMENTS' });
    const { runPrivateLiveDemo } = await import('../examples/repository-live-model.mjs');
    // Always require explicit external storage through the new CLI. The legacy
    // direct example retains its default; no installed/check-out marker fallback.
    const result = await runPrivateLiveDemo(parsed.args, { requireExternalState: true });
    if (![0, 1, 2].includes(result?.exitCode)) throw Object.assign(Error(), { code: 'NISI_CLI_RESULT' });
    return { exitCode: result.exitCode, stdout: JSON.stringify(result, null, 2) + '\n', stderr: '' };
  } catch (error) { return errorOutput(error); }
}
