import {it,expect} from 'vitest';
import {analyzeSequence,expandSequence,findConnectionExamples,sequenceFromPreset,sequenceFromBasicParts,sequenceFromDoubleParts,sequenceHandDefinition,SEQUENCE_EXAMPLES,SyncSequence} from '../src/motion/juggling/sync-sequence';

const fixedLeft=sequenceFromBasicParts({roles:'fixed',left:'normal',right:'normal',shortHand:0});fixedLeft.sets[0].repeat=3;
const cross=(left:'normal'|'inverted',right:'normal'|'inverted')=>sequenceFromBasicParts({roles:'alternate',columns:'crossed-alternate',left,right,shortHand:1});
const pairs:[number,SyncSequence,SyncSequence][]=[
  [1,SEQUENCE_EXAMPLES[0],sequenceFromPreset('inverted')],
  [9,SEQUENCE_EXAMPLES[0],sequenceFromPreset('inline')],
  [22,SEQUENCE_EXAMPLES[17],SEQUENCE_EXAMPLES[18]],
  [24,SEQUENCE_EXAMPLES[7],SEQUENCE_EXAMPLES[23]],
  [27,SEQUENCE_EXAMPLES[0],fixedLeft],
  [29,SEQUENCE_EXAMPLES[4],SEQUENCE_EXAMPLES[28]],
  [32,SEQUENCE_EXAMPLES[0],SEQUENCE_EXAMPLES[30]],
  [33,SEQUENCE_EXAMPLES[7],SEQUENCE_EXAMPLES[31]],
  [34,cross('normal','inverted'),cross('inverted','normal')],
  [37,SEQUENCE_EXAMPLES[0],SEQUENCE_EXAMPLES[36]],
  [39,sequenceFromPreset('reverse'),SEQUENCE_EXAMPLES[38]],
  [41,sequenceFromPreset('box-roll'),SEQUENCE_EXAMPLES[40]],
  [44,SEQUENCE_EXAMPLES[40],SEQUENCE_EXAMPLES[43]],
  [46,SEQUENCE_EXAMPLES[38],SEQUENCE_EXAMPLES[45]],
  [48,sequenceFromBasicParts({roles:'fixed',shortHand:0,left:'inverted',right:'inverted'}),SEQUENCE_EXAMPLES[47]],
  [49,SEQUENCE_EXAMPLES[0],sequenceFromPreset('double-box')],
  [51,SEQUENCE_EXAMPLES[0],SEQUENCE_EXAMPLES[50]],
  [54,SEQUENCE_EXAMPLES[52],SEQUENCE_EXAMPLES[53]],
  [57,SEQUENCE_EXAMPLES[55],SEQUENCE_EXAMPLES[56]],
];
it.each(pairs)('元の2種類に対応する接続見本 %i を返し、入力を変更しない',(index,from,to)=>{
  const before=structuredClone([from,to]),result=findConnectionExamples(from,to);
  expect(result.map(r=>r.exampleIndex)).toEqual([index]);
  expect(result[0].sequence).toEqual(SEQUENCE_EXAMPLES[index]);
  expect(analyzeSequence(result[0].sequence)).toMatchObject({ok:true,balls:analyzeSequence(from).balls});
  expect([from,to]).toEqual(before);
});

it('名前と出典表示だけを変えた入力にも、動作が同じ接続見本を示す',()=>{
  const from=sequenceFromPreset('box'),to=structuredClone(SEQUENCE_EXAMPLES[36]);
  from.name='自分の開始';to.name='腕下の区間';from.sets[0].sourceName='自分の表示名';
  expect(findConnectionExamples(from,to).map(r=>r.exampleIndex)).toEqual([37]);
});

it('Double部品の手向きまで一致するShuffleだけを実演対応の接続見本に結ぶ',()=>{
  const from=sequenceFromDoubleParts({crossSet:'shuffle',selfSet:'normal',crossReleaseGrip:'underhand'});
  const to=sequenceFromDoubleParts({crossSet:'normal',selfSet:'shuffle',selfReleaseGrip:'underhand'});
  expect(findConnectionExamples(from,to).map(r=>r.exampleIndex)).toEqual([54]);
  const standard=sequenceFromDoubleParts({crossSet:'shuffle',selfSet:'normal'});
  expect(findConnectionExamples(standard,to)).toEqual([]);
});

it('同じ動きの周期でも、ユーザーが増やした周回を捨てる見本は提案しない',()=>{
  const from=sequenceFromPreset('box'),to=structuredClone(SEQUENCE_EXAMPLES[36]);
  const original=analyzeSequence(from).canonical;from.sets.push(...structuredClone(from.sets));
  expect(analyzeSequence(from).canonical).toBe(original);
  expect(findConnectionExamples(from,to)).toEqual([]);
  const repeatedTarget=structuredClone(to);repeatedTarget.sets.push(...structuredClone(to.sets));
  expect(findConnectionExamples(sequenceFromPreset('box'),repeatedTarget)).toEqual([]);
});

it('回数欄と左右交代欄を展開した結果が同じなら、同じ接続見本を示す',()=>{
  const from=structuredClone(SEQUENCE_EXAMPLES[17]);
  from.sets=[{...from.sets[0],repeat:2},{...from.sets[2],repeat:2}];
  expect(expandSequence(from)).toEqual(expandSequence(SEQUENCE_EXAMPLES[17]));
  expect(findConnectionExamples(from,SEQUENCE_EXAMPLES[18]).map(r=>r.exampleIndex)).toEqual([22]);
  const box=sequenceFromPreset('box');box.sets=box.sets.slice(0,1);box.mirrorRepeat=true;
  expect(findConnectionExamples(box,SEQUENCE_EXAMPLES[36]).map(r=>r.exampleIndex)).toEqual([37]);
});

it.each(['tempo','position','grip','route','throw'] as const)('編集済みの %s を既存の接続見本で上書きする提案をしない',kind=>{
  const from=sequenceFromPreset('box'),to=structuredClone(SEQUENCE_EXAMPLES[36]);
  if(kind==='tempo')from.beatDuration+=.01;
  if(kind==='position'){from.sets[0].motion.columnMotion=sequenceHandDefinition(from.sets[0],0);from.sets[0].motion.columnMotion.release.x+=.001;}
  if(kind==='grip')to.sets[0].motion.hands![0]!.catchGrip='overhand';
  if(kind==='route')to.sets[0].motion.hands![0]!.definition!.carry.amount+=.001;
  if(kind==='throw')from.sets[0].throws[0]='4x';
  expect(findConnectionExamples(from,to)).toEqual([]);
});

it('逆順と未対応の組合せは推測せず、返した見本の編集も登録内容へ影響しない',()=>{
  const from=sequenceFromPreset('box'),to=SEQUENCE_EXAMPLES[36];
  expect(findConnectionExamples(to,from)).toEqual([]);
  expect(findConnectionExamples(from,SEQUENCE_EXAMPLES[42])).toEqual([]);
  const result=findConnectionExamples(from,to)[0];result.sequence.sets[0].throws[0]='0';
  result.sequence.sets[0].motion.short=['inverted'];
  expect(findConnectionExamples(from,to)[0].sequence).toEqual(SEQUENCE_EXAMPLES[37]);
});

it('交互クロスの開始側を変えた列へ、元の上下関係の見本を提案しない',()=>{
  const from=cross('normal','inverted'),to=cross('inverted','normal');
  from.sets[0].motion.armPhase=1;
  expect(analyzeSequence(from).ok).toBe(true);
  expect(findConnectionExamples(from,to)).toEqual([]);
});
