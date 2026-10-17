import {MotionDefinition,CarryDefinition,carryOffset} from './sync-motion';
import {SyncSequence,SyncSequenceSet,analyzeSequence,sequenceFromPreset,sequenceFromBasicParts,sequenceHandDefinition,extractSequenceSet,expandSequence,SEQUENCE_EXAMPLES} from './sync-sequence';
import {SYNC_DWELL} from './sync-box';

function matches(s:SyncSequence,id:string){
  const template=sequenceFromPreset(id);
  if(s.mirrorRepeat||s.sets.length!==2||s.sets.some(r=>r.repeat!==1))return false;
  // A basic part states the same preset's 2x passes relative to the other balls.
  const relative=structuredClone(template);
  for(const row of relative.sets)row.motion.shortMotions=(row.motion.shortMotions||[{}]).map(o=>({...o,ballOrder:'style' as const}));
  const canonical=analyzeSequence({...s,allowBallContact:undefined,beatDuration:template.beatDuration}).canonical;
  return [template,relative].some(t=>analyzeSequence(t).canonical===canonical);
}

function matchesMixedCross(s:SyncSequence,left:'normal'|'inverted',right:'normal'|'inverted'){
  if(s.mirrorRepeat||s.sets.length!==2||s.sets.some(r=>r.repeat!==1))return false;
  const template=sequenceFromBasicParts({roles:'alternate',shortHand:1,columns:'crossed-alternate',left,right});
  return analyzeSequence({...s,allowBallContact:undefined,beatDuration:template.beatDuration}).canonical===analyzeSequence(template).canonical;
}

/** Reverse the fixed 4x lane through a front/back passage, keeping successive
 * high balls apart while the lane passes the centre. The short hand's empty
 * return stays forward so the elbow need not fold into the torso. */
export function fixedUnderarmInvertedTransition(a:SyncSequence,b:SyncSequence):SyncSequence|undefined{
  if(a.beatDuration!==b.beatDuration||[a,b].some(s=>s.mirrorRepeat||s.sets.length!==1||s.sets[0].repeat!==1))return;
  const basic=sequenceFromBasicParts({roles:'fixed',shortHand:0,left:'inverted',right:'inverted'}),underarm=SEQUENCE_EXAMPLES[47];
  const same=(s:SyncSequence,reference:SyncSequence)=>!s.mirrorRepeat&&s.sets.length===1&&s.sets[0].repeat===1&&
    analyzeSequence({...s,allowBallContact:undefined,beatDuration:reference.beatDuration}).canonical===analyzeSequence(reference).canonical;
  const from=same(a,basic)&&same(b,underarm)?a:same(b,basic)&&same(a,underarm)?b:undefined;
  if(!from)return;
  const to=from===a?b:a;
  const row=(t:number,returning:boolean):SyncSequenceSet=>({throws:['2x','4x'],repeat:1,
    sourceName:'固定Reverse-UAIへの移行 / 4xを前後に離す',motion:{columns:'normal',short:['inverted'],hands:[0,1].map(h=>{
      const f=sequenceHandDefinition(from.sets[0],h),g=sequenceHandDefinition(to.sets[0],h),d=structuredClone(g),blend=4*t*(1-t);
      for(const point of ['release','catch'] as const){
        delete d[point].relation;
        d[point].x=f[point].x*(1-t)+g[point].x*t;
        // An explicit underarm event raises the source reference plane by .085.
        d[point].y=f[point].y*(1-t)+(g[point].y+.085)*t;
        d[point].z=f[point].z*(1-t)+g[point].z*t-
          (h===1?(returning?.04:0)+(point==='release'?.10:-.10):-.06)*blend;
      }
      d.flightFraction=(1-SYNC_DWELL/(h===0?2:4))*(1-t)+g.flightFraction!*t;
      for(const kind of ['carry','emptyReturn'] as const){
        if(t===0||t===1){
          const source=t===0?f:g;
          if(kind==='carry')d.carry=structuredClone(source.carry);else d.emptyReturn=structuredClone(source.emptyReturn);
        }
        else d[kind]={route:'direct',amount:0,via:[.2,.4,.6,.8].map(at=>{
          const direct:CarryDefinition={route:'direct',amount:0};
          const offset=carryOffset(f[kind]||direct,at,1,1).lerp(carryOffset(g[kind]||direct,at,1,1),t);
          if(h===0&&kind==='emptyReturn')offset.z-=.12*blend*16*at*at*(1-at)*(1-at);
          return {at,offset:offset.toArray() as [number,number,number]};
        })};
      }
      return {definition:d,releaseGrip:'underhand' as const,catchGrip:'underhand' as const};
    }) as SyncSequenceSet['motion']['hands']}});
  const sequence:SyncSequence={...structuredClone(from),allowBallContact:a.allowBallContact||b.allowBallContact||undefined,name:'固定Inverted → HF Reverse-UAI → 固定Inverted',sets:[
    ...structuredClone(from.sets),...structuredClone(from.sets),...[0,.25,.5,.75,1].map(t=>row(t,false)),
    ...structuredClone(to.sets),...structuredClone(to.sets),...[1,.75,.5,.25,0].map(t=>row(t,true))]};
  return analyzeSequence(sequence).ok?sequence:undefined;
}

