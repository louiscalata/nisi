import { readRenderTileV1, identityRenderTileV1 } from '../src/render-tile-v1.mjs';
const D1='0'.repeat(63)+'1';
const leaf=()=>({schemaVersion:1,profile:'nisi-render-tile-v1',tileId:'a',kind:'leaf',inputs:{src:D1},recipe:{role:'generator',modality:'code',model:'m',seed:1,params:{},apron:{size:0,unit:'symbols'}},neighbours:[],children:[],attempt:0,budget:{wallMs:1000,tokens:null,memoryBytes:null},apron:{}});
const run=(name,make)=>{ try{ const r=readRenderTileV1(make()); console.log(name.padEnd(34), r.ok?'OK(accepted)':'REFUSED '+r.code); }catch(e){ console.log(name.padEnd(34),'*** THREW '+e.constructor.name+': '+String(e.message).slice(0,48)); } };

// a. throwing getter on a params member
run('params member throwing getter', ()=>{ const t=leaf(); t.recipe.params={ get x(){ throw new Error('boom'); } }; return t; });
// b. throwing getter nested in params
run('params nested throwing getter', ()=>{ const t=leaf(); t.recipe.params={ a:{ get x(){ throw new Error('boom'); } } }; return t; });
// c. throwing getter on a root required member
run('root member throwing getter', ()=>{ const t=leaf(); Object.defineProperty(t,'tileId',{ get(){throw new Error('boom');}, enumerable:true }); return t; });
// d. throwing getter on inputs digest
run('inputs digest throwing getter', ()=>{ const t=leaf(); Object.defineProperty(t.inputs,'src',{ get(){throw new Error('boom');}, enumerable:true }); return t; });
// e. deep nesting in params (depth 60000)
run('params depth 60000', ()=>{ const t=leaf(); let o={}; const root=o; for(let i=0;i<60000;i++){ o.a={}; o=o.a; } t.recipe.params=root; return t; });
// f. Proxy (throws on getPrototypeOf)
run('proxy throwing getPrototypeOf', ()=>{ const p=new Proxy({}, { getPrototypeOf(){throw new Error('boom');} }); const t=leaf(); t.recipe.params=p; return t; });
// g. proxy as root input
run('proxy as root', ()=>{ const p=new Proxy(leaf(), { get(){throw new Error('boom');} }); return p; });
// h. identity: deep params
try{ const t=leaf(); let o={}; const root=o; for(let i=0;i<60000;i++){ o.a={}; o=o.a; } t.recipe.params=root; identityRenderTileV1(t); console.log('identity deep params'.padEnd(34),'OK'); }catch(e){ console.log('identity deep params'.padEnd(34),'*** THREW '+e.constructor.name); }
// i. sparse arrays in params
run('params sparse array', ()=>{ const t=leaf(); const a=[]; a[5]=1; t.recipe.params={ a }; return t; });
// j. array with hole + extra prop
run('params array with extra prop', ()=>{ const t=leaf(); const a=[1,2]; a.x=3; t.recipe.params={ a }; return t; });
