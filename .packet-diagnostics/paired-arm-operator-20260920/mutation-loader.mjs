// Test-only in-memory one-site faults. Canonical source is never written.
// Node24 registerHooks is used only by this private verification, not product.
import {registerHooks} from 'node:module';
const specs={
  projection:['cli/paired-arm-inspect.mjs',
    "if(!states.includes(state))throw Error('INVALID_PROJECTION');projected[state]++;",
    'if(states.includes(state))projected[state]++;'],
  observation:['cli/paired-arm-command-owner.mjs',"&&view.inspectionObserved",''],
  setupStop:['cli/paired-arm-command-owner.mjs','if(setupStop)requestStop();','/* deliberate missing setup stop */'],
  cleanup:['cli/paired-arm-command-owner.mjs',"signalCleanup==='REMOVED'&&reason===null",'true&&reason===null'],
};
const spec=specs[process.env.NISI_OPERATOR_TEST_FAULT];if(!spec)throw Error('UNKNOWN_TEST_FAULT');
const target=new URL('../../'+spec[0],import.meta.url).href;
registerHooks({load(url,context,nextLoad){
  const loaded=nextLoad(url,context);if(url!==target)return loaded;
  const source=typeof loaded.source==='string'?loaded.source:Buffer.from(loaded.source).toString('utf8');
  if(source.split(spec[1]).length!==2)throw Error('FAULT_SITE_NOT_UNIQUE');
  return {...loaded,source:source.replace(spec[1],spec[2])};
}});
