// Private fixed-source acceptance harness. Only a retained, exact staged package
// and an existing private test state directory are inputs. No models or network.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const [packageRoot, stateRoot, mode] = process.argv.slice(2);
assert(path.isAbsolute(packageRoot) && path.isAbsolute(stateRoot));
assert(['full','reservation-only'].includes(mode));
const load = relative => import(pathToFileURL(path.join(packageRoot,relative)));
const { buildNativeArtifactKernel } = await load('hosts/swift-verifier/build.mjs');
const { createSwiftArtifactExecutor } = await load('hosts/swift-verifier/executor.mjs');
const { createReviewedLiveFixtureV1 } = await load('examples/repository-task/reviewed-live-fixture-v1.mjs');
const { createReviewedRepositoryHostV1 } = await load('hosts/repository/reviewed-workflow-v1.mjs');
const { readRepositoryRunBundleV1 } = await load('receipts/repository-run-v1.mjs');
const scope = 'operator-exclusive-static-local-v1', observations = [];
const record = { schema:'nisi-installed-cli-fixed-native/v1',status:'INCOMPLETE',mode,packageRoot,stateRoot,
  checks:[],builds:[],modelInference:false,independentModelReview:false,liveModelBenchmark:false,applied:false,published:false };
const observe = result => { observations.push(result); return result; };
let operation = 0;
const fixture = await createReviewedLiveFixtureV1();
function execute(executor, extra={}) {
  return executor.execute({preparation:fixture.preparations[0],path:'config.json',profileId:'nisi-json-structure-v1',
    runId:`12345678-1234-4234-8234-${(++operation).toString(16).padStart(12,'0')}`,attempt:0,...extra});
}
function buildAt(directory) {
  const build=buildNativeArtifactKernel({buildRoot:directory}); record.builds.push(build);
  const stat=fs.lstatSync(directory);
  assert.equal(build.schemaVersion,2); assert.equal(build.stateRoot,fs.realpathSync(directory));
  assert.equal(build.stateRootDev,String(stat.dev)); assert.equal(build.stateRootIno,String(stat.ino));
  assert.equal(build.reservationScope,'STATE_ROOT_ONLY'); assert.equal(path.dirname(build.directory),build.stateRoot);
  assert.equal(path.dirname(build.executable),build.directory); return build;
}
try {
  const build=buildAt(stateRoot), secondBuild=buildAt(stateRoot);
  assert.notEqual(build.directory,secondBuild.directory);
  const first=createSwiftArtifactExecutor({build,scope}), second=createSwiftArtifactExecutor({build:secondBuild,scope});
  const marker=path.join(stateRoot,'nisi-swift-owner-v1.reservation');
  const pending=execute(first); let success;
  try {
    // This checks the active marker, not merely its absence after cleanup.
    assert(fs.existsSync(marker),'MISSING_EXTERNAL_RESERVATION');
    assert(!fs.existsSync(path.join(packageRoot,'.build')),'INSTALLED_PACKAGE_WRITE');
    const denied=observe(await execute(second));
    assert.equal(denied.receipt.result.status,'ERROR'); assert.equal(denied.receipt.result.reason,'SWIFT_RESERVATION_PRESENT');
    assert.equal(denied.receipt.process.started,false); assert.equal(denied.reservation.acquired,false);
  } finally { success=observe(await pending); }
  assert.equal(success.receipt.result.status,'PASS'); assert.equal(success.receipt.process.closed,true);
  assert.equal(success.receipt.process.drain,'CONFIRMED'); assert.equal(success.reservation.released,true);
  assert.equal(first.status(),'IDLE'); assert(!fs.existsSync(marker));
  record.checks.push('two issued builds share external reservation; close drains and releases');
  if(mode==='full') {
    const cancelled=new AbortController();cancelled.abort();
    const before=observe(await execute(createSwiftArtifactExecutor({build,scope}),{signal:cancelled.signal}));
    assert.equal(before.receipt.result.reason,'ABORTED'); assert.equal(before.receipt.process.started,false);
    assert.equal(before.reservation.acquired,false); assert(!fs.existsSync(marker));
    const during=new AbortController(), cancelling=createSwiftArtifactExecutor({build,scope});
    const active=execute(cancelling,{signal:during.signal}); during.abort();
    const stopped=observe(await active);
    assert.equal(stopped.receipt.result.status,'INCONCLUSIVE');assert.equal(stopped.receipt.result.reason,'ABORTED');
    assert.equal(stopped.receipt.process.closed,true);assert.equal(stopped.reservation.released,true);
    assert.equal(cancelling.status(),'IDLE');assert(!fs.existsSync(marker));
    record.checks.push('pre-abort and active abort never grant PASS; observed close releases marker');

    const parent=path.join(stateRoot,'workspaces');fs.mkdirSync(parent,{mode:0o700});
    const host=createReviewedRepositoryHostV1({suite:fixture.suite,build,scope,targets:fixture.targets,parentRoot:parent,
      staticTimeoutMs:5000,totalTestTimeoutMs:10000,testTimeoutMs:5000,closeGraceMs:500});
    const make=n=>({files:fixture.preparations[n].candidate.files.map(({path,content})=>({path,content}))});
    // Same registered author identity as the fixture; callbacks are fixed and
    // must not be represented as a live or independent model review.
    const report=await host.run({authorizeContext:{authorize:p=>({status:'PASS',evidence:{...p.binding,reason:''}})},
      author:{id:'author.live-model',draft:p=>({candidate:make(0),evidence:{...p.binding,
        candidateFingerprint:fixture.preparations[0].candidateFingerprint,note:'Fixed inspected baseline'}}),
        repair:p=>({status:'REPAIRED',candidate:make(1),evidence:{...p.binding,baseCandidateFingerprint:p.binding.candidateFingerprint,
          candidateFingerprint:fixture.preparations[1].candidateFingerprint,note:'Fixed inspected repair'}})},
      reviewers:[{id:'reviewer.fixed-fixture',review:p=>({status:'PASS',evidence:{...p.binding,reviewerId:'reviewer.fixed-fixture',
        findings:[],summary:'Fixed callback; no independent model review',reason:''}})}]});
    const result=await host.settled();record.hostResult=result;
    assert.equal(report.outcome,'COMPLETED');assert.equal(report.repairAttempts,1);assert.equal(result.state,'SETTLED');
    assert.equal(result.bundleError,null);assert.deepEqual(result.testHistory.map(h=>h.adapterResult.evidence.assertionsPassed),[8,10]);
    assert.equal(result.staticHistory.length,2);assert.equal(result.testHistory.length,2);
    assert.equal(result.proposedChanges.changes.length,1);assert.equal(result.proposedChanges.changes[0].path,'retry-settings.mjs');
    assert.deepEqual(readRepositoryRunBundleV1(result.bundle,{report,preparation:fixture.preparations[1],suite:fixture.suite,
      nodeRegistrationFingerprint:result.bundleSummary.nodeRegistrationFingerprint,
      plans:result.staticHistory.map(h=>h.plan),groups:result.staticHistory.map(h=>h.group),
      executions:result.testHistory.map(h=>h.execution)}),result.bundleSummary);
    for(const [index,h]of result.testHistory.entries()) {
      assert.equal(h.execution.receipt.process.closed,true);assert.equal(h.execution.receipt.process.drain,'CONFIRMED');
      assert.equal(path.dirname(h.workspace.root),parent);
      assert.equal(result.staticHistory[index].observations.length,4);
      for(const o of result.staticHistory[index].observations) {
        assert.equal(o.receipt.process.closed,true);assert.equal(o.receipt.process.drain,'CONFIRMED');assert.equal(o.reservation.released,true);
        assert.equal(o.expected.binding.candidateFingerprint,h.execution.expected.binding.candidateFingerprint);
      }
    }
    assert.equal(result.applied,false);record.checks.push('installed fixed Swift and Node host: 8/10 -> 10/10, one repair, bound proposal only');

    const identity=path.join(stateRoot,'identity');fs.mkdirSync(identity,{mode:0o700});
    const identityBuild=buildAt(identity), original=path.join(stateRoot,'identity-original');
    fs.renameSync(identity,original);fs.mkdirSync(identity,{mode:0o700});
    // Keep the exact issued build files reachable, so only the changed root
    // identity (not a missing binary) can account for the refusal.
    fs.renameSync(path.join(original,path.basename(identityBuild.directory)),identityBuild.directory);
    const replaced=observe(await execute(createSwiftArtifactExecutor({build:identityBuild,scope})));
    assert.equal(replaced.receipt.result.status,'ERROR');assert.equal(replaced.receipt.result.reason,'NISI_STATE_DIRECTORY_INVALID');
    assert.equal(replaced.receipt.process.started,false);assert.equal(replaced.reservation.acquired,false);
    assert(!fs.existsSync(path.join(identity,'nisi-swift-owner-v1.reservation')));
    record.checks.push('replaced root refuses before reservation and native spawn despite unchanged build files');
  }
  assert(!fs.existsSync(path.join(packageRoot,'.build')));record.status='PASS_SCOPED';
} catch(error) {
  record.status='FAIL';record.failure={name:error.name,message:error.message,code:error.code??null};process.exitCode=1;
} finally {
  record.observations=observations;
  const evidence=path.join(stateRoot,'installed-native-receipt.json');
  fs.writeFileSync(evidence,JSON.stringify(record,null,2)+'\n',{flag:'wx',mode:0o600});
  console.log(JSON.stringify({status:record.status,evidence,checks:record.checks,failure:record.failure??null}));
}