/** Connect the accepted upper-short-pass In-line shape without changing either
 * source. Separate the short pass laterally while changing its vertical rank,
 * bring it back toward the body at the top, and adopt the target empty-hand
 * routes before all three balls share one vertical line. */
export function upperInlineTransition(a:SyncSequence,b:SyncSequence):SyncSequence|undefined {
  if(a.beatDuration!==b.beatDuration||[a,b].every(s=>s.sets.every(r=>r.motion.arrangement!=='inline')))return;
  if(!(matches(a,'box')&&matches(b,'inline-inverted')||matches(b,'box')&&matches(a,'inline-inverted')))return;
  const from=matches(a,'box')?a:b,to=from===a?b:a;
  const targetColumn=sequenceHandDefinition(to.sets[0],0),targetShort=sequenceHandDefinition(to.sets[0],1);
  const empty=(route:CarryDefinition,t:number):CarryDefinition=>({...structuredClone(route),amount:route.amount*t,
    via:route.via?.map(v=>({at:v.at,offset:v.offset.map(n=>n*t) as [number,number,number]}))});
  const bridge=(blends:number[]):SyncSequenceSet[]=>blends.flatMap(inlineBlend=>{
    // These are pre-blend coordinates. The existing In-line interpolator also
    // moves the pass forward; compensate at the high stages to stay reachable.
    const z=inlineBlend<=.25?-.34:inlineBlend<.5?-.34+(inlineBlend-.25)/.25*.44:.10;
    return from.sets.map(row=>({throws:[...row.throws],repeat:1,sourceName:'上側In-line 3への移行',motion:{
      columns:'normal',short:['inverted'],arrangement:'columns',inlineBlend,transition:true,
      shortMotions:[{definition:{release:{x:.42,y:0,z},catch:{x:-.42,y:0,z},passage:{at:.5},
        carry:{route:'direct',amount:0},emptyReturn:empty(targetShort.emptyReturn!,inlineBlend)}}],
      columnMotion:{release:{x:.19,y:0,z:-.30},catch:{x:.19,y:0,z:-.30},passage:{at:.5},
        carry:{route:'direct',amount:0},emptyReturn:empty(targetColumn.emptyReturn!,inlineBlend)},
    }}));
  });
  return {...structuredClone(from),allowBallContact:a.allowBallContact||b.allowBallContact||undefined,name:'Box → In-line 3 / 上の2x → Box',mirrorRepeat:false,sets:[
    ...structuredClone(from.sets),...structuredClone(from.sets),...bridge([.1,.2,.3,.4,.5,.65,.8,.9,1]),
    ...structuredClone(to.sets),...structuredClone(to.sets),...bridge([.9,.8,.65,.5,.4,.3,.2,.1,0])]};
}

/** Materialize the known layouts into free-arm coordinates for bridge rows. */
function definition(row:SyncSequenceSet,h:number):MotionDefinition {
  const d=sequenceHandDefinition(row,h);
  if(row.motion.columns==='underarm'||row.motion.columns==='switched'){
    d.release.y+=.025;d.catch.y+=.025;
    if(row.motion.columns==='underarm'&&row.throws[h]==='2x'){d.release.y+=.24;d.catch.y+=.24;d.catch.x=-.025;}
  }
  if(row.motion.columns==='crossed'){
    const phase=row.motion.armPhase??(row.throws[0]==='4'?0:1),order=row.motion.armOrder||'left-over';
    const upper=(set:number)=>order==='right-over'?1:order==='alternate'?set%2:0;
    const receiver=row.throws[h]==='2x'?1-h:h;
    for(const [p,hand,set] of [[d.release,h,phase],[d.catch,receiver,phase+(row.throws[h]==='2x'?1:2)]] as const){
      const sign=hand===upper(set)?1:-1;p.y+=.08+sign*.07;p.z-=sign*.02;
    }
  }
  return d;
}

/** Insert intermediate throw positions for equal hand-off schedules. The
 * following catch-to-release intervals move the hands between those positions.
 * This constructor depends on the states, never on names or a list of pairs.
 * Different schedules still use the arrival-state bridge before spatial search. */
