import {it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import VRMJuggler from '../src/index';
import {sequenceFromBaseParts,compileBaseRoute,BasePatternParts} from '../src/motion/juggling/sync-base-patterns';
import {analyzeSequence,compileSequence,sequenceFromPreset,sequenceWithDoubleParts,SEQUENCE_EXAMPLES} from '../src/motion/juggling/sync-sequence';
import {buildSyncBoxTracks,syncDwell,syncBeat,SYNC_RADIUS} from '../src/motion/juggling/sync-box';
import {CreateSiteswap} from '../src/motion/juggling/Siteswap';
import Options from '../src/options';
import '../dist/sync-compose-ui.js';
import {makeTransform} from '../src/motion/juggling/tracks';
const defaults:BasePatternParts={base:'box',columns:'normal',passes:['normal','normal'],highHand:0,alternateHigh:true,swap:'alternate',highPath:'vertical'};
const transform=makeTransform({shoulderY:1.403,shoulderX:.137,shoulderZ:.021,upperArmLength:.278,armLength:.533});
function build(s:any,t=transform,mirror=false){const config={...compileSequence(s).config!,mirror};
 const source=CreateSiteswap(config.siteswap,{...new Options().siteswap,beatDuration:syncBeat(config),dwellRatio:syncDwell(config),props:[{type:'ball',color:'red',radius:SYNC_RADIUS,C:.9}]});
 return buildSyncBoxTracks(source,t,config);
}
it('plays both Double layouts with Switched, Underarm and every Cross order, including mirrored direct routes',async()=>{
 const f=readFileSync('dist/models/default.vrm'),api=await VRMJuggler.createSyncPlanner(f.buffer.slice(f.byteOffset,f.byteOffset+f.byteLength));
 api.syncPlanningMode='constructive';
 const sources=[sequenceFromPreset('double-box'),SEQUENCE_EXAMPLES.find(s=>s.name.startsWith('Extended Box /'))!];
 try{
  for(const columns of ['switched','crossed','crossed-right','crossed-alternate','underarm'] as const)for(const mirror of [false,true]){
   for(const source of sources){
    const s=sequenceWithDoubleParts(source,{columns,crossSet:'shuffle',selfSet:'inverted'});s.allowBallContact=true;
    const result=api.setSyncSequence(s,mirror);
    expect(result.ok,`${source.name} ${columns} ${mirror}: ${result.message}`).toBe(true);
    const report=api.inspectSyncCycle()!;expect(report.playbackOK,`${source.name} ${columns} ${mirror}: ${JSON.stringify(report)}`).toBe(true);expect(report.maxGripError).toBeLessThan(.012);
   }
   for(const highPath of ['vertical','shower'] as const)for(const passes of [
    ['normal','shuffle','reverse','inverted'],['lateral-normal','lateral-shuffle','lateral-reverse','lateral-inverted'],
    ['outside-vertical-up','outside-vertical-down','center-vertical-up','center-vertical-down'],
    ['cross-side-vertical-up','cross-side-vertical-down','normal','inverted']]){
    const s=sequenceFromBaseParts({...defaults,base:'double',columns,highPath,passes});
    const raw=build(s);
    for(const flight of raw.flights.filter(f=>f.value===2&&f.style!.startsWith('vertical-'))){
     expect(flight.start.x).toBeCloseTo(flight.end.x,9);expect(flight.start.z).toBeCloseTo(flight.end.z,9);
    }
    const prepared=api.prepareDirectSyncSequence(s,mirror),t=build(prepared.sequence,(api as any).juggling.getSyncTransform(),mirror);
    expect(prepared.sequence.sets).toHaveLength(4);
    for(const flight of t.flights.filter(f=>f.value===4)){
     expect(Math.abs(flight.start.z-flight.end.z)).toBeLessThan(1e-7);
     if(highPath==='vertical'||flight.throwHand===flight.catchHand)expect(Math.abs(flight.start.x-flight.end.x)).toBeLessThan(1e-7);
     else expect(Math.abs(flight.start.x-flight.end.x)).toBeGreaterThan(.05);
    }
    expect(api.setSyncSequence(prepared.sequence,mirror).ok).toBe(true);
    expect(api.inspectSyncCycle()!.maxGripError,`${columns} ${highPath} ${passes.join(',')} ${mirror}`).toBeLessThan(.012);
    if(columns==='switched')expect(prepared.sequence.sets.every(r=>r.motion.columns==='switched')).toBe(true);
   }
  }
 }finally{(api as any).juggling.dispose();}
},120000);
it('keeps named vertical 2x lanes under Underarm in Box and Double',async()=>{
 const f=readFileSync('dist/models/default.vrm'),api=await VRMJuggler.createSyncPlanner(f.buffer.slice(f.byteOffset,f.byteOffset+f.byteLength));
 api.syncPlanningMode='constructive';
 try{
  for(const parts of [{...defaults,columns:'underarm',passes:['center-vertical-up','normal']},{...defaults,columns:'underarm',passes:['outside-vertical-up','center-vertical-down']},
   {...defaults,base:'double',columns:'underarm',passes:['outside-vertical-up','outside-vertical-down','center-vertical-up','center-vertical-down']}] as BasePatternParts[]){
   const s=sequenceFromBaseParts(parts);
   for(const flight of build(s).flights.filter(f=>f.value===2)){
    // Only an arcing 2x is raised and caught centrally, as in Threaded Box.
    if(flight.style!.startsWith('vertical-')){expect(flight.start.x).toBeCloseTo(flight.end.x,9);expect(flight.start.z).toBeCloseTo(flight.end.z,9);}
    else expect(Math.abs(flight.end.x)).toBeCloseTo(.025*transform.horizontalScale,9);
   }
   for(const mirror of [false,true]){
    expect(api.setSyncSequence(s,mirror).ok).toBe(true);
    const report=api.inspectSyncCycle()!;expect(report.playbackOK,`${parts.passes} ${mirror}`).toBe(true);expect(report.maxGripError).toBeLessThan(.012);
    const prepared=api.prepareDirectSyncSequence(s,mirror);
    expect(api.setSyncSequence(prepared.sequence,mirror).ok).toBe(true);expect(api.inspectSyncCycle()!.maxGripError).toBeLessThan(.012);
   }
  }
 }finally{(api as any).juggling.dispose();}
},120000);
it('keeps High-Low swap order independent of high-hand scheduling',()=>{
 for(const highHand of [0,1] as const)for(const alternateHigh of [false,true])for(const swap of ['left-over','right-over','alternate'] as const){
  const s=sequenceFromBaseParts({...defaults,base:'high-low',passes:['shuffle'],highHand,alternateHigh,swap});
  expect(analyzeSequence(s)).toMatchObject({ok:true,balls:3});
  expect(s.sets[0].throws[highHand]).toBe(alternateHigh?'6':'6x');
  expect(s.sets[2].throws[alternateHigh?1-highHand:highHand]).toBe(alternateHigh?'6':'6x');
  expect(s.sets[1].motion.hands![swap==='right-over'?1:0]!.heightOffset).toBeGreaterThan(0);
 }
});
it('Double has four independent 2x phases and vertical or crossing high flights',()=>{
 for(const highPath of ['vertical','shower'] as const){
 const s=sequenceFromBaseParts({...defaults,base:'double',passes:['normal','shuffle','reverse','inverted'],highPath});
 expect(analyzeSequence(s)).toMatchObject({ok:true,balls:3});
 s.sets.forEach((row,i)=>expect(row.motion.hands![row.throws.indexOf('2x')]!.style).toBe(['normal','shuffle','reverse','inverted'][i]));
 const flights=build(s).flights.filter(f=>f.value===4);
 expect(flights.every(f=>Math.abs(f.start.x-f.end.x)<1e-8)).toBe(highPath==='vertical');
 }
});
it('Shower high flights reverse the 2x lanes including lateral',()=>{
 for(const pass of ['normal','lateral-normal'])for(const highHand of [0,1] as const){
 const s=sequenceFromBaseParts({...defaults,base:'shower',passes:[pass],highHand});
 const f=build(s).flights,high=f.find(f=>f.value===4)!,low=f.find(f=>f.value===2)!;
 expect(high.start.distanceTo(low.end)).toBeLessThan(1e-8);expect(high.end.distanceTo(low.start)).toBeLessThan(1e-8);
 }
});
it('keeps Double 4x vertical or in a Shower arc after preparing playback, including mirroring',async()=>{
 const f=readFileSync('dist/models/default.vrm'),api=await VRMJuggler.createSyncPlanner(f.buffer.slice(f.byteOffset,f.byteOffset+f.byteLength));
 api.syncPlanningMode='constructive';
 try{
  for(const highPath of ['vertical','shower'] as const)for(const mirror of [false,true]){
   const route=compileBaseRoute({kind:'sync-base-route',version:1,beatDuration:.205,mirror,
    blocks:[{parts:{...defaults,base:'double',passes:['normal','normal','normal','normal'],highPath},repeats:1}]});
   const prepared=api.prepareDirectSyncSequence(route.sequence,mirror);
   const high=build(prepared.sequence,(api as any).juggling.getSyncTransform(),mirror).flights.filter(f=>f.value===4);
   const crossing=high.filter(f=>f.throwHand!==f.catchHand);
   expect(crossing.length).toBeGreaterThan(0);
   for(const flight of high){
    expect(Math.abs(flight.start.z-flight.end.z)).toBeLessThan(1e-7);
    if(highPath==='vertical'||flight.throwHand===flight.catchHand)expect(Math.abs(flight.start.x-flight.end.x)).toBeLessThan(1e-7);
    else expect(Math.abs(flight.start.x-flight.end.x)).toBeGreaterThan(.05);
   }
   expect(api.setSyncSequence(prepared.sequence,mirror).ok).toBe(true);
   expect(api.inspectSyncCycle()!.maxGripError).toBeLessThan(.012);
  }
 }finally{(api as any).juggling.dispose();}
},120000);
it('redirects Box boundaries at fixed tempo without extra sets and transfers the plan',async()=>{
 const f=readFileSync('dist/models/default.vrm'),bytes=f.buffer.slice(f.byteOffset,f.byteOffset+f.byteLength);
 const api=await VRMJuggler.createSyncPlanner(bytes),display=await VRMJuggler.createSyncPlanner(bytes);
 api.syncPlanningMode=display.syncPlanningMode='constructive';
 for(const columns of ['crossed','crossed-right','underarm','switched'] as const)for(const mirror of [false,true]){
 const route=compileBaseRoute({kind:'sync-base-route',version:1,beatDuration:.205,mirror,blocks:[{parts:defaults,repeats:1},{parts:{...defaults,columns},repeats:1}]});
 expect(route.addedSets).toBe(0);const before=structuredClone(route.sequence);
 const prepared=api.prepareDirectSyncSequence(route.sequence,mirror);expect(route.sequence).toEqual(before);
 expect(prepared.sequence.sets).toHaveLength(route.requestedSets);expect(prepared.redirectedThrows).toBeGreaterThan(0);
 const tracks=build(prepared.sequence,(api as any).juggling.getSyncTransform(),mirror);
 for(const flight of tracks.flights){const i=Math.floor((flight.release+1e-8)/(.410));
 if(prepared.sequence.sets[i%route.requestedSets].sourceName===prepared.sequence.sets[(i+flight.value/2)%route.requestedSets].sourceName)continue;
 const next=tracks.flights.find(g=>g.throwHand===flight.catchHand&&Math.abs(g.release-((flight.release+flight.value*.205)%tracks.period))<1e-7)!;
 expect(flight.end.distanceTo(next.start),`${columns} ${mirror} ${i} ${flight.throwHand}`).toBeLessThan(1e-6);
 }
 expect(api.setSyncSequence(prepared.sequence,mirror).ok).toBe(true);
 expect(display.applySyncPlan(prepared.sequence,mirror,api.exportSyncPlan()).ok).toBe(true);
 expect(display.inspectSyncCycle()!.maxGripError).toBeLessThan(.012);
 }
 (api as any).juggling.dispose();(display as any).juggling.dispose();
},120000);
it('combines all four bases as a closed three-ball schedule',()=>{
 const blocks=['box','high-low','shower','double'].map(base=>({parts:{...defaults,base,passes:Array(base==='double'?4:base==='box'?2:1).fill('normal')},repeats:1}));
 const result=compileBaseRoute({kind:'sync-base-route',version:1,beatDuration:.205,mirror:false,blocks});
 expect(analyzeSequence(result.sequence)).toMatchObject({ok:true,balls:3});
 expect(result.sequence.sets.length).toBe(result.requestedSets+result.addedSets);
});
it('generates each named pass on every base and plays a mixed direct route',async()=>{
 const f=readFileSync('dist/models/default.vrm'),api=await VRMJuggler.createSyncPlanner(f.buffer.slice(f.byteOffset,f.byteOffset+f.byteLength));
 api.syncPlanningMode='constructive';const failures:any[]=[];
 for(const base of ['box','high-low','shower','double'] as const)for(const {id} of (globalThis as any).SyncComposeUI.shortChoices){
   const parts={...defaults,base,passes:Array(base==='double'?4:base==='box'?2:1).fill(id)};
   const route=compileBaseRoute({kind:'sync-base-route',version:1,beatDuration:.205,mirror:false,blocks:[{parts,repeats:1}]});
   try{const prepared=api.prepareDirectSyncSequence(route.sequence);
   const result=api.setSyncSequence(prepared.sequence);const report=api.inspectSyncCycle()!;
   if(!result.ok||report.maxGripError>=.012)failures.push({base,id,message:result.message,grip:report.maxGripError});}catch(e){failures.push({base,id,message:String(e)});}
 }
 expect(failures).toEqual([]);
 const blocks=['box','high-low','shower','double'].map(base=>({parts:{...defaults,base,passes:Array(base==='double'?4:base==='box'?2:1).fill('lateral-normal')},repeats:1}));
 for(const mirror of [false,true]){
 const route=compileBaseRoute({kind:'sync-base-route',version:1,beatDuration:.205,mirror,blocks});
 const prepared=api.prepareDirectSyncSequence(route.sequence,mirror);
 expect(api.setSyncSequence(prepared.sequence,mirror).ok).toBe(true);
 expect(api.inspectSyncCycle()!.maxGripError).toBeLessThan(.012);
 }
 (api as any).juggling.dispose();
},120000);
