import {it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import VRMJuggler from '../src/index';
import {sequenceWithDoubleParts,sequenceFromPreset,SEQUENCE_EXAMPLES} from '../src/motion/juggling/sync-sequence';
import {compileSequence,sequenceHandDefinition,type DoubleShortStyle} from '../src/motion/juggling/sync-sequence';
import {buildSyncBoxTracks,syncBeat,syncDwell,SYNC_RADIUS} from '../src/motion/juggling/sync-box';
import {CreateSiteswap} from '../src/motion/juggling/Siteswap';
import {makeTransform} from '../src/motion/juggling/tracks';
import Options from '../src/options';
import '../dist/sync-compose-ui.js';
const ui=(globalThis as any).SyncComposeUI;
const columns=['normal','switched','crossed','crossed-right','crossed-alternate','underarm'] as const;
const sources=()=>[sequenceFromPreset('double-box'),SEQUENCE_EXAMPLES.find(s=>s.name.startsWith('Extended Box /'))!];

it('uses all six named vertical passes in either Double phase without moving its high throws',()=>{
  const transform=makeTransform({shoulderY:1.403,shoulderX:.137,shoulderZ:.021,upperArmLength:.278,armLength:.533});
  for(const source of sources())for(const layout of columns)for(const part of ['crossSet','selfSet'] as const){
    const base=sequenceWithDoubleParts(source,{columns:layout,crossSet:'normal',selfSet:'normal'});
    for(const choice of ui.shortChoices.filter((c:any)=>c.style.startsWith('vertical-'))){
      const parts={columns:layout,crossSet:'normal',selfSet:'normal',[part]:choice.id} as const;
      const edited=sequenceWithDoubleParts(base,parts),config=compileSequence(edited).config!;
      expect(sequenceWithDoubleParts(edited,parts).sets).toEqual(edited.sets);
      edited.sets.forEach((row,i)=>{
        const high=row.throws.findIndex(t=>t!=='2x');
        expect(sequenceHandDefinition(row,high)).toEqual(sequenceHandDefinition(base.sets[i],high));
        if(row.throws.includes(part==='crossSet'?'4x':'4'))expect(ui.shortKey(row,1-high)).toBe(choice.id);
      });
      for(const mirror of [false,true]){
        const t=buildSyncBoxTracks(CreateSiteswap(config.siteswap,{...new Options().siteswap,beatDuration:syncBeat(config),dwellRatio:syncDwell(config),props:[{type:'ball',color:'red',radius:SYNC_RADIUS,C:.9}]}),transform,{...config,mirror});
        for(const f of t.flights.filter(f=>f.style.startsWith('vertical-'))){
          expect(f.start.x).toBeCloseTo(f.end.x,8);expect(f.start.z).toBeCloseTo(f.end.z,8);
          expect(Math.sign(f.end.y-f.start.y)).toBe(choice.style==='vertical-up'?1:-1);
        }
      }
      const reset=sequenceWithDoubleParts(edited,{columns:layout,crossSet:'normal',selfSet:'normal'});
      for(const row of reset.sets)expect(ui.shortKey(row,row.throws.indexOf('2x'))).toBe('normal');
    }
  }
},30000);

it('plays and transfers Double Lateral directly from the basic editor',async()=>{
  const file=readFileSync('dist/models/default.vrm'),bytes=file.buffer.slice(file.byteOffset,file.byteOffset+file.byteLength);
  const planner=await VRMJuggler.createSyncPlanner(bytes),display=await VRMJuggler.createSyncPlanner(bytes);
  planner.syncPlanningMode=display.syncPlanningMode='constructive';
  try{
    for(const source of sources())for(const columns of ['normal','switched','crossed','crossed-right','crossed-alternate','underarm'] as const)for(const mirror of [false,true]){
      const sequence=sequenceWithDoubleParts(source,{columns,crossSet:'lateral-shuffle',selfSet:'lateral-reverse'});
      sequence.allowBallContact=true;
      const result=planner.setSyncSequence(sequence,mirror);
      expect(result.ok,`${source.name} ${columns} mirror=${mirror}: ${result.message}`).toBe(true);
      const report=planner.inspectSyncCycle()!;
      expect(report.playbackOK,JSON.stringify(report)).toBe(true);
      expect(display.applySyncPlan(sequence,mirror,planner.exportSyncPlan()).ok).toBe(true);
      expect(display.getSyncProgram()).toEqual(planner.getSyncProgram());
    }
  }finally{(planner as any).juggling.dispose();(display as any).juggling.dispose();}
},120000);

it('plays all Double column passes through the same basic-mode plan and display checks',async()=>{
  const file=readFileSync('dist/models/default.vrm'),bytes=file.buffer.slice(file.byteOffset,file.byteOffset+file.byteLength);
  const planner=await VRMJuggler.createSyncPlanner(bytes),display=await VRMJuggler.createSyncPlanner(bytes);
  planner.syncPlanningMode=display.syncPlanningMode='constructive';
  try{
    const failures:string[]=[];
    for(const source of sources())for(const column of columns)for(const choice of ui.shortChoices.filter((c:any)=>c.style.startsWith('vertical-'))){
      const sequence=sequenceWithDoubleParts(source,{columns:column,crossSet:choice.id as DoubleShortStyle,selfSet:choice.id as DoubleShortStyle});
      sequence.allowBallContact=true;
      try{
        const result=planner.setSyncSequence(sequence);if(!result.ok)throw new Error(result.message);
        expect(display.applySyncPlan(sequence,false,planner.exportSyncPlan()).ok).toBe(true);
      }catch(error){failures.push(`${source.name} ${column} ${choice.id}: ${String(error)}`);}
    }
    expect(failures).toEqual([]);
  }finally{(planner as any).juggling.dispose();(display as any).juggling.dispose();}
},120000);