export function movementStateTransition(a:SyncSequence,b:SyncSequence,stages=2,separation=0,lift=0,stagger=0,travelDepth=0,anticipate=false,detour:'direct'|'circle'|'retract'='direct'):SyncSequence|undefined {
  if(a.beatDuration!==b.beatDuration)return;
  const first=expandSequence(a),second=expandSequence(b);
  const gcd=(x:number,y:number):number=>y?gcd(y,x%y):x;
  const count=first.length*second.length/gcd(first.length,second.length);
  if(4*count+2*(stages+1)*count>64)return;
  if([...first,...second].some(r=>r.motion.arrangement==='inline'||r.motion.inlineBlend||
    r.motion.hands?.some(h=>h?.heightOffset)||r.throws.some(t=>t==='0'||t==='2'||t==='2T')))return;
  if(Array.from({length:count},(_,i)=>i).some(i=>first[i%first.length].throws.join()!==second[i%second.length].throws.join()))return;
  const cycle=(s:SyncSequenceSet[])=>Array.from({length:count},(_,i)=>structuredClone(s[i%s.length]));
  const bridge=(f:SyncSequenceSet[],g:SyncSequenceSet[])=>Array.from({length:stages+1},(_,stage)=>{
    const t=stage/stages;
    if(!anticipate&&(t===0||t===1))return cycle(t===0?f:g);
    // The first/last connecting cycle still receives balls from a different
    // state. It must remain a movement state, with free throw/catch waypoints
    // and no premature fixed crossing order. Stable source cycles outside
    // this bridge retain their original events and arm-order constraints.
    return Array.from({length:count},(_,i)=>{
      const from=f[i%f.length],to=g[i%g.length];
      const hands=([0,1] as const).map(h=>{
        const x=definition(from,h),y=definition(to,h);
        const short=from.throws[h].startsWith('2'),value=parseInt(from.throws[h][0],36);
        const progress=(phase:number)=>{
          const p=stagger?Math.max(0,Math.min(1,2*phase-Number(short===(stagger>0)))):Math.max(0,Math.min(1,phase));
          // Enter and leave an accepted state with zero first/second change
          // in its working region, while balls from that state are airborne.
          return anticipate?p*p*p*(10+p*(-15+6*p)):p;
        };
        const u=progress(t),catchU=anticipate?progress((stage+value/(2*count))/stages):u;
        // A 4 is caught two sets later, and a 2x one set later. Aim its catch
        // at that future working region; using the release region for both
        // endpoints forced a fast return just as the next state began.
        const point=(key:'release'|'catch')=>{
          const v=key==='catch'?catchU:u;
          const upper=from.motion.armOrder==='right-over'?1:from.motion.armOrder==='alternate'?(from.motion.armPhase??i%2):0;
          const sign=h===upper?1:-1,arc=1-Math.cos(2*Math.PI*v),radius=.055;
          return {x:x[key].x*(1-v)+y[key].x*v+(detour==='circle'?sign*(h===0?-1:1)*radius*Math.sin(2*Math.PI*v):0),
            y:x[key].y*(1-v)+y[key].y*v+lift*(h===0?1:-1)*Math.sin(Math.PI*v)-(detour==='direct'?0:sign*radius*arc),
            z:x[key].z*(1-v)+y[key].z*v+(travelDepth+separation*(h===0?1:-1))*Math.sin(Math.PI*v)+
              (detour==='retract'?sign*radius*Math.sin(2*Math.PI*v)*Math.sin(Math.PI*v):0)};
        };
        const route=(key:'carry'|'emptyReturn'):CarryDefinition=>({route:'direct',amount:0,via:[.25,.5,.75].map(at=>({at,
          offset:carryOffset(x[key]||{route:'direct',amount:0},at,1,1).lerp(carryOffset(y[key]||{route:'direct',amount:0},at,1,1),u).toArray() as [number,number,number]}))});
        const fraction=1-SYNC_DWELL/value;
        return {definition:{release:point('release'),catch:point('catch'),passage:{at:.5},
          flightFraction:(x.flightFraction??fraction)*(1-u)+(y.flightFraction??fraction)*u,
          carry:route('carry'),emptyReturn:route('emptyReturn'),...(anticipate?{emptyReturnExact:true}:{})},
          releaseGrip:(anticipate&&u>=.5?to:from).motion.hands?.[h]?.releaseGrip,
          catchGrip:(anticipate&&catchU<.5?from:to).motion.hands?.[h]?.catchGrip};
      }) as SyncSequenceSet['motion']['hands'];
      return {throws:[...from.throws] as [string,string],repeat:1,sourceName:'次の投げ位置へ移る',
        motion:{columns:'normal' as const,short:['normal' as const],transition:true,hands}};
    });
  }).flat();
  const sequence:SyncSequence={...structuredClone(a),allowBallContact:a.allowBallContact||b.allowBallContact||undefined,mirrorRepeat:false,name:'投げ位置を移してつなぐ',
    sets:[...cycle(first),...cycle(first),...bridge(first,second),...cycle(second),...cycle(second),...bridge(second,first)]};
  return analyzeSequence(sequence).ok?sequence:undefined;
}

