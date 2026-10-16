import {describe,it,expect} from 'vitest';
import '../dist/sync-compose-ui.js';
import {sequenceFromBasicParts,sequenceFromPreset,sequenceFromDoubleParts,analyzeSequence,SEQUENCE_EXAMPLES} from '../src/motion/juggling/sync-sequence';
import {SYNC_BOX_PRESETS} from '../src/motion/juggling/sync-box';

const ui=(globalThis as any).SyncComposeUI;
const api={syncSequenceFromBasicParts:sequenceFromBasicParts,syncSequenceFromPreset:sequenceFromPreset,syncBoxPresets:SYNC_BOX_PRESETS};
it('discloses approximate arm playback without claiming clearance or a reach failure',()=>{
 const report={skeletonOK:false,playbackOK:true,minArmDistance:.02,minBallArmDistance:.08,postureOK:false,maxGripError:0,maxElbowSpeed:5,maxJointAngularSpeed:40};
 const text=ui.armPlaybackSummary(report);
 expect(text).toContain('腕同士の接触');expect(text).toContain('姿勢の近似');expect(text).not.toContain('検査OK');expect(text).not.toContain('届かない');
 expect(ui.armPlaybackSummary({...report,skeletonOK:true})).toContain('検査OK');
 expect(ui.armPlaybackSummary({...report,playbackOK:false})).not.toContain('再生を優先');
});
it('reports permitted contacts explicitly instead of claiming ball clearance',()=>{
 expect(ui.ballContactSummary({ballContact:true,ballContactAllowed:true})).toContain('接触あり');
 expect(ui.ballContactSummary({ballContact:false,ballContactAllowed:true})).toContain('許可中');
 expect(ui.ballContactSummary({ballContact:false,ballContactAllowed:false})).toBe('球同士の接触なし。');
});
describe('named component selection',()=>{
  it('preserves every fitted spatial preset when selected by its component name',()=>{
    for(const p of SYNC_BOX_PRESETS.filter(p=>p.id.includes('vertical-')||p.id.startsWith('lateral-'))){
      const choice=p.id.replace(/^switched-/,'').replace(/^vertical-/,'center-vertical-');
      const s=ui.namedParts(api,{roles:'alternate',shortHand:1,columns:p.columns,left:choice,right:choice});
      if(!p.id.includes('vertical-'))s.sets.forEach((r:any)=>r.motion.shortMotions.forEach((o:any)=>{expect(o.ballOrder).toBe('style');delete o.ballOrder;}));
      expect(analyzeSequence(s).canonical,p.id).toBe(analyzeSequence(sequenceFromPreset(p.id)).canonical);
    }
  });
  it('names Lateral and vertical lanes separately from the height family',()=>{
    expect(ui.describeSequence(sequenceFromPreset('lateral-inverted')).fields).toContainEqual(['左手の2','2x Inverted Lateral']);
    expect(ui.describeSequence(sequenceFromPreset('outside-vertical-up')).fields).toContainEqual(['右手の2','2x Outside column Up']);
    expect(ui.describeSequence(sequenceFromPreset('switched-cross-side-vertical-down')).title).toContain('Switched');
  });
  it('keeps the throw schedule valid for all named left/right combinations without claiming a playable motion',()=>{
    for(const columns of ['normal','switched','crossed','crossed-right','crossed-alternate','underarm'])for(const left of ui.shortChoices)for(const right of ui.shortChoices){
      const s=ui.namedParts(api,{roles:'alternate',shortHand:1,columns,left:left.id,right:right.id});
      expect(analyzeSequence(s).ok,`${columns}: ${left.id}/${right.id}`).toBe(true);
      expect(ui.shortKey(s.sets.find((r:any)=>r.throws[0]==='2x'),0)).toBe(left.id);
      expect(ui.shortKey(s.sets.find((r:any)=>r.throws[1]==='2x'),1)).toBe(right.id);
    }
  });
  it('reuses existing connections and only generates a transition when append needs it',()=>{
    let built=false,calls=0;const ids=[1,2];
    const mock={appendSyncSource:(route:number[])=>{expect(route).toEqual(ids);if(!built)throw Error('no edge');return {ids:[...route,3,4]};},exportSyncSegments:()=>({route:[{source:0},{source:0}]}),registerSyncTransition:(a:number,b:number)=>{expect([a,b]).toEqual([0,1]);calls++;built=true;}};
    expect(ui.appendConnected(mock,ids,1).ids).toEqual([1,2,3,4]);
    ui.appendConnected(mock,ids,1);expect(calls).toBe(1);expect(ids).toEqual([1,2]);
  });
  it('retains the route if transition generation or closure fails',()=>{
    const ids=[1,2];const mock={appendSyncSource:()=>{throw Error('no edge');},analyzeSyncSegments:()=>{throw Error('open');},closeSyncSegments:()=>{throw Error('no return');},exportSyncSegments:()=>({route:[{source:0},{source:1}]}),registerSyncTransition:()=>{throw Error('not generated');}};
    expect(()=>ui.appendConnected(mock,ids,2)).toThrow('not generated');
    expect(()=>ui.closeConnected(mock,ids)).toThrow('not generated');expect(ids).toEqual([1,2]);
  });
});
describe('composer descriptions and decision states',()=>{
  it('describes the performer left and right short throws independently',()=>{
    const s=sequenceFromBasicParts({roles:'alternate',left:'shuffle',right:'reverse',columns:'normal',shortHand:1});
    const d=ui.describeSequence(s);
    expect(d.fields).toContainEqual(['左手の2','2x Shuffle']);
    expect(d.fields).toContainEqual(['右手の2','2x Reverse Shuffle']);
    expect(d.title).not.toMatch(/SYNC-|3B-|[0-9a-f]{8}/);
  });
  it('distinguishes fixed roles, Double, held 2 and a self throw',()=>{
    const s=sequenceFromBasicParts({roles:'fixed',left:'inverted',right:'normal',columns:'normal',shortHand:0});
    expect(ui.describeSequence(s).fields).toContainEqual(['役割','短い投げは左手に固定']);
    const double=sequenceFromDoubleParts({crossSet:'shuffle',selfSet:'reverse'});
    expect(ui.describeSequence(double).rows).toHaveLength(4);
    const held=sequenceFromPreset('box');held.sets[0].throws=['2','2T'];
    expect(ui.describeSequence(held).rows[0].label).toContain('持ったまま運ぶ');
    expect(ui.describeSequence(held).rows[0].label).toContain('2T Normal（同じ手へ）');
  });
  it('expands mirror-repeat for names without changing the input',()=>{
    const s=sequenceFromPreset('box');s.sets=s.sets.slice(0,1);s.mirrorRepeat=true;
    s.sets[0].motion.hands=[{}, {style:'shuffle'}];const before=JSON.stringify(s);
    const d=ui.describeSequence(s);
    expect(d.fields).toContainEqual(['左手の2','2x Shuffle']);
    expect(d.fields).toContainEqual(['右手の2','2x Shuffle']);
    expect(JSON.stringify(s)).toBe(before);
  });
  it.each(['crossed','crossed-right','crossed-alternate'] as const)('exposes %s arm order',columns=>{
    const s=sequenceFromBasicParts({roles:'alternate',left:'normal',right:'normal',columns,shortHand:1});
    const d=ui.describeSequence(s);
    expect(d.title).toContain(columns==='crossed'?'左腕が上':columns==='crossed-right'?'右腕が上':'上下を交代');
  });
  it('retains underarm and claw as separate information',()=>{
    const s=sequenceFromPreset('box');s.sets[0].motion.hands=[{}, {style:'reverse',catchGrip:'overhand',shortMotion:{releaseRelation:'underarm'}}];
    const text=JSON.stringify(ui.describeSequence(s));
    expect(text).toContain('2xをクローで捕る');expect(text).toContain('2xを腕下で投げる');
  });
  it('identifies constant inline arrangement and custom coordinates',()=>{
    expect(ui.describeSequence(sequenceFromPreset('inline')).title).toContain('常に縦一列');
    const d=ui.describeSequence(SEQUENCE_EXAMPLES[47]);
    expect(JSON.stringify(d)).toContain('位置・経路の個別指定あり');
  });
  it('describes every preset and example without editing any motion',()=>{
    for(const s of [...SYNC_BOX_PRESETS.map(p=>sequenceFromPreset(p.id)),...SEQUENCE_EXAMPLES]){
      const before=JSON.stringify(s),d=ui.describeSequence(s);
      expect(d.title.length).toBeGreaterThan(0);expect(d.rows).toHaveLength(s.sets.length);expect(JSON.stringify(s)).toBe(before);
    }
  });
  it('never equates schedule validity to full model validation',()=>{
    const input={ready:true,valid:true};
    expect(ui.basicVerdict(input).state).toBe('pending');
    expect(ui.basicVerdict({...input,checked:true}).state).toBe('passed');
    expect(ui.basicVerdict({...input,failed:true}).title).toContain('再現できていません');
    expect(ui.basicVerdict({...input,failed:true}).next).toContain('技が不可能という意味ではありません');
    expect(ui.basicVerdict({...input,checked:true,valid:false}).state).toBe('failed');
    expect(ui.basicVerdict({...input,checked:true,ready:false}).state).toBe('pending');
  });
  it('keeps an open but closable route pending until the return is added',()=>{
    const route={sources:2,count:12,closed:false,canClose:true,closingSets:4};
    expect(ui.connectionVerdict(route)).toMatchObject({state:'pending'});
    expect(ui.connectionVerdict(route).next).toContain('4セット');
    expect(ui.connectionVerdict({...route,closed:true})).toMatchObject({state:'passed'});
    expect(ui.connectionVerdict({...route,canClose:false})).toMatchObject({state:'pending'});
    expect(ui.connectionVerdict({...route,count:0})).toMatchObject({state:'pending'});
  });
  it('separates partial transitions and cyclic source runs without counting them as full motions',()=>{
    const doc={sources:[{name:'Box'},{name:'Box → Claw',purpose:'transition'},{name:'Claw',mirror:true}],route:[{source:0,set:1},{source:0,set:0},{source:1,set:3},{source:1,set:4},{source:2,set:0},{source:2,set:1},{source:2,set:0},{source:2,set:1}]};
    expect(ui.routeGroups(doc,[{sets:2},{sets:8},{sets:2}])).toEqual([
      {source:0,start:1,last:0,count:2,name:'Box',transition:false,mirror:undefined,size:2},
      {source:1,start:3,last:4,count:2,name:'Box → Claw',transition:true,mirror:undefined,size:8},
      {source:2,start:0,last:1,count:4,name:'Claw',transition:false,mirror:true,size:2},
    ]);
    expect(ui.routeGroups({...doc,route:[{source:0,set:0},{source:0,set:0}]},[{sets:2}])).toHaveLength(2);
  });
});
