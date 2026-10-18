import {it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import VRMJuggler from '../src/index';
import {sequenceFromBaseParts,type BasePatternParts} from '../src/motion/juggling/sync-base-patterns';
import {sequenceFromPreset,sequenceWithDoubleParts,compileSequence,SEQUENCE_EXAMPLES,type DoubleShortStyle} from '../src/motion/juggling/sync-sequence';
import {buildSyncBoxTracks,syncBeat,syncDwell,syncFlightAt,SYNC_RADIUS,type SyncFlight} from '../src/motion/juggling/sync-box';
import {CreateSiteswap} from '../src/motion/juggling/Siteswap';
import {makeTransform} from '../src/motion/juggling/tracks';
import Options from '../src/options';

const styles=['normal','shuffle','reverse','inverted'] as const;
const defaults:BasePatternParts={base:'shower',columns:'normal',passes:['normal'],highHand:0,alternateHigh:true,swap:'alternate',highPath:'shower'};
const transform=makeTransform({shoulderY:1.403,shoulderX:.137,shoulderZ:.021,upperArmLength:.278,armLength:.533});
function checkArc(short:SyncFlight,high:SyncFlight){
  const dx=short.end.x-short.start.x,ax=high.end.x-high.start.x;
  const ends=[(high.start.x-short.start.x)/dx,(high.end.x-short.start.x)/dx].sort((a,b)=>a-b);
  const lo=Math.max(0,ends[0]),hi=Math.min(1,ends[1]);if(hi-lo<1e-7)return;
  const differences=Array.from({length:101},(_,i)=>{
    const u=lo+(hi-lo)*i/100,low=syncFlightAt(short,u*short.duration);
    return low.y-syncFlightAt(high,(low.x-high.start.x)/ax*high.duration).y;
  });
  const firstAbove=short.style==='shuffle'||short.style==='inverted',lastAbove=short.style==='reverse'||short.style==='inverted';
  expect(differences[0]*(firstAbove?1:-1)).toBeGreaterThan(-1e-8);
  expect(differences[differences.length-1]*(lastAbove?1:-1)).toBeGreaterThan(-1e-8);
  if(firstAbove===lastAbove)expect(Math.min(...differences.map(d=>d*(firstAbove?1:-1)))).toBeGreaterThan(-1e-8);
  else expect(differences.slice(1).filter((d,i)=>d*differences[i]<0)).toHaveLength(1);
}

it('defines Shower and Double passes against the high trajectory, including Lateral and mirroring',()=>{
  for(const base of ['shower','double'] as const)for(const style of styles)for(const lateral of [false,true])for(const highHand of [0,1] as const)for(const mirror of [false,true]){
    const pass=(lateral?'lateral-':'')+style;
    const s=base==='shower'?sequenceFromBaseParts({...defaults,passes:[pass],highHand}):
      sequenceWithDoubleParts(sequenceFromPreset('double-box'),{columns:'normal',crossSet:pass as DoubleShortStyle,selfSet:pass as DoubleShortStyle});
    s.allowBallContact=true;
    const config={...compileSequence(s).config!,mirror};
    const tracks=buildSyncBoxTracks(CreateSiteswap(config.siteswap,{...new Options().siteswap,beatDuration:syncBeat(config),dwellRatio:syncDwell(config),props:[{type:'ball',color:'red',radius:SYNC_RADIUS,C:.9}]}),transform,config);
    let checks=0;
    for(const short of tracks.flights.filter(f=>f.value===2))for(const high of tracks.flights.filter(f=>f.value>2&&f.prop!==short.prop&&Math.abs(f.start.x-f.end.x)>1e-7)){
      if(![-tracks.period,0,tracks.period].some(w=>high.release+w<=short.release+short.duration&&high.release+w+high.duration>=short.release))continue;
      checkArc(short,high);checks++;
    }
    expect(checks,`${base} ${pass} high=${highHand} mirror=${mirror}`).toBeGreaterThan(0);
  }
});

it('keeps the high Shower endpoints independent of the 2x height family',()=>{
  for(const lateral of [false,true])for(const highHand of [0,1] as const){
    const highs=styles.map(style=>{
      const s=sequenceFromBaseParts({...defaults,passes:[(lateral?'lateral-':'')+style],highHand});
      return s.sets[0].motion.hands![highHand]!.definition!;
    });
    for(const high of highs){expect(high.release.y).toBe(0);expect(high.catch.y).toBe(0);}
  }
});

it('plays the spatial Shower definitions through the actual planning and display models',async()=>{
  const f=readFileSync('dist/models/default.vrm'),bytes=f.buffer.slice(f.byteOffset,f.byteOffset+f.byteLength);
  const api=await VRMJuggler.createSyncPlanner(bytes),display=await VRMJuggler.createSyncPlanner(bytes);
  api.syncPlanningMode=display.syncPlanningMode='constructive';
  try{
    for(const style of styles)for(const lateral of [false,true])for(const mirror of [false,true]){
      const pass=(lateral?'lateral-':'')+style,s=sequenceFromBaseParts({...defaults,passes:[pass]});
      const result=api.setSyncSequence(s,mirror);
      expect(result.ok,`${pass} ${mirror}: ${result.message}`).toBe(true);
      expect(display.applySyncPlan(s,mirror,api.exportSyncPlan()).ok).toBe(true);
    }
  }finally{(api as any).juggling.dispose();(display as any).juggling.dispose();}
},60000);

it('fits and transfers existing connected recipes that now use relative high arcs',async()=>{
  const f=readFileSync('dist/models/default.vrm'),bytes=f.buffer.slice(f.byteOffset,f.byteOffset+f.byteLength);
  const api=await VRMJuggler.createSyncPlanner(bytes),display=await VRMJuggler.createSyncPlanner(bytes);
  api.syncPlanningMode=display.syncPlanningMode='constructive';let checked=0;
  try{
    for(const s of SEQUENCE_EXAMPLES){
      const config=compileSequence(s).config!;
      const tracks=buildSyncBoxTracks(CreateSiteswap(config.siteswap,{...new Options().siteswap,beatDuration:syncBeat(config),dwellRatio:syncDwell(config),props:[{type:'ball',color:'red',radius:SYNC_RADIUS,C:.9}]}),transform,config);
      if(!tracks.flights.some(f=>f.ballOrder?.some(c=>c.reference==='trajectory')))continue;
      checked++;
      for(const mirror of [false,true]){
        const before=structuredClone(s),result=api.setSyncSequence(s,mirror);
        expect(result.ok,`${s.name}: ${result.message}`).toBe(true);
        expect(s).toEqual(before);
        expect(display.applySyncPlan(s,mirror,api.exportSyncPlan()).ok).toBe(true);
        const report=display.inspectSyncCycle()!;
        expect(report.playbackOK).toBe(true);expect(report.maxGripError).toBeLessThan(.012);
        const fitted=(display as any).juggling.getSyncMovement();
        expect(fitted.period).toBeCloseTo(tracks.period,9);
        for(const short of fitted.flights.filter((f:SyncFlight)=>f.ballOrder?.some(c=>c.reference==='trajectory')))
          for(const high of fitted.flights.filter((f:SyncFlight)=>f.value>2&&f.prop!==short.prop&&Math.abs(f.end.x-f.start.x)>1e-7)){
            if([-fitted.period,0,fitted.period].some(w=>high.release+w<=short.release+short.duration&&high.release+w+high.duration>=short.release))checkArc(short,high);
          }
      }
    }
    expect(checked).toBeGreaterThan(0);
  }finally{(api as any).juggling.dispose();(display as any).juggling.dispose();}
},60000);