/** Search common entry/exit corridors, independent of technique names. The
 * score is guidance only; callers still certify the complete arm cycle. */
export function rankedMovementStateTransitions(a:SyncSequence,b:SyncSequence,score:(s:SyncSequence)=>number):SyncSequence[]{
  const candidates:{sequence:SyncSequence;cost:number}[]=[];
  for(const stages of [4,8])for(const stagger of [-1,0,1])for(const lift of [-.08,0,.08])for(const separation of [-.06,0,.06])for(const depth of [0,-.03,-.06]){
    const sequence=movementStateTransition(a,b,stages,separation,lift,stagger,depth,true);if(!sequence)continue;
    try{const cost=score(sequence);if(Number.isFinite(cost))candidates.push({sequence,cost});}catch{ /* Reject only this corridor. */ }
  }
  return candidates.sort((a,b)=>a.cost-b.cost).slice(0,8).map(c=>c.sequence);
}

/** Shift vertical lanes gradually while each hand keeps its column.
 * The two original cycles remain intact; every new bridge is still checked on
 * the loaded rig and must match the registered physical boundary states.
 */
export function spatialLaneTransition(a:SyncSequence,b:SyncSequence):SyncSequence|undefined {
  if(a.beatDuration!==b.beatDuration)return;
  const pairs:{from:string;to:string;lift:number;emptyWidth:number;swapHeight?:boolean}[]=[
    {from:'cross-side-vertical-down',to:'outside-vertical-down',lift:0,emptyWidth:0},
    // Opposite columns cross the short hand during a flat lane change. Lift
    // the vertical pass temporarily and separate the returning empty hands.
    {from:'switched-center-vertical-up',to:'switched-cross-side-vertical-up',lift:.12,emptyWidth:.10},
    // Keep the inward elbow preference while exchanging the short pass's
    // release/catch heights. Intermediate passes use ballistic timing; each
    // endpoint retains its original upward/drop flight duration.
    {from:'switched-cross-side-vertical-up',to:'switched-cross-side-vertical-down',lift:0,emptyWidth:0,swapHeight:true},
  ];
  const pair=pairs.find(p=>matches(a,p.from)&&matches(b,p.to)||matches(b,p.from)&&matches(a,p.to));
  if(!pair)return;
  const from=matches(a,pair.from)?a:b,to=from===a?b:a;
  const bridge=(first:SyncSequence,second:SyncSequence):SyncSequenceSet[]=>[0,.25,.5,.75,1].flatMap(t=>first.sets.map((row,i)=>{
    const style=pair.swapHeight?(t===0?row.motion.short![0]:t===1?second.sets[i].motion.short![0]:'normal'):row.motion.short![0];
    return {
    throws:[...row.throws] as [string,string],repeat:1,sourceName:'縦2xの投げ・捕り位置を移す',
    motion:{columns:pair.swapHeight?'switched':'normal',short:pair.swapHeight?[style]:row.motion.short?.slice(),hands:[0,1].map(h=>{
      const f=definition(row,h),g=definition(second.sets[i],h),short=row.throws[h]==='2x';
      const point=(k:'release'|'catch')=>({x:f[k].x*(1-t)+g[k].x*t,
        y:f[k].y*(1-t)+g[k].y*t+(short?pair.lift*4*t*(1-t):0)-(pair.swapHeight?.025:0),z:f[k].z*(1-t)+g[k].z*t});
      const route=(k:'carry'|'emptyReturn'):CarryDefinition|undefined=>{
        if(t===0)return structuredClone(f[k]);if(t===1)return structuredClone(g[k]);
        return {route:'direct',amount:0,via:[.2,.4,.6,.8].map(at=>{
          const offset=carryOffset(f[k]||{route:'direct',amount:0},at,1,1)
            .lerp(carryOffset(g[k]||{route:'direct',amount:0},at,1,1),t);
          if(k==='emptyReturn')offset.x+=pair.emptyWidth*4*t*(1-t)*16*at*at*(1-at)*(1-at);
          return {at,offset:offset.toArray() as [number,number,number]};
        })};
      };
      return {definition:{release:point('release'),catch:point('catch'),passage:{at:.5},carry:route('carry')!,emptyReturn:route('emptyReturn')},
        ...(short?{style,...(pair.swapHeight?{releaseGrip:'overhand' as const}:{})}:{})};
    }) as SyncSequenceSet['motion']['hands']},
  };}));
  const sequence:SyncSequence={...structuredClone(from),allowBallContact:a.allowBallContact||b.allowBallContact||undefined,name:'縦2xの位置を移す往復',sets:[
    ...structuredClone(from.sets),...structuredClone(from.sets),...bridge(from,to),
    ...structuredClone(to.sets),...structuredClone(to.sets),...bridge(to,from),
  ]};
  return analyzeSequence(sequence).ok?sequence:undefined;
}

