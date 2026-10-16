import {BasicColumnStyle,BasicShortStyle,sequenceFromBasicParts,sequenceFromDoubleParts,sequenceFromPreset,rotateSequenceStart,SEQUENCE_EXAMPLES} from './sync-sequence';

export interface BasicNetworkProgress {
  stage:'source'|'transition';
  completed:number;
  total:number;
  name:string;
}

/** Source-reviewed underarm primitives at their shared supported tempo. Each
 * joins the same base; later routes reuse those edges instead of new recipes. */
export function underarmNetworkPlan(){
  const sources=[sequenceFromPreset('box'),sequenceFromPreset('reverse'),...[36,38,45].map(i=>structuredClone(SEQUENCE_EXAMPLES[i]))];
  sources.push(...(['normal','inverted'] as const).map(style=>sequenceFromBasicParts({roles:'fixed',shortHand:0,left:style,right:style})),
    structuredClone(SEQUENCE_EXAMPLES[47]),sequenceFromPreset('box-roll'),structuredClone(SEQUENCE_EXAMPLES[40]),
    rotateSequenceStart(SEQUENCE_EXAMPLES[43],2));
  sources.forEach(s=>s.beatDuration=.25);
  return {sources,transitions:[...[1,2,3,4,5].map(to=>({from:0,to})),{from:5,to:6},{from:0,to:7},
    {from:0,to:8},{from:8,to:9},{from:9,to:10}]};
}

/** The currently fitted defaults, not a claim that excluded combinations are
 * impossible. Every definition and missing edge is checked on the loaded VRM.
 */
export function basicNetworkPlan(beat=.205){
  const columns:BasicColumnStyle[]=['normal','switched','crossed','crossed-right','underarm','crossed-alternate'];
  const styles:BasicShortStyle[]=['normal','shuffle','reverse','inverted'];
  const parts=columns.flatMap(columns=>styles.flatMap(left=>styles.map(right=>({columns,left,right})))).filter(p=>
    ['normal','switched','underarm'].includes(p.columns)||
    p.columns==='crossed'&&p.left==='normal'&&p.right==='reverse'||
    p.columns==='crossed-right'&&p.left==='reverse'&&p.right==='normal'||
    p.columns==='crossed-alternate'&&[p.left,p.right].every(s=>s==='normal'||s==='inverted')||p.left==='normal'&&p.right==='normal');
  parts.sort((a,b)=>Number(b.left==='normal'&&b.right==='normal')-Number(a.left==='normal'&&a.right==='normal'));
  const sources=parts.map(p=>({...sequenceFromBasicParts({...p,roles:'alternate',shortHand:1}),beatDuration:beat}));
  const transitions=parts.slice(1).map((p,i)=>({to:i+1,from:i+1<6?(i+1===5?1:0):
    parts.findIndex(base=>base.columns===p.columns&&base.left==='normal'&&base.right==='normal')}));
  // These accepted spatial primitives use the same tempo and ball count, but
  // cannot be described by the four endpoint-height labels in the parts grid.
  // Register their original definitions and connect each to one reachable
  // source. A spatial primitive need not have a direct bridge to Box.
  const spatial=['vertical-up','vertical-down','cross-side-vertical-up','cross-side-vertical-down',
    'lateral-normal','lateral-inverted','short-under-release','outside-vertical-up',
    'switched-outside-vertical-up','switched-center-vertical-up','switched-center-vertical-down','lateral-reverse',
    'outside-vertical-down','switched-outside-vertical-down','short-under-catch','lateral-shuffle','switched-cross-side-vertical-up','switched-cross-side-vertical-down'];
  const via:Record<string,string>={'outside-vertical-up':'cross-side-vertical-up','switched-outside-vertical-up':'vertical-up',
    'switched-center-vertical-up':'switched-inverted','switched-center-vertical-down':'switched-inverted','lateral-reverse':'lateral-normal',
    'outside-vertical-down':'cross-side-vertical-down','switched-outside-vertical-down':'outside-vertical-down','lateral-shuffle':'lateral-inverted',
    'switched-cross-side-vertical-up':'switched-center-vertical-up','switched-cross-side-vertical-down':'switched-cross-side-vertical-up'};
  const indices=new Map([['box',0],['switched-inverted',parts.findIndex(p=>p.columns==='switched'&&p.left==='inverted'&&p.right==='inverted')]]);
  for(const id of spatial){
    transitions.push({from:indices.get(via[id]||'box')!,to:sources.length});
    indices.set(id,sources.length);
    sources.push({...sequenceFromPreset(id),beatDuration:beat});
  }
  const doubles=styles.flatMap(crossSet=>styles.map(selfSet=>({crossSet,selfSet})));
  for(const pair of doubles){
    transitions.push({from:0,to:sources.length});
    sources.push({...sequenceFromDoubleParts(pair),beatDuration:beat});
  }
  return {parts,spatial,doubles,sources,transitions};
}
