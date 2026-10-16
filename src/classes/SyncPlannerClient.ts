/** Keep CPU-bound motion search off the renderer thread. Cancellation terminates
 * the worker, so even a solver which is currently inside a tight loop stops. */
export function runSyncPlanner(worker:Worker,request:unknown,signal?:AbortSignal,onProgress?:(message:string)=>void):Promise<any>{
  return new Promise((resolve,reject)=>{
    let settled=false;
    const finish=(error?:Error,value?:unknown)=>{
      if(settled)return;settled=true;
      signal?.removeEventListener('abort',cancel);worker.terminate();
      if(error)reject(error);else resolve(value);
    };
    const cancel=()=>finish(new DOMException('動作の生成を中止しました。','AbortError'));
    worker.onmessage=e=>{
      if(settled)return;
      if(e.data.type==='progress')onProgress?.(e.data.message);
      else if(e.data.type==='error')finish(new Error(e.data.message));
      else if(e.data.type==='result')finish(undefined,e.data.value);
    };
    worker.onerror=e=>finish(new Error(e.message||'動作生成の処理を開始できませんでした。'));
    worker.onmessageerror=()=>finish(new Error('動作生成の結果を受け取れませんでした。'));
    signal?.addEventListener('abort',cancel,{once:true});
    if(signal?.aborted){cancel();return;}
    try{worker.postMessage(request);}catch(error){finish(error as Error);}
  });
}