/** Move the columns one stage before entering an underarm catch, and move the
 * short passes first on departure. Columns remain airborne across set borders;
 * moving both roles together puts an earlier column in the catching forearm.
 */
export function underarmCatchTransition(a:SyncSequence,b:SyncSequence):SyncSequence|undefined {
  if(a.beatDuration!==b.beatDuration)return;
  let box:SyncSequence,target:SyncSequence;
  if(matches(a,'box')&&matches(b,'short-under-catch')){box=a;target=b;}
  else if(matches(b,'box')&&matches(a,'short-under-catch')){box=b;target=a;}
  else return;
  const points=(row:SyncSequenceSet,h:number)=>{
    const d=sequenceHandDefinition(row,h);
    // Legacy short-under-catch uses a raised layout and a catch endpoint
    // override. Explicit per-hand bridge definitions must materialize both.
    const under=row.motion.shortMotions?.some(m=>m.catchRelation==='underarm');
    if(under){
      d.release.y+=.085;d.catch.y+=.085;
      if(row.throws[h]==='2x'){d.catch.x=.18;d.catch.y-=.16;d.catch.z=-.18;}
    }
    return d;
  };
  const clamp=(v:number)=>Math.max(0,Math.min(1,v));
  const bridge=(from:SyncSequence,to:SyncSequence):SyncSequenceSet[]=>[-.25,0,.25,.5,.75,1].flatMap(phase=>from.sets.map((row,i)=>{
    const shortProgress=clamp(phase+(from===box?0:.25));
    const under=from===box?shortProgress===1:shortProgress===0;
    return {throws:[...row.throws] as [string,string],repeat:1,sourceName:'コラムと2xの位置を順に移す',
      motion:{columns:'normal',short:row.motion.short?.slice(),hands:[0,1].map(h=>{
        const f=points(row,h),g=points(to.sets[i],h),short=row.throws[h]==='2x';
        const t=clamp(phase+((from===box?!short:short)?.25:0));
        const point=(k:'release'|'catch')=>({x:f[k].x*(1-t)+g[k].x*t,
          y:f[k].y*(1-t)+g[k].y*t-(under?.085:0),z:f[k].z*(1-t)+g[k].z*t,
          relation:t===0?f[k].relation:t===1?g[k].relation:undefined});
        const route=(k:'carry'|'emptyReturn'):CarryDefinition|undefined=>{
          if(t===0)return structuredClone(f[k]);if(t===1)return structuredClone(g[k]);
          return {route:'direct',amount:0,via:[.2,.4,.6,.8].map(at=>({at,
            offset:carryOffset(f[k]||{route:'direct',amount:0},at,1,1)
              .lerp(carryOffset(g[k]||{route:'direct',amount:0},at,1,1),t).toArray() as [number,number,number]}))};
        };
        return {definition:{release:point('release'),catch:point('catch'),passage:{at:.5},carry:route('carry')!,emptyReturn:route('emptyReturn')},
          ...(short?{style:row.motion.short![0]}:{})};
      }) as SyncSequenceSet['motion']['hands']}};
  }));
  const sequence:SyncSequence={...structuredClone(box),allowBallContact:a.allowBallContact||b.allowBallContact||undefined,name:'2xの腕下捕球へ移る往復',sets:[
    ...structuredClone(box.sets),...structuredClone(box.sets),...bridge(box,target),
    ...structuredClone(target.sets),...structuredClone(target.sets),...bridge(target,box),
  ]};
  return analyzeSequence(sequence).ok?sequence:undefined;
}

/** Change lateral transfer height using underhand bridge throws. The original
 * Shuffle cycle keeps its claw release. Empty hands fan apart while their
 * vertical order changes, without altering any airborne or held ball route.
 */
