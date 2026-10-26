// Bounded trusted terminal adapter. It returns raw outcomes, never approval.
const getter=Object.getOwnPropertyDescriptor(AbortSignal.prototype,'aborted').get;
const listen=EventTarget.prototype.addEventListener, unlisten=EventTarget.prototype.removeEventListener;
export async function promptRepositoryHistoryV1({text,expectedAnswer,signal,timeoutMs,input,output}) {
  if(input?.isTTY!==true || output?.isTTY!==true) return Object.freeze({kind:'no-tty'});
  const aborted=()=>signal!==null && getter.call(signal);
  if(aborted()) return Object.freeze({kind:'signal'});
  if(typeof text!=='string' || typeof expectedAnswer!=='string' || !Number.isSafeInteger(timeoutMs) || timeoutMs<1 || timeoutMs>120000)
    return Object.freeze({kind:'error'});
  return new Promise(resolve=>{
    // A fresh TTY has readableFlowing:null but isPaused()===false. Only an
    // already-flowing stream belongs to another consumer; otherwise release ours.
    let done=false,timer,buffer=Buffer.alloc(0); const wasFlowing=input.readableFlowing===true;
    const finish=kind=>{
      if(done) return; done=true;
      clearTimeout(timer);
      input.removeListener('data',onData); input.removeListener('end',onEnd); input.removeListener('error',onError);
      output.removeListener('error',onError);
      if(signal!==null) unlisten.call(signal,'abort',onAbort);
      if(!wasFlowing) input.pause();
      buffer=Buffer.alloc(0); resolve(Object.freeze(kind));
    };
    const onAbort=()=>{if(aborted()) finish({kind:'signal'});};
    const onEnd=()=>finish({kind:aborted()?'signal':'eof'});
    const onError=()=>finish({kind:aborted()?'signal':'error'});
    const onData=chunk=>{
      if(aborted()) return finish({kind:'signal'});
      if(typeof chunk!=='string' && !Buffer.isBuffer(chunk)) return finish({kind:'error'});
      const bytes=typeof chunk==='string'?Buffer.from(chunk):chunk;
      if(bytes.includes(3)) return finish({kind:'signal'});
      if(buffer.length+bytes.length>1026) return finish({kind:'error'});
      buffer=Buffer.concat([buffer,bytes]); const end=buffer.indexOf(10);
      if(end<0) { if(buffer.length>1025) finish({kind:'error'}); return; }
      if(end!==buffer.length-1) return finish({kind:'error'});
      const content=buffer.subarray(0,end>0&&buffer[end-1]===13?end-1:end);
      if(content.length>1024) return finish({kind:'error'});
      let value; try {value=new TextDecoder('utf-8',{fatal:true}).decode(content);} catch {return finish({kind:'error'});}
      finish({kind:'answer',text:value});
    };
    input.on('data',onData); input.on('end',onEnd); input.on('error',onError); output.on('error',onError);
    if(signal!==null) listen.call(signal,'abort',onAbort);
    timer=setTimeout(()=>finish({kind:aborted()?'signal':'timeout'}),timeoutMs);
    try {output.write(text); if(!done) input.resume();} catch {onError();}
  });
}
