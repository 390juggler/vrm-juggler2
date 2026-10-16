/* A worker uses exactly the same solver and VRM bones as playback. It never
   creates a renderer, reads local storage or changes the visible preview. */
self.window=self;
importScripts('./vrm-juggler.min.js');
self.onmessage=async({data})=>{
  try{
    const progress=message=>self.postMessage({type:'progress',message});
    progress('モデルの骨格を準備しています…');
    const app=await VRMJuggler.createSyncPlanner(data.model,data.armAngle);
    app.syncPlanningMode=data.planning==='constructive'?'constructive':'strict';
    app.onSyncPlanningProgress=state=>progress(`腕の経路を探索しています（候補 ${state.attempts} 件を検査）…`);
    progress('投げ・捕りと、その間の腕の動きを計算しています…');
    const prepared=data.directBoundaries?app.prepareDirectSyncSequence(data.sequence,data.mirror):{sequence:data.sequence,redirectedThrows:0};
    const result=app.setSyncSequence(prepared.sequence,data.mirror);
    const plan=result.ok?app.exportSyncPlan():null;
    self.postMessage({type:'result',value:{result,plan,...prepared}});
  }catch(error){self.postMessage({type:'error',message:error.message||String(error)});}
};