export function lateralShuffleTransition(a:SyncSequence,b:SyncSequence):SyncSequence|undefined {
  if(a.beatDuration!==b.beatDuration)return;
  let from:SyncSequence,to:SyncSequence;
  if(matches(a,'lateral-inverted')&&matches(b,'lateral-shuffle')){from=a;to=b;}
  else if(matches(b,'lateral-inverted')&&matches(a,'lateral-shuffle')){from=b;to=a;}
  else return;
  const bridge=(first:SyncSequence,second:SyncSequence):SyncSequenceSet[]=>[0,.25,.5,.75,1].flatMap(t=>first.sets.map((row,i)=>({
    throws:[...row.throws] as [string,string],repeat:1,sourceName:'空の手を分け、横送りの捕球高を移す',
    motion:{columns:'normal',short:row.motion.short?.slice(),hands:[0,1].map(h=>{
      const f=definition(row,h),g=definition(second.sets[i],h);
      const point=(k:'release'|'catch')=>({x:f[k].x*(1-t)+g[k].x*t,y:f[k].y*(1-t)+g[k].y*t,z:f[k].z*(1-t)+g[k].z*t,
        relation:t===0?f[k].relation:t===1?g[k].relation:undefined});
      const route=(k:'carry'|'emptyReturn'):CarryDefinition|undefined=>{
        if(t===0)return structuredClone(f[k]);if(t===1)return structuredClone(g[k]);
        return {route:'direct',amount:0,via:[.2,.4,.6,.8].map(at=>{
          const offset=carryOffset(f[k]||{route:'direct',amount:0},at,1,1)
            .lerp(carryOffset(g[k]||{route:'direct',amount:0},at,1,1),t);
          if(k==='emptyReturn')offset.x+=.10*4*t*(1-t)*16*at*at*(1-at)*(1-at);
          return {at,offset:offset.toArray() as [number,number,number]};
        })};
      };
      return {definition:{release:point('release'),catch:point('catch'),passage:{at:.5},carry:route('carry')!,emptyReturn:route('emptyReturn')},
        ...(row.throws[h]==='2x'?{style:row.motion.short![0],releaseGrip:'underhand' as const}:{})};
    }) as SyncSequenceSet['motion']['hands']},
  })));
  const sequence:SyncSequence={...structuredClone(from),allowBallContact:a.allowBallContact||b.allowBallContact||undefined,name:'横送りのInvertedとShuffleを切り替える往復',sets:[
    ...structuredClone(from.sets),...structuredClone(from.sets),...bridge(from,to),
    ...structuredClone(to.sets),...structuredClone(to.sets),...bridge(to,from),
  ]};
  return analyzeSequence(sequence).ok?sequence:undefined;
}

/** A spatial candidate for exchanging column receivers with two 4x throws.
 * Deliberately match the supported source definitions, not their display names.
 * This is not a validation certificate: the loaded avatar and both graph ports
 * must still pass the ordinary transition registration checks.
 */
export function columnReceiverHandoff(a:SyncSequence,b:SyncSequence):SyncSequence|undefined {
  if(a.beatDuration!==b.beatDuration)return;
  const opposite=(s:SyncSequence)=>['underarm','switched','switched-shuffle','switched-inverted','crossed','crossed-right'].some(id=>matches(s,id));
  let box:SyncSequence,target:SyncSequence;
  const laneHandoff=(x:SyncSequence,y:SyncSequence)=>matches(x,'outside-vertical-down')&&matches(y,'switched-outside-vertical-down');
  if(matches(a,'box')&&opposite(b)){box=a;target=b;}
  else if(matches(b,'box')&&opposite(a)){box=b;target=a;}
  else if(laneHandoff(a,b)){box=a;target=b;}
  else if(laneHandoff(b,a)){box=b;target=a;}
  else return;
  const bridge=(from:SyncSequence,to:SyncSequence,high:0|1):SyncSequenceSet[]=>{
    const fromRow=(h:number)=>from.sets.find(r=>r.throws[h]==='4')!;
    const toRow=(h:number)=>to.sets.find(r=>r.throws[h]==='4')!;
    const crossed=(h:number)=>{
      const start=definition(fromRow(h),h),end=definition(toRow(1-h),1-h);
      const catchPoint={...end.catch,x:-end.catch.x};
      const enteringCross=toRow(h).motion.columns==='crossed'&&h!==high;
      const keepRelease=fromRow(h).motion.columns!=='normal'||enteringCross;
      return {definition:{release:keepRelease?start.release:{...catchPoint},catch:catchPoint,passage:{at:.5},
        carry:{route:'front',amount:.06},emptyReturn:enteringCross?{route:'back',amount:.12}:keepRelease?start.emptyReturn:{route:'front',amount:.12}} as MotionDefinition};
    };
    const pass=definition(fromRow(high),1-high),held={...pass.catch,x:-pass.catch.x};
    if(fromRow(high).motion.columns==='switched'&&fromRow(high).motion.short?.[0]==='inverted')
      pass.emptyReturn={route:'front',amount:.14};
    const nextPass=definition(toRow(1-high),high),enteringCross=toRow(high).motion.columns==='crossed',leavingCross=fromRow(high).motion.columns==='crossed';
    if(leavingCross)pass.carry={route:'direct',amount:0,via:[{at:.5,offset:[0,.12,0]}]};
    const descending=held.y>nextPass.release.y;
    // Start carrying as soon as the pass is caught. Holding at the old high
    // center until the next set makes the forearm meet the rising column.
    const holdPoint=descending?{...held,x:.24,y:Math.max(.20,held.y-.15),z:leavingCross?-.24:Math.max(-.36,held.z-.10)}:
      {...nextPass.release,x:enteringCross?nextPass.release.x:Math.max(held.x,nextPass.release.x)+.10};
    const hold={definition:{release:holdPoint,catch:{...holdPoint},passage:{at:.5},carry:{route:'front',amount:enteringCross?0:.08}} as MotionDefinition};
    return [
      {throws:high===0?['4x','2x']:['2x','4x'],repeat:1,sourceName:'コラムの担当を受け渡す',
        motion:{columns:'normal',short:['normal'],hands:high===0?[crossed(0),{definition:pass,style:fromRow(high).motion.short?.[0]}]:[{definition:pass,style:fromRow(high).motion.short?.[0]},crossed(1)]}},
      {throws:high===0?['2','4x']:['4x','2'],repeat:1,sourceName:'短い球を保持して担当を交替',
        motion:{columns:'normal',short:['normal'],hands:high===0?[hold,crossed(1)]:[crossed(0),hold]}},
    ];
  };
  // Begin a fixed cross with its lower hand; the return then carries the held
  // ball above the other arm. Left/right upper variants use reflected orders.
  const firstHigh:0|1=target.sets[0].motion.armOrder==='left-over'?1:0;
  const firstRows=[box.sets[firstHigh],box.sets[1-firstHigh]];
  const rotated=[target.sets[1-firstHigh],target.sets[firstHigh]];
  const result:SyncSequence={...structuredClone(box),allowBallContact:a.allowBallContact||b.allowBallContact||undefined,name:'コラムの担当を受け渡す移行',sets:[
    ...structuredClone(firstRows),...structuredClone(firstRows),...bridge(box,target,firstHigh),
    ...structuredClone(rotated),...structuredClone(rotated),...bridge(target,box,(1-firstHigh) as 0|1),
  ]};
  return analyzeSequence(result).ok?result:undefined;
}

