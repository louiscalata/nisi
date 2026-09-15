// Owner-authored exact data intent. This file is protected from the executor.
export const baseArgv = () => [
  '--approved-reviewed-fixture',
  '--author-api', 'NATIVE_API',
  '--reviewer-api', 'CHAT_COMPLETIONS',
  '--author-endpoint', 'http://127.0.0.1:1234/api/v1/chat',
  '--reviewer-endpoint', 'http://127.0.0.1:1234/v1/chat/completions',
  '--author-model', 'synthetic.author',
  '--reviewer-model', 'synthetic.reviewer',
  '--author-instance', 'synthetic.instance',
  '--author-profile', 'nisi-native-chat-content-v1',
  '--author-reasoning', 'off',
  '--reviewer-output-mode', 'json_schema',
];
export const reversedArgv = () => [
  '--approved-reviewed-fixture',
  '--author-api', 'CHAT_COMPLETIONS',
  '--reviewer-api', 'NATIVE_API',
  '--author-endpoint', 'http://127.0.0.1:1234/v1/chat/completions',
  '--reviewer-endpoint', 'http://127.0.0.1:1234/api/v1/chat',
  '--author-model', 'synthetic.author',
  '--reviewer-model', 'synthetic.reviewer',
  '--author-output-mode', 'json_instruction',
  '--reviewer-instance', 'synthetic.review.instance',
  '--reviewer-profile', 'nisi-native-chat-content-v1',
  '--reviewer-reasoning', 'off',
];
export const bothNativeArgv = () => [
  '--approved-reviewed-fixture',
  '--author-api', 'NATIVE_API',
  '--reviewer-api', 'NATIVE_API',
  '--author-endpoint', 'http://127.0.0.1:1234/api/v1/chat',
  '--reviewer-endpoint', 'http://127.0.0.1:1234/api/v1/chat',
  '--author-model', 'synthetic.author',
  '--reviewer-model', 'synthetic.reviewer',
  '--author-instance', 'synthetic.instance',
  '--author-profile', 'nisi-native-chat-content-v1',
  '--author-reasoning', 'off',
  '--reviewer-instance', 'synthetic.review.instance',
  '--reviewer-profile', 'nisi-native-chat-content-v1',
  '--reviewer-reasoning', 'off',
];
const changed = (flag, value) => {
  const argv = baseArgv();
  const index = argv.indexOf(flag);
  if (index < 0) throw Error('OWNER_FLAG_MISSING');
  argv[index + 1] = value;
  return argv;
};
const removed = (flag, count = 2) => {
  const argv = baseArgv();
  const index = argv.indexOf(flag);
  if (index < 0) throw Error('OWNER_FLAG_MISSING');
  argv.splice(index, count);
  return argv;
};
const row = (id, argv, acceptV3 = false) => ({ id, argv, acceptV3 });
export const expectedCases = [
  row('base-native-author-chat-reviewer', baseArgv(), true),
  row('reversed-chat-author-native-reviewer', reversedArgv(), true),
  row('both-native-distinct-instances', bothNativeArgv(), true),
  row('missing-reviewer-api', removed('--reviewer-api')),
  row('unknown-author-api', changed('--author-api', 'UNKNOWN_API')),
  row('legacy-endpoint-present', [...baseArgv(), '--endpoint', 'http://127.0.0.1:1234/v1/chat/completions']),
  row('native-author-output-mode', [...baseArgv(), '--author-output-mode', 'json_schema']),
  row('chat-reviewer-instance', [...baseArgv(), '--reviewer-instance', 'synthetic.review.instance']),
  row('native-reasoning-auto', changed('--author-reasoning', 'auto')),
  row('unknown-native-profile', changed('--author-profile', 'unknown-native-profile')),
  row('native-endpoint-chat-path', changed('--author-endpoint', 'http://127.0.0.1:1234/v1/chat/completions')),
  row('chat-endpoint-native-path', changed('--reviewer-endpoint', 'http://127.0.0.1:1234/api/v1/chat')),
  row('author-endpoint-nonloopback', changed('--author-endpoint', 'http://192.0.2.1:1234/api/v1/chat')),
  row('same-models', changed('--reviewer-model', 'synthetic.author')),
  row('duplicate-api-flag', [...baseArgv(), '--author-api', 'NATIVE_API']),
  row('missing-approved-flag', removed('--approved-reviewed-fixture', 1)),
];
