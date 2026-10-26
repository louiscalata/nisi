// Pure inert transport double: proves wrapper plumbing, never live execution.
export async function runPrivateLiveDemo(args, options) {
  if (options?.requireExternalState !== true) throw Error('CLI must require external state');
  const mode = process.env.NISI_CLI_TEST_MODE;
  if (mode === 'throw') throw Error('/private/CLI_TEST_SECRET');
  return { exitCode: mode === 'invalid-result' ? 7 : Number(mode), receivedArgs: args, execution: 'TEST_DOUBLE_ONLY' };
}
