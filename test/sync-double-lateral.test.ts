import {it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import VRMJuggler from '../src/index';
import {sequenceWithDoubleParts,sequenceFromPreset,sequenceHandDefinition,compileSequence,SEQUENCE_EXAMPLES} from '../src/motion/juggling/sync-sequence';
import {sequenceFromBaseParts,type BasePatternParts} from '../src/motion/juggling/sync-base-patterns';
import {buildSyncBoxTracks,syncBeat,syncDwell,SYNC_RADIUS} from '../src/motion/juggling/sync-box';
import {CreateSiteswap} from '../src/motion/juggling/Siteswap';
import {makeTransform} from '../src/motion/juggling/tracks';
import Options from '../src/options';
import '../dist/sync-compose-ui.js';
const ui=(globalThis as any).SyncComposeUI;
const transform=makeTransform({shoulderY:1.403,shoulderX:.137,shoulderZ:.021,upperArmLength:.278,armLength:.533});
const sources=()=>[sequenceFromPreset('double-box'),SEQUENCE_EXAMPLES.find(s=>s.name.startsWith('Extended Box /'))!];
const columns=['normal','switched','crossed','crossed-right','crossed-alternate','underarm'] as const;
function tracks(s:any,mirror=false){
  const c={...compileSequence(s).config!,mirror};
  return buildSyncBoxTracks(CreateSiteswap(c.siteswap,{...new Options().siteswap,beatDuration:syncBeat(c),dwellRatio:syncDwell(c),
    props:[{type:'ball',color:'red',radius:SYNC_RADIUS,C:.9}]}),transform,c);
}
it('Double Lateral reflects only the selected 2x phase, survives edits and restores its lanes',()=>{
  for(const source of sources())for(const layout of columns)for(const phase of ['crossSet','selfSet'] as const){
    const original=structuredClone(source),normal={columns:layout,crossSet:'normal',selfSet:'normal'} as const;
    const base=sequenceWithDoubleParts(source,normal),before=tracks(base);
    const parts={...normal,[phase]:'lateral-normal'};
    const changed=sequenceWithDoubleParts(base,parts),after=tracks(changed);
    expect(changed.sets.map(r=>r.throws)).toEqual(base.sets.map(r=>r.throws));
    expect(changed.beatDuration).toBe(base.beatDuration);
    after.flights.forEach((f,i)=>{
      const old=before.flights[i],row=changed.sets[Math.floor(f.release/(2*changed.beatDuration))%4];
      const selected=f.value===2&&row.throws.includes(phase==='crossSet'?'4x':'4');
      if(!selected){expect(f.start.distanceTo(old.start)).toBeLessThan(1e-8);expect(f.end.distanceTo(old.end)).toBeLessThan(1e-8);}
      else{
        for(const p of ['start','end'] as const)expect(f[p].x*old[p].x).toBeLessThanOrEqual(1e-12);
        expect(ui.shortKey(row,row.throws.indexOf('2x'))).toBe('lateral-normal');
      }
    });
    expect(sequenceWithDoubleParts(changed,parts).sets).toEqual(changed.sets);
    const restored=sequenceWithDoubleParts(changed,normal);
    restored.sets.forEach((row,h)=>{
      for(const hand of [0,1]){
        const a=sequenceHandDefinition(row,hand),b=sequenceHandDefinition(base.sets[h],hand);
        expect(a.release.x).toBeCloseTo(b.release.x,9);expect(a.catch.x).toBeCloseTo(b.catch.x,9);
      }
    });
    expect(source).toEqual(original);
    const saved=JSON.parse(JSON.stringify(changed));
    for(const row of saved.sets)if(row.throws.includes(phase==='crossSet'?'4x':'4'))expect(ui.shortKey(row,row.throws.indexOf('2x'))).toBe('lateral-normal');
  }
},30000);
it('Inside and Outside stay beyond the two columns on the specified hand side, including mirroring',()=>{
  const defaults:BasePatternParts={base:'box',columns:'normal',passes:[],highHand:0,alternateHigh:true,swap:'alternate',highPath:'vertical'};
  for(const base of ['box','double'] as const)for(const layout of columns)for(const mirror of [false,true]){
    for(const [name,direction] of [['Inside',1],['Outside',-1]] as const){
      const choice=ui.shortChoices.find((c:any)=>c.name===name+' column Up');
      const t=tracks(sequenceFromBaseParts({...defaults,base,columns:layout,passes:Array(base==='double'?4:2).fill(choice.id)}),mirror);
      const boundary=Math.max(...t.flights.filter(f=>f.value===4).flatMap(f=>[Math.abs(f.start.x),Math.abs(f.end.x)]));
      for(const f of t.flights.filter(f=>f.value===2)){
        expect(f.start.x*(f.throwHand===0?-1:1)*direction,`${base} ${layout} ${name} mirror=${mirror}`).toBeGreaterThan(boundary);
        expect(f.start.x).toBeCloseTo(f.end.x,9);
      }
    }
  }
});
it('plays Lateral on both Double bases and every column layout after preparing direct playback',async()=>{
  const file=readFileSync('dist/models/default.vrm'),api=await VRMJuggler.createSyncPlanner(file.buffer.slice(file.byteOffset,file.byteOffset+file.byteLength));
  api.syncPlanningMode='constructive';
  try{
    for(const source of sources())for(const layout of columns)for(const mirror of [false,true]){
      const parts={columns:layout,crossSet:'lateral-shuffle',selfSet:'lateral-reverse'} as const;
      const s=sequenceWithDoubleParts(source,parts);s.allowBallContact=true;
      const prepared=api.prepareDirectSyncSequence(s,mirror),result=api.setSyncSequence(prepared.sequence,mirror);
      expect(result.ok,`${source.name} ${layout} ${mirror}: ${result.message}`).toBe(true);
      expect(api.inspectSyncCycle()!.maxGripError).toBeLessThan(.012);
    }
  }finally{(api as any).juggling.dispose();}
},120000);
