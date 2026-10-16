import type {SyncSequence} from './sync-sequence';
import type {inspectSyncBox} from './sync-box';
import type {ArmCyclePlanInfo} from '../inspection';

export interface SyncCycleIssue {
  kind:'ball-spacing'|'ball-order'|'hand-spacing'|'reach'|'ownership'|'arm-path';
  message:string;
  /** Time in the rejected cycle, not in the restored preview. */
  phase?:number;
  armConstraint?:'arm-spacing'|'arm-relation'|'reach'|'posture'|'ball-arm'|'continuity';
  armClearance?:{sampledMaximum:number;required:number};
}
export interface SyncCycleFailure {
  period:number;
  issues:SyncCycleIssue[];
}

function armFailure(plan?:ArmCyclePlanInfo):Pick<SyncCycleIssue,'message'|'armConstraint'|'armClearance'>{
  const detail=plan?.reason==='no-feasible-pose'?plan.details:undefined,pair=detail?.pair;
  if(pair?.maxClearance!==null&&pair?.maxClearance!==undefined&&pair.maxClearance<pair.requiredClearance)return {
    armConstraint:'arm-spacing',armClearance:{sampledMaximum:pair.maxClearance,required:pair.requiredClearance},
    message:`左右の腕の間隔が不足しています。検査した姿勢では最大${(pair.maxClearance*100).toFixed(1)}cm（検査基準${(pair.requiredClearance*100).toFixed(1)}cm）です。投げ・捕りと途中の手の位置を離してください。`,
  };
  if(pair&&pair.maxClearance!==null&&(pair.maxRelatedClearance===null||pair.maxRelatedClearance<pair.requiredClearance))return {
    armConstraint:'arm-relation',message:pair.underarm?
      '指定した腕の下を通す関係と、腕どうしの間隔を同時に満たす姿勢が見つかりません。腕下で投げる・捕る位置と、反対の腕の運びを合わせて調整してください。':
      `クロスの${pair.upperHand===0?'左腕':'右腕'}を上に保ちながら、腕の間隔を確保できません。両手の高さと前後の位置を合わせて調整してください。`,
  };
  if(detail){
    const hand=detail.clear.findIndex(n=>n===0);
    if(hand>=0){
      const name=hand===0?'左':'右';
      if(detail.reachErrors[hand]>.008)return {armConstraint:'reach',message:`${name}手の向きを含めると、手首が届く範囲を超えています。位置を体に近づけ、投げ・捕りの手向きを確認してください。`};
      if(detail.posture[hand]?.clear===0)return {armConstraint:'posture',message:`${name}腕の曲げ方と体からの間隔を保てる姿勢が見つかりません。${name}手の位置・向きと、途中の運びを調整してください。`};
      return {armConstraint:'ball-arm',message:`${name}腕と球の間隔を確保できません。球が飛ぶ経路と、${name}手が戻る経路を離してください。`};
    }
  }
  if(plan?.reason==='no-continuous-path'||plan?.reason==='no-closed-path')return {armConstraint:'continuity',
    message:'各時点で取れる姿勢はありますが、腕を急に動かさず一周期につなぐ経路が見つかりません。捕ってから次に投げるまでの運びと、空の手の戻り方を調整してください。'};
  return {message:plan?.reason==='unsafe-interpolation'?
    '動作の途中で、腕の間隔または曲げ方を保てません。投げ・捕りの間の手の運びを調整してください。':
    '球と腕の間隔、クロスの上下関係、腕の曲げ方を保って1周期をつなげられません。'};
}

/** Capture the rejected candidate before restoring the last playable cycle. */
export function syncCycleFailure(geometry:ReturnType<typeof inspectSyncBox>,armPlan?:ArmCyclePlanInfo):SyncCycleFailure{
  const issues:SyncCycleIssue[]=[];
  if(geometry.ballOrderOK===false||geometry.ballOrderOK===undefined&&geometry.ballOrderClearance<0)issues.push({kind:'ball-order',message:'2xが先に通る球・後に通る球との上下関係を満たしていません。',phase:geometry.ballOrderPhase});
  if(!geometry.ballContactAllowed&&geometry.ballClearance<=0)issues.push({kind:'ball-spacing',message:'球どうしが近すぎます。球同士の接触を許可すると、腕の検査を続けられます。',phase:geometry.ballPhase});
  if(geometry.minHandDistance<=.09)issues.push({kind:'hand-spacing',message:'左右の手が近すぎます。手の運びや投げ・捕りの位置を離してください。',phase:geometry.handPhase});
  if(geometry.maxReachRatio>1)issues.push({kind:'reach',message:'手が届く範囲を超えています。投げ・捕り・運びの位置を体に近づけてください。',phase:geometry.reachPhase});
  if(geometry.ownershipConflicts)issues.push({kind:'ownership',message:'同じ手に球の受け渡しが重なっています。投げる順番と捕る時刻を確認してください。'});
  if(!issues.length){
    const phase=armPlan?.phase;
    issues.push({kind:'arm-path',...armFailure(armPlan),
      ...(Number.isFinite(phase)?{phase}:{}),
    });
  }
  return {period:geometry.period,issues};
}

/** The row active at this time can differ from the row that threw the ball. */
export function sequenceLocationAtPhase(sequence:SyncSequence,period:number,phase:number){
  if(!Number.isFinite(phase)||!Number.isFinite(period)||period<=0||!Number.isFinite(sequence.beatDuration)||sequence.beatDuration<=0)return undefined;
  const count=sequence.sets.reduce((n,row)=>n+row.repeat,0);
  if(!count)return undefined;
  const progress=((phase%1+1)%1)*period/(sequence.beatDuration*2);
  // Exact boundaries may arrive a few ulps before the next set.
  const absoluteSet=Math.floor(progress+1e-9),expandedSet=absoluteSet%(count*(sequence.mirrorRepeat?2:1));
  let remaining=expandedSet%count;
  const rowIndex=sequence.sets.findIndex(row=>{if(remaining<row.repeat)return true;remaining-=row.repeat;return false;});
  return {rowIndex,repeatIndex:remaining,expandedSet,mirrored:sequence.mirrorRepeat&&expandedSet>=count,
    withinSet:Math.max(0,progress-absoluteSet)};
}
