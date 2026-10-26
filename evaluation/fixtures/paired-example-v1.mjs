// SYNTHETIC paired-evaluation fixture — no inference, no measurement.
// Every value here is explicitly synthetic: digest fields are placeholder
// 64-character lowercase hex strings built from repeated characters and
// carry no meaning outside this fixture.

const hex64 = (char) => char.repeat(64);

export function createSyntheticPairedTrial() {
  return {
    schemaVersion: 'nisi-paired-trial-v1',
    pairs: [
      {
        caseId: 'case.one',
        taskSha256: hex64('a'),
        baselineSha256: hex64('b'),
        oracleSha256: hex64('c'),
        off: {
          runId: 'off.one',
          model: 'fixture.model',
          modelSettingsSha256: hex64('d'),
          toolchainSha256: hex64('e'),
          resourceBudgetSha256: hex64('f'),
          candidateSha256: hex64('0'),
          oracleCandidateSha256: hex64('0'),
          outcome: 'FAIL',
          completionClaim: true,
          tokenUsage: { input: 80, output: 20 },
          durationMs: 1000,
          repairAttempts: 1,
        },
        on: {
          runId: 'on.one',
          model: 'fixture.model',
          modelSettingsSha256: hex64('d'),
          toolchainSha256: hex64('e'),
          resourceBudgetSha256: hex64('f'),
          candidateSha256: hex64('1'),
          oracleCandidateSha256: hex64('1'),
          outcome: 'PASS',
          completionClaim: true,
          tokenUsage: { input: 40, output: 10 },
          durationMs: 750,
          repairAttempts: 0,
        },
      },
      {
        caseId: 'case.two',
        taskSha256: hex64('4'),
        baselineSha256: hex64('5'),
        oracleSha256: hex64('6'),
        off: {
          runId: 'off.two',
          model: 'fixture.model',
          modelSettingsSha256: hex64('7'),
          toolchainSha256: hex64('8'),
          resourceBudgetSha256: hex64('9'),
          candidateSha256: hex64('2'),
          oracleCandidateSha256: hex64('2'),
          outcome: 'PASS',
          completionClaim: true,
          tokenUsage: { input: 80, output: 20 },
          durationMs: 1000,
          repairAttempts: 1,
        },
        on: {
          runId: 'on.two',
          model: 'fixture.model',
          modelSettingsSha256: hex64('7'),
          toolchainSha256: hex64('8'),
          resourceBudgetSha256: hex64('9'),
          candidateSha256: hex64('3'),
          oracleCandidateSha256: hex64('3'),
          outcome: 'PASS',
          completionClaim: true,
          tokenUsage: { input: 40, output: 10 },
          durationMs: 750,
          repairAttempts: 0,
        },
      },
    ],
  };
}
