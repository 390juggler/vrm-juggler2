import {it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {analyzeSequence,sequenceFromDoubleParts} from '../src/motion/juggling/sync-sequence';

const catalog=JSON.parse(readFileSync('dist/sync-catalog.json','utf8'));
const source=JSON.parse(readFileSync('docs/sync-box-catalog.json','utf8'));
const records: any[]=catalog.records;
const doubles=records.filter(r=>r.component_refs);

it('Doubleの81組を固定役割と左右交代の基本部品へ結び、未照合の依存先を残す',()=>{
  const terms=new Map<string,any>(source.source_terms.map((t:any)=>[t.id,t]));
  expect(terms.size).toBe(18);expect(doubles).toHaveLength(81);
  const pairs=new Set<string>();
  for(const row of doubles){
    expect(row.component_refs).toHaveLength(2);
    const [plain,star]=row.component_refs.map((id:string)=>terms.get(id));
    expect(plain.source_siteswap).toBe('(4x,2x)');expect(star.source_siteswap).toBe('(4,2x)*');
    expect(row.id).toBe(`hf-double:${plain.source_key}_${star.source_key}`);
    pairs.add(row.component_refs.join('|'));
    if(row.component_refs.some((id:string)=>catalog.dependencies.unresolved_components.includes(id)))
      expect(row.status).toBe('reference');
  }
  expect(pairs.size).toBe(81);
  expect(catalog.dependencies).toMatchObject({basic_count:18,combination_count:81,
    combinations_with_unresolved_components:33,editable_basic_combinations:16});
  expect(catalog.dependencies.unresolved_components).toEqual([
    'hf:under-arm-box','hf:reverse-under-arm-box','hf:under-arm-inverted-box','hf:under-arm-inverted-box*']);
});

it('基本4分類の16組は4x側と自己4側の高さを正しい局面に置き、候補として編集できる',()=>{
  const styles:Record<string,string>={box:'normal',shuffle:'shuffle','reverse-shuffle':'reverse','inverted-box':'inverted'};
  const candidates=doubles.filter(r=>r.builder);
  expect(candidates).toHaveLength(16);
  for(const row of candidates){
    const [plain,star]=row.component_refs.map((id:string)=>id.slice(3));
    expect(row.builder).toEqual({kind:'double',parts:{crossSet:styles[plain],selfSet:styles[star.slice(0,-1)]}});
    const before=structuredClone(row.builder.parts),sequence=sequenceFromDoubleParts(row.builder.parts);
    expect(analyzeSequence(sequence)).toMatchObject({ok:true,balls:3,movementSets:4,identitySets:4});
    for(const set of sequence.sets){
      const crossing=set.throws.includes('4x');
      expect(set.throws).toContain(crossing?'4x':'4');expect(set.throws).toContain('2x');
      expect(set.motion.short).toEqual([crossing?styles[plain]:styles[star.slice(0,-1)]]);
    }
    expect(row.builder.parts).toEqual(before);
    if(!row.template){expect(row.status).toBe('components');expect(row.note).toContain('未照合');}
  }
  expect(candidates.filter(r=>!r.template)).toHaveLength(10);
});

it('実演照合した見本は候補に置き換えず、固有の手向きと経路を持つ見本への参照を保つ',()=>{
  const expected:Record<string,string>={box_box:'preset:double-box',box_inverted:'example:50',
    shuffle_box:'example:52',box_shuffle:'example:53'};
  const ids=['hf-double:box_box*','hf-double:box_inverted-box*','hf-double:shuffle_box*','hf-double:box_shuffle*'];
  ids.forEach((id,i)=>expect(records.find(r=>r.id===id)).toMatchObject({status:'playable',template:Object.values(expected)[i]}));
  expect(records.find(r=>r.id==='hf-double:under-arm-claw-box_under-arm-claw-box*')?.status).toBe('playable');
});
