/* Basic-mode recipes share the existing motion generators. */
globalThis.SyncBasicPatterns=(()=>{
  const names={box:'ボックス',shower:'シャワー','double-fixed':'固定のダブルボックス','double-shower':'シャワー型のダブルボックス','high-low':'ハイロー','box-four':'4周期'};
  const defaults={base:'box',columns:'normal',passes:['normal','normal'],highHand:0,alternateHigh:true,swap:'alternate',highPath:'vertical'};
  function kind(api,s){
    const rows=s.sets;
    const paired=value=>rows.every(r=>r.throws.includes('2x')&&r.throws.includes(value));
    if(rows.length===4&&rows.filter(r=>r.throws.every(t=>t==='2x')).length===2&&rows.filter(r=>r.throws.some(t=>/^6x?$/.test(t))).length===2)return 'high-low';
    if(rows.length===4&&rows.some(r=>r.throws.includes('4x'))&&rows.some(r=>r.throws.includes('4'))&&rows.every(r=>r.throws.includes('2x')&&r.throws.some(t=>t==='4'||t==='4x'))){
      const crossing=rows.filter(r=>r.throws.includes('4x'));
      return crossing.every(r=>{const d=api.syncSequenceHandDefinition(r,r.throws.indexOf('4x'));return Math.abs(d.release.x-d.catch.x)<1e-8;})?'double-fixed':'double-shower';
    }
    if(paired('4')&&[2,4].includes(rows.length))return rows.length===4&&s.editorBase!=='box'?'box-four':'box';
    if(paired('4x')&&rows.length<=2)return 'shower';
    return 'custom';
  }
  function create(api,id){
    let s;
    if(id==='double-fixed')s=structuredClone(api.syncSequenceExamples.find(s=>s.name.startsWith('Extended Box /')));
    else if(id==='double-shower')s=api.syncSequenceFromPreset('double-box');
    else if(id==='high-low')s=api.syncSequenceFromBaseParts({...defaults,base:'high-low',passes:['normal']});
    else if(id==='box-four'){
      s=api.syncSequenceFromPreset('box');const start=s.sets.findIndex(r=>r.throws[0]==='2x'),rows=s.sets;
      s.sets=Array.from({length:4},(_,i)=>structuredClone(rows[(start+i)%2]));
    }else s=api.syncSequenceFromPreset(id==='shower'?'shower':'box');
    s.name=names[id];s.editorBase=id;s.allowBallContact=true;return s;
  }
  function fourParts(api,ui,source,columns,passes){
    const s=structuredClone(source),firstHand=Math.max(0,source.sets[0].throws.indexOf('2x'));
    s.sets=passes.map((pass,i)=>{
      const pair=ui.namedParts(api,{roles:'alternate',shortHand:1,columns,left:pass,right:pass});
      // New recipes start left; imported cycles retain their starting hand.
      const start=pair.sets.findIndex(r=>r.throws[firstHand]==='2x');
      return structuredClone(pair.sets[(start+i)%pair.sets.length]);
    });
    s.name=('4周期｜'+passes.map((p,i)=>((firstHand+i)%2?'右 ':'左 ')+(ui.shortChoices.find(c=>c.id===p)?.name||p)).join(' / ')).slice(0,100);
    s.editorBase='box-four';s.mirrorRepeat=false;return s;
  }
  return {names,defaults,kind,create,fourParts};
})();