/** Change one transfer height without changing which hand owns each column.
 * The mirrored temporal order matters: the second pass carries into the next
 * stage. Preserve its original cross phase when starting with the other hand.
 */
export function mixedAlternatingCrossTransition(a:SyncSequence,b:SyncSequence):SyncSequence|undefined {
  if(a.beatDuration!==b.beatDuration)return;
  let base:SyncSequence,target:SyncSequence,startRight:boolean;
  const side=(s:SyncSequence)=>matchesMixedCross(s,'inverted','normal')?0:matchesMixedCross(s,'normal','inverted')?1:-1;
  if(matches(a,'crossed-alternate')&&side(b)>=0){base=a;target=b;startRight=side(b)===1;}
  else if(matches(b,'crossed-alternate')&&side(a)>=0){base=b;target=a;startRight=side(a)===1;}
  else return;
  const rows=(s:SyncSequence)=>startRight?[extractSequenceSet(s,1),extractSequenceSet(s,0)]:structuredClone(s.sets);
  const first=rows(base),second=rows(target);
  const bridge=(from:SyncSequenceSet[],to:SyncSequenceSet[]):SyncSequenceSet[]=>[0,.25,.5,.75,1].flatMap(t=>from.map((row,i)=>({
    throws:[...row.throws] as [string,string],repeat:1,sourceName:'上下交代の2xの高さを移す',
    motion:{columns:'normal',short:['normal'],hands:[0,1].map(h=>{
      const f=definition(row,h),g=definition(to[i],h);
      const point=(k:'release'|'catch')=>({x:f[k].x*(1-t)+g[k].x*t,y:f[k].y*(1-t)+g[k].y*t,z:f[k].z*(1-t)+g[k].z*t});
      return {definition:{release:point('release'),catch:point('catch'),passage:{at:.5},carry:structuredClone(f.carry),emptyReturn:structuredClone(f.emptyReturn)}};
    }) as SyncSequenceSet['motion']['hands']},
  })));
  const result:SyncSequence={...structuredClone(base),allowBallContact:a.allowBallContact||b.allowBallContact||undefined,name:'上下交代クロスの2xを切り替える移行',sets:[
    ...structuredClone(first),...structuredClone(first),...bridge(first,second),
    ...structuredClone(second),...structuredClone(second),...bridge(second,first),
  ]};
  return analyzeSequence(result).ok?result:undefined;
}

/** Keep column ownership while entering/leaving alternating crossed hands.
 * Only matching supported definitions select this candidate. The caller must
 * validate the complete motion and its ports for the current avatar/tempo.
 */
