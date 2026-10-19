import {it,expect} from 'vitest';
import '../dist/sync-compose-ui.js';
import '../dist/sync-basic-patterns.js';
import {analyzeSequence,sequenceFromPreset,sequenceFromBasicParts,sequenceHandDefinition,SEQUENCE_EXAMPLES} from '../src/motion/juggling/sync-sequence';
import {sequenceFromBaseParts} from '../src/motion/juggling/sync-base-patterns';
import {SYNC_BOX_PRESETS} from '../src/motion/juggling/sync-box';
const bases=(globalThis as any).SyncBasicPatterns,ui=(globalThis as any).SyncComposeUI;
const api={syncSequenceExamples:SEQUENCE_EXAMPLES,syncSequenceFromPreset:sequenceFromPreset,syncSequenceFromBaseParts:sequenceFromBaseParts,
  syncSequenceFromBasicParts:sequenceFromBasicParts,syncSequenceHandDefinition:sequenceHandDefinition,syncBoxPresets:SYNC_BOX_PRESETS};
it('offers six playable basic recipes and restores their selection from saved sequences',()=>{
  expect(Object.keys(bases.names)).toEqual(['box','shower','double-fixed','double-shower','high-low','box-four']);
  for(const id of Object.keys(bases.names)){
    const s=bases.create(api,id);expect(analyzeSequence(s).ok,id).toBe(true);
    expect(bases.kind(api,JSON.parse(JSON.stringify(s)))).toBe(id);
  }
  const fixed=bases.create(api,'double-fixed'),shower=bases.create(api,'double-shower');
  for(const s of [fixed,shower])for(const row of s.sets.filter((r:any)=>r.throws.includes('4x'))){
    const d=sequenceHandDefinition(row,row.throws.indexOf('4x'));
    expect(Math.abs(d.release.x-d.catch.x)<1e-8).toBe(s===fixed);
    if(s===fixed)expect(d.release.x).toBe(0);
  }
});
it('edits left-right-left-right independently without collapsing the four choices',()=>{
  const source=bases.create(api,'box-four'),before=structuredClone(source);
  for(const columns of ['normal','switched','crossed-alternate']){
    const passes=['normal','shuffle','reverse','inverted'],s=bases.fourParts(api,ui,source,columns,passes);
    expect(s.sets).toHaveLength(4);expect(analyzeSequence(s).ok).toBe(true);
    s.sets.forEach((row:any,i:number)=>{expect(row.throws.indexOf('2x')).toBe(i%2);expect(ui.shortKey(row,i%2)).toBe(passes[i]);});
    expect(bases.kind(api,JSON.parse(JSON.stringify(s)))).toBe('box-four');
  }
  expect(source).toEqual(before);
  for(const choice of ui.shortChoices){const s=bases.fourParts(api,ui,source,'normal',Array(4).fill(choice.id));expect(analyzeSequence(s).ok,choice.id).toBe(true);expect(s.name.length).toBeLessThanOrEqual(100);}
  const rotated=structuredClone(source);rotated.sets.push(rotated.sets.shift());
  const edited=bases.fourParts(api,ui,rotated,'normal',['normal','shuffle','reverse','inverted']);
  expect(edited.sets.map((r:any)=>r.throws.indexOf('2x'))).toEqual([1,0,1,0]);
});
it('starts Shower from the same parts the 2x editor builds, so an untouched Shower has no per-set note',()=>{
  const s=bases.create(api,'shower'),parts=sequenceFromBaseParts({...bases.defaults,base:'shower',passes:['normal'],highHand:0});
  parts.allowBallContact=true;
  // The old preset placed its arc differently from the editor's Shower.
  expect(analyzeSequence(sequenceFromPreset('shower')).canonical).not.toBe(analyzeSequence(parts).canonical);
  expect(ui.matchingPartsCanonical({analyzeSyncSequence:analyzeSequence},s,parts)).toBe(analyzeSequence(parts).canonical);
  expect(bases.kind(api,s)).toBe('shower');
});
