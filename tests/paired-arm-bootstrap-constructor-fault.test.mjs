// Isolated fault injection with bounded child lifetime/output; no inference.
import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const child=fileURLToPath(new URL('./helpers/paired-arm-bootstrap-constructor-child.mjs',import.meta.url));
for(const [fault,count] of [['author-adapter',1],['reviewer-owner',1],['reviewer-adapter',2],['rollback-throw',2],['rollback-idle',2]])
test(`V4 partial construction: ${fault}`,()=>{
  const stdout=execFileSync(process.execPath,[child,fault],{timeout:5000,maxBuffer:1024*1024,encoding:'utf8',
    env:{PATH:process.env.PATH,HOME:process.env.HOME}});
  const result=JSON.parse(stdout);assert.equal(result.fault,fault);assert.equal(result.ownerCount,count);
  assert.equal(result.transportCalls,0);
  assert.equal(result.error,fault.startsWith('rollback-')?'LIVE_CONSTRUCTOR_ROLLBACK_UNCONFIRMED':`BOOTSTRAP_${fault}`);
  assert(result.states.every(item=>item.pendingTransports===0&&item.state===(fault.startsWith('rollback-')?'IDLE':'STOPPED')));
});
