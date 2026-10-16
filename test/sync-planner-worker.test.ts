import {it,expect,vi} from 'vitest';
import {readFileSync} from 'node:fs';
import {runSyncPlanner} from '../src/classes/SyncPlannerClient';
import VRMJuggler from '../src/index';
import {sequenceFromPreset} from '../src/motion/juggling/sync-sequence';

it('cancels a busy worker immediately and ignores its late result',async()=>{
 const worker={postMessage:vi.fn(),terminate:vi.fn(),onmessage:null as any} as unknown as Worker;
 const controller=new AbortController(),progress=vi.fn(),promise=runSyncPlanner(worker,{},controller.signal,progress);
 worker.onmessage!({data:{type:'progress',message:'searching'}} as MessageEvent);
 controller.abort();await expect(promise).rejects.toMatchObject({name:'AbortError'});
 worker.onmessage!({data:{type:'result',value:'stale'}} as MessageEvent);
 expect(worker.terminate).toHaveBeenCalledTimes(1);expect(progress).toHaveBeenCalledWith('searching');
});

it('reports worker errors and releases the worker',async()=>{
 const worker={postMessage:vi.fn(),terminate:vi.fn(),onmessage:null as any} as unknown as Worker;
 const promise=runSyncPlanner(worker,{});
 worker.onmessage!({data:{type:'error',message:'model unavailable'}} as MessageEvent);
 await expect(promise).rejects.toThrow('model unavailable');expect(worker.terminate).toHaveBeenCalledTimes(1);
});

it('transfers checked motion and arm interpolation without another search, and rolls back corrupt results',async()=>{
 const f=readFileSync('dist/models/default.vrm'),bytes=f.buffer.slice(f.byteOffset,f.byteOffset+f.byteLength);
 const planner=await VRMJuggler.createSyncPlanner(bytes),display=await VRMJuggler.createSyncPlanner(bytes);
 const s=sequenceFromPreset('box');expect(planner.setSyncSequence(s).ok).toBe(true);
 const plan=structuredClone(planner.exportSyncPlan());
 (display as any).body.prepareSyncCycle=()=>{throw new Error('must not search on display thread');};
 expect(display.applySyncPlan(s,false,plan).ok).toBe(true);expect(display.inspectSyncCycle()?.skeletonOK).toBe(true);
 const before=display.getSyncProgram();
 const broken=structuredClone(plan);broken.placement=[0,10];
 expect(()=>display.applySyncPlan(s,false,broken)).toThrow();expect(display.getSyncProgram()).toEqual(before);
 const stale=structuredClone(plan);stale.transform='different avatar';expect(()=>display.applySyncPlan(s,false,stale)).toThrow('モデル');
 (planner as any).juggling.dispose();(display as any).juggling.dispose();
},30000);
