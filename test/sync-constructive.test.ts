import {it,expect} from 'vitest';
import {readFileSync,writeFileSync} from 'node:fs';
import VRMJuggler from '../src/index';
import {sequenceFromBasicParts,sequenceFromPreset} from '../src/motion/juggling/sync-sequence';
import {constructiveMovements} from '../src/motion/juggling/sync-constructive-planner';
import {carryOffset} from '../src/motion/juggling/sync-motion';
import '../dist/sync-compose-ui.js';

async function create(){
 const f=readFileSync('dist/models/default.vrm'),api=await VRMJuggler.createSyncPlanner(f.buffer.slice(f.byteOffset,f.byteOffset+f.byteLength));
 api.syncPlanningMode='constructive';return api;
}

it('constructs both arm-order directions with a fixed budget, and transfers without strict search',async()=>{
 const api=await create(),display=await create(),audits:any[]=[];
 (api as any).body.prepareSyncCycle=()=>{throw new Error('must not enter exhaustive planning');};
 for(const mirror of [false,true])for(const columns of ['normal','switched','crossed','underarm'] as const){
  const s=sequenceFromBasicParts({columns,left:'inverted',right:'shuffle',roles:'alternate',shortHand:1});s.allowBallContact=true;
  const original=structuredClone(s),start=performance.now(),result=api.setSyncSequence(s,mirror);
  expect(result.ok).toBe(true);expect(s).toEqual(original);
  const report=api.inspectSyncCycle()!;expect(report.playbackOK,JSON.stringify(report)).toBe(true);
  expect(report.maxGripError).toBeLessThan(.012);expect(report.maxElbowSpeed).toBeLessThan(12);
  const plan=api.exportSyncPlan();expect(plan.arms.info.candidates).toBeLessThanOrEqual(5);
  expect(display.applySyncPlan(s,mirror,plan).ok).toBe(true);expect(display.getSyncProgram()).toEqual(api.getSyncProgram());
  const tracks=(api as any).juggling.getSyncMovement();
  for(const candidate of constructiveMovements(tracks))for(const m of candidate.movement){
   const c={route:'direct' as const,amount:0,via:m.via};
   expect(carryOffset(c,0,1,1).length()).toBe(0);expect(carryOffset(c,1,1,1).length()).toBe(0);
  }
  audits.push({columns,mirror,ms:performance.now()-start,report});
 }
 if(process.env.SYNC_CONSTRUCTIVE_AUDIT)writeFileSync(process.env.SYNC_CONSTRUCTIVE_AUDIT,JSON.stringify(audits,null,2));
 (api as any).juggling.dispose();(display as any).juggling.dispose();
},120000);

it('connects the previously expensive solved Cross to Box, preserves sources, restores and reuses',async()=>{
 const api=await create();
 const old=JSON.parse(readFileSync('docs/verification/sync-generated-cross-transition-route.json','utf8'));
 const sources={...old,sources:old.sources.slice(0,2),route:[{source:0,set:0}]};
 api.restoreSyncSegments(sources);
 const before=api.exportSyncSegments([]).sources,start=performance.now();
 (api as any).body.prepareSyncCycle=()=>{throw new Error('must not enter exhaustive planning');};
 const result=api.registerSyncTransition(0,1),ms=performance.now()-start;
 expect(result.added).toBe(true);expect(result.forward.length).toBeGreaterThan(0);
 const doc=api.exportSyncSegments(result.route);expect(doc.sources.slice(0,2)).toEqual(before);
 api.playSyncSegments(result.route);expect(api.inspectSyncCycle()!.playbackOK).toBe(true);
 const restored=await create(),restoreStart=performance.now(),loaded=restored.restoreSyncSegments(doc);
 restored.playSyncSegments(loaded.ids);expect(restored.inspectSyncCycle()!.playbackOK).toBe(true);
 expect(restored.exportSyncSegments(loaded.ids).sources).toEqual(doc.sources);
 expect(restored.registerSyncTransition(0,1).added).toBe(false);
 if(process.env.SYNC_CONSTRUCTIVE_AUDIT)writeFileSync(process.env.SYNC_CONSTRUCTIVE_AUDIT.replace('.json','-transition.json'),JSON.stringify({ms,restoreMs:performance.now()-restoreStart,result,report:api.inspectSyncCycle()},null,2));
 (api as any).juggling.dispose();(restored as any).juggling.dispose();
},120000);

it('keeps In-line 3 on its one vertical axis and rejects invalid ball schedules',async()=>{
 const api=await create(),s=sequenceFromPreset('inline');
 expect(api.setSyncSequence(s).ok).toBe(true);
 const tracks=(api as any).juggling.getSyncMovement();
 for(const candidate of constructiveMovements(tracks))for(const m of candidate.movement)
  expect(tracks.transitions.find((t:any)=>t.hand===m.hand&&t.from===m.from).kind).toBe('empty');
 const invalid=structuredClone(s);invalid.sets[0].throws=['4','4'];
 expect(api.setSyncSequence(invalid).ok).toBe(false);
 (api as any).juggling.dispose();
},30000);

it('saves constructed detours exactly and connects opposite crossed arm orders',async()=>{
 const api=await create();
 for(const columns of ['crossed','crossed-right'] as const){
  const s=sequenceFromBasicParts({columns,left:'shuffle',right:'inverted',roles:'alternate',shortHand:1});s.allowBallContact=true;
  expect(api.setSyncSequence(s).ok).toBe(true);api.registerSyncSegments(s.name,s);
 }
 const original=api.exportSyncSegments([]).sources,connection=api.registerSyncTransition(0,1),doc=api.exportSyncSegments(connection.route);
 expect(doc.sources.slice(0,2)).toEqual(original);
 api.playSyncSegments(connection.route);
 const frames=Array.from({length:120},(_,i)=>(api as any).juggling.activeSyncReplay.sample(i/120*api.getMotionSnapshot().period));
 const restored=await create(),result=restored.restoreSyncSegments(doc);restored.playSyncSegments(result.ids);
 for(let i=0;i<frames.length;i++){
  const frame=(restored as any).juggling.activeSyncReplay.sample(i/frames.length*restored.getMotionSnapshot().period);
  frames[i].hands.forEach((hand:any,h:number)=>expect(hand.position.distanceTo(frame.hands[h].position)).toBeLessThan(1e-7));
  frames[i].ballPositions.forEach((p:any,k:number)=>expect(p.distanceTo(frame.ballPositions[k])).toBeLessThan(1e-7));
 }
 expect(restored.inspectSyncCycle()!.playbackOK).toBe(true);
 (api as any).juggling.dispose();(restored as any).juggling.dispose();
},60000);

it('registers held 2 and the reported Cross vertical combination without exhaustive search',async()=>{
 const api=await create();
 const vertical=(globalThis as any).SyncComposeUI.namedParts(VRMJuggler,{columns:'crossed',left:'inverted',right:'cross-side-vertical-up',roles:'alternate',shortHand:1});
 for(const s of [sequenceFromPreset('box-roll'),vertical])for(const mirror of [false,true]){
  api.clearSyncSegments();s.allowBallContact=true;
  expect(api.setSyncSequence(s,mirror).ok).toBe(true);expect(api.inspectSyncCycle()!.playbackOK).toBe(true);
  const registered=api.registerSyncSegments(s.name,s),doc=api.exportSyncSegments(registered.ids);
  const loaded=api.restoreSyncSegments(doc);api.playSyncSegments(loaded.ids);
  expect(api.inspectSyncCycle()!.playbackOK).toBe(true);
 }
 (api as any).juggling.dispose();
},30000);