export function alternatingCrossTransition(a:SyncSequence,b:SyncSequence):SyncSequence|undefined {
  if(a.beatDuration!==b.beatDuration)return;
  const supported=(s:SyncSequence)=>matches(s,'crossed-alternate')||matchesMixedCross(s,'inverted','inverted');
  let switched:SyncSequence,alternate:SyncSequence;
  if(matches(a,'switched')&&supported(b)){switched=a;alternate=b;}
  else if(matches(b,'switched')&&supported(a)){switched=b;alternate=a;}
  else return;
  const bothHigh=alternate.sets.every(r=>r.motion.short?.[0]==='inverted');
  const bridge=(from:SyncSequence,to:SyncSequence):SyncSequenceSet[]=>{
    const enteringHigh=bothHigh&&to===alternate,leavingHigh=bothHigh&&from===alternate;
    const rows:SyncSequenceSet[]=[0,.25,.5,.75,1].flatMap(t=>from.sets.map((row,i)=>({
    throws:[...row.throws] as [string,string],repeat:1,sourceName:t===0?'位置変更前の運びを準備する':'上下交代の配置へ移る',
    motion:{columns:'normal',short:['normal'],hands:[0,1].map(h=>{
      const f=definition(row,h),g=definition(to.sets[i],h),short=row.throws[h]==='2x',middle=t>0&&t<1;
      const highY=definition(row,1-h).release.y*(1-t)+definition(to.sets[i],1-h).release.y*t;
      // Keep the short pass outside and above the columns while moving lanes.
      // Its held return performs the final side/height change independently.
      const point=(k:'release'|'catch')=>({
        x:short&&middle?(k==='release'?.18:-.18):f[k].x*(1-t)+g[k].x*t,
        y:short&&middle?highY+.24:f[k].y*(1-t)+g[k].y*t,
        z:short&&middle?-.44:f[k].z*(1-t)+g[k].z*t,
      });
      const route=(k:'carry'|'emptyReturn'):CarryDefinition=>{
        // Carry belongs to the catch of this throw, possibly in the NEXT set.
        // Only the second short pass crosses a stage boundary. Applying its
        // large detour to the first pass unnecessarily exceeds arm reach.
        if(k==='carry'&&t===0&&from.sets[i].motion.armOrder==='alternate')
          return !short||i===0?structuredClone(f.carry):{route:'direct',amount:0,via:[{at:.5,offset:[.28,0,-.09]}]};
        if(k==='carry'&&t===.75&&to.sets[i].motion.armOrder==='alternate'&&(!short||i===1)&&(!enteringHigh||short))
          return {route:'direct',amount:0,via:[{at:.5,offset:short?[.28,0,-.09]:[0,.14,0]}]};
        if(k==='emptyReturn'&&middle)return {route:short?'outside':'front',amount:short?.30:.12};
        if(k==='carry')return {route:'direct',amount:0};
        return {route:'direct',amount:0,via:[.25,.5,.75].map(at=>({at,
          offset:carryOffset(f[k]||{route:'direct',amount:0},at,1,1).lerp(carryOffset(g[k]||{route:'direct',amount:0},at,1,1),t).toArray() as [number,number,number]}))};
      };
      return {definition:{release:point('release'),catch:point('catch'),passage:{at:.5},carry:route('carry'),emptyReturn:route('emptyReturn')}};
    }) as SyncSequenceSet['motion']['hands']},
    })));
    // A low column / high transfer needs the source's crossed elbow preference
    // at the catch. Free-arm coordinates alone preserve ball paths but change
    // the candidate elbow circles at exactly that boundary.
    if(enteringHigh)rows.splice(-2,2,...structuredClone(to.sets));
    if(leavingHigh){
      const prep=structuredClone(from.sets),short=sequenceHandDefinition(prep[1],0);
      short.carry={route:'direct',amount:0,via:[{at:.5,offset:[.28,0,-.09]}]};
      prep[1].motion.hands=[{definition:short},undefined];rows.splice(0,2,...prep);
      // Retain this preference through the first spatial change. Convert the
      // explicit points back into the crossed layout so positions stay exact.
      for(const row of rows.slice(2,4)){
        const phase:0|1=row.throws[0]==='4'?0:1;
        row.motion.columns='crossed';row.motion.armOrder='alternate';row.motion.armPhase=phase;
        row.motion.hands!.forEach((hand,h)=>{
          const d=hand!.definition!;
          for(const [p,receiver,set] of [[d.release,h,phase],[d.catch,row.throws[h]==='2x'?1-h:h,phase+(row.throws[h]==='2x'?1:2)]] as const){
            const sign=receiver===set%2?1:-1;p.y-=.08+sign*.07;p.z+=sign*.02;
          }
        });
      }
    }
    return rows;
  };
  const result:SyncSequence={...structuredClone(switched),allowBallContact:a.allowBallContact||b.allowBallContact||undefined,name:'Switchedと上下交代クロスの移行',sets:[
    ...structuredClone(switched.sets),...structuredClone(switched.sets),...bridge(switched,alternate),
    ...structuredClone(alternate.sets),...structuredClone(alternate.sets),...bridge(alternate,switched),
  ]};
  return analyzeSequence(result).ok?result:undefined;
}
