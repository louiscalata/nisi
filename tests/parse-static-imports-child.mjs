import vm from 'node:vm';
if (typeof vm.SourceTextModule !== 'function') {
  process.stderr.write('CAPABILITY_UNAVAILABLE: vm.SourceTextModule');
  process.exitCode = 86;
} else {
  process.stdin.setEncoding('utf8');
  let source = '';
  for await (const chunk of process.stdin) {
    source += chunk;
    if (Buffer.byteLength(source, 'utf8') > 65536) {
      process.stderr.write('SOURCE_LIMIT_EXCEEDED');
      process.exitCode = 87;
      break;
    }
  }
  if (process.exitCode === undefined) {
    const parsed = new vm.SourceTextModule(source, {identifier: 'file:///journal-baseline-source.mjs'});
    let specifiers;
    if (Array.isArray(parsed.moduleRequests)) {
      specifiers = parsed.moduleRequests.map(row => row.specifier);
    } else if (Array.isArray(parsed.dependencySpecifiers)) {
      // Node 22 releases before 22.20 expose the older API; it provides the
      // complete RequestedModules specifier list. Node 24 before 24.4 may too.
      specifiers = [...parsed.dependencySpecifiers];
    } else {
      process.stderr.write('CAPABILITY_UNAVAILABLE: moduleRequests/dependencySpecifiers');
      process.exitCode = 88;
    }
    if (process.exitCode === undefined) process.stdout.write(JSON.stringify(specifiers));
  }
}
