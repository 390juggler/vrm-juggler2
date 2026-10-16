/* Presentation only: these descriptions never change or validate motion. */
globalThis.SyncComposeUI = (() => {
  const height = {normal:'手前の球の下 → 奥の球の下',shuffle:'手前の球の上 → 奥の球の下',reverse:'手前の球の下 → 奥の球の上',inverted:'手前の球の上 → 奥の球の上','vertical-up':'縦の上投げ','vertical-down':'縦の下投げ'};
  const styleNames={normal:'Normal',shuffle:'Shuffle',reverse:'Reverse Shuffle',inverted:'Inverted','vertical-up':'Up','vertical-down':'Down'};
  const columns = {normal:'Normal',switched:'Switched',underarm:'Underarm',crossed:'Cross'};
  const laneNames={outside:'Outside',center:'Center','cross-side':'Cross side'};
  const shortChoices=[
    ...['normal','shuffle','reverse','inverted'].map(style=>({id:style,style,name:styleNames[style],group:'基本の2x',hint:height[style],options:{}})),
    ...['normal','shuffle','reverse','inverted'].map(style=>({id:'lateral-'+style,style,name:styleNames[style]+' Lateral',group:'Lateral — 体の反対側から',hint:height[style]+'・反対側から投げる',options:{lateral:true}})),
    ...['outside','center','cross-side'].flatMap(lane=>['vertical-up','vertical-down'].map(style=>({id:lane+'-'+style,style,name:laneNames[lane]+' column '+(style==='vertical-up'?'Up':'Down'),group:'縦の2x',hint:({outside:'外側',center:'中央','cross-side':'反対側'})[lane]+'で'+(style==='vertical-up'?'上へ投げる':'下へ送る'),options:{lane}})))
  ];
  function shortKey(row,hand){
    const h=row.motion.hands?.[hand]||{},o=h.shortMotion||row.motion.shortMotions?.[0]||{},style=h.style||row.motion.short?.[0]||'normal';
    return style.startsWith('vertical-')?`${o.lane||'center'}-${style}`:o.lateral?'lateral-'+style:style;
  }
  function namedParts(api,parts){
    const picks=[parts.left,parts.right].map(id=>shortChoices.find(c=>c.id===id));
    if(picks.some(p=>!p))throw new Error('2xのパターンを選んでください。');
    const base=p=>p.style.startsWith('vertical-')?'normal':p.style;
    const s=api.syncSequenceFromBasicParts({...parts,left:base(picks[0]),right:base(picks[1])});
    const sourceFor=p=>{
      if(parts.roles!=='alternate')return null;
      const prefix=parts.columns==='switched'?'switched-':parts.columns==='normal'?'':null;
      if(prefix===null||p.options.lateral&&prefix)return null;
      const id=p.id.startsWith('center-')&&!prefix?p.style:prefix+p.id;
      return api.syncBoxPresets.some(preset=>preset.id===id)?api.syncSequenceFromPreset(id):null;
    };
    const order=s=>{for(const row of s.sets)if(!row.motion.short?.[0]?.startsWith('vertical-'))row.motion.shortMotions=(row.motion.shortMotions||[{}]).map(o=>({...o,ballOrder:'style'}));return s;};
    if(parts.roles==='alternate'&&parts.left===parts.right){const exact=sourceFor(picks[0]);if(exact)return order(exact);}
    s.sets=s.sets.map(row=>{
      const h=row.throws.indexOf('2x'),p=picks[h];if(!Object.keys(p.options).length)return row;
      const source=sourceFor(p),copy=source?structuredClone(source.sets.find(r=>r.throws[h]==='2x')):structuredClone(row);
      if(source)s.beatDuration=Math.min(s.beatDuration,source.beatDuration);
      else{copy.motion.short=[p.style];copy.motion.shortMotions=[structuredClone(p.options)];if(copy.motion.hands?.[h])delete copy.motion.hands[h].definition;}
      return copy;
    });
    return order(s);
  }
  const order = {'left-over':'左腕が上','right-over':'右腕が上',alternate:'上下を交代'};
  const route = {direct:'直接',outside:'外側',inside:'内側',front:'前',back:'奥'};
  const unique = values => [...new Set(values)];
  function layout(m) {
    if(m.arrangement==='inline')return 'In-line 3（常に縦一列）';
    if(m.transition)return '次の投げ位置への移動';
    return [columns[m.columns||'normal']||m.columns,order[m.armOrder]].filter(Boolean).join('・');
  }
  function shortName(row, hand) {
    const t=row.throws[hand];
    if(t==='2')return '2 保持';
    if(t==='2x'||t==='2T'){
      const h=row.motion.hands?.[hand]||{},o=h.shortMotion||row.motion.shortMotions?.[0]||{};
      const choice=shortChoices.find(c=>c.id===shortKey(row,hand));
      return `${t} ${choice?.name||'個別指定'}`;
    }
    return null;
  }
  function handName(row, hand) {
    const t=row.throws[hand];
    if(t==='0')return '空の手';
    if(t==='2')return '2：持ったまま運ぶ';
    return `${shortName(row,hand)||t}（${t.endsWith('x')?'反対の手へ':'同じ手へ'}）`;
  }
  function describeSequence(sequence) {
    const rows=sequence.sets||[],visible=rows.slice();
    if(sequence.mirrorRepeat)visible.push(...rows.map(r=>({...r,throws:[r.throws[1],r.throws[0]],motion:{...r.motion,hands:r.motion.hands?[r.motion.hands[1],r.motion.hands[0]]:undefined}})));
    const layouts=unique(visible.map(r=>layout(r.motion))),short=[0,1].map(h=>unique(visible.map(r=>shortName(r,h)).filter(Boolean)));
    const roles=visible.map(r=>r.throws.findIndex(t=>t==='2x'||t==='2T'));
    const role=roles.length&&roles.every(h=>h===0)?'短い投げは左手に固定':roles.length&&roles.every(h=>h===1)?'短い投げは右手に固定':roles.every(h=>h>=0)?'左右で役割を交代':'セットごとに指定';
    const fields=[['コラム・配置',layouts.join(' → ')],['左手の2',short[0].join(' / ')||'なし'],['右手の2',short[1].join(' / ')||'なし'],['役割',role]];
    const extras=[];
    rows.forEach(r=>r.throws.forEach((t,h)=>{
      if(t==='0')return;
      const hand=r.motion.hands?.[h]||{},opts=hand.shortMotion||r.motion.shortMotions?.[0]||{};
      const d=hand.definition||((t==='2x'||t==='2T')?opts.definition:r.motion.columnMotion);
      if(hand.releaseGrip==='overhand')extras.push(`${t}をクローで投げる`);
      if(hand.catchGrip==='overhand')extras.push(`${t}をクローで捕る`);
      if(opts.releaseRelation==='underarm'||d?.release?.relation==='underarm')extras.push(`${t}を腕下で投げる`);
      if(opts.catchRelation==='underarm'||d?.catch?.relation==='underarm')extras.push(`${t}を腕下で捕る`);
      if(opts.carry)extras.push(`${t}の運び：${route[opts.carry]||opts.carry}`);
      if(d?.carry?.route&&d.carry.route!=='direct')extras.push(`${t}の運び：${route[d.carry.route]||d.carry.route}`);
      if(d||hand.heightOffset)extras.push('位置・経路の個別指定あり');
    }));
    if(extras.length)fields.push(['手向き・経路',unique(extras).join(' / ')]);
    const title=`${layouts.join('・')}｜${short.map((s,h)=>s.length?`${h?'右':'左'} ${s.join('・')}`:'').filter(Boolean).join('／')||'左右の投げを指定'}`;
    return {title,fields,rows:rows.map((r,i)=>({index:i,label:`左：${handName(r,0)} ／ 右：${handName(r,1)}`,layout:layout(r.motion),repeat:r.repeat}))};
  }
  function basicVerdict({ready,valid,checking,checked,failed}) {
    if(!valid)return {state:'failed',title:'セットの指定を確認してください',next:'指定内容または球の受け渡しに問題があります。詳しい理由を下に表示します。'};
    if(!ready)return {state:'pending',title:'モデルを読み込み中',next:'モデルの読込後に、球の軌道と腕の動きを検査します。'};
    if(checking)return {state:'checking',title:'動きを生成中…',next:'球と腕の動きを確認しています。'};
    if(failed)return {state:'failed',title:'この動きはまだ再現できていません',next:'球の受け渡しは合っています。現在の自動生成では球や腕の動きを作れませんでした。技が不可能という意味ではありません。'};
    if(checked)return {state:'passed',title:'再生できます',next:''};
    return {state:'pending',title:'再生して動きを確認',next:'「再生」で、この組合せの動きを作ります。'};
  }
  function connectionVerdict({sources,count,closed,canClose,closingSets}) {
    if(!sources||!count)return {state:'pending',title:'まだ技がありません',next:'基本モードで組合せを作り、「この技をつなげる」を押してください。'};
    if(closed)return {state:'passed',title:'くり返し再生できます',next:''};
    if(canClose)return {state:'pending',title:'再生すると先頭につながります',next:`戻りのつなぎ${closingSets}セットを自動で加えます。`};
    return {state:'pending',title:'先頭へのつなぎは未生成',next:'再生時に、最後の技から最初の技へのつなぎを探します。'};
  }
  function appendConnected(api,ids,source,repeats=1,start=0){
    try{return api.appendSyncSource(ids,source,repeats,start);}
    catch(error){
      if(!ids.length||ids.length>=128)throw error;
      const doc=api.exportSyncSegments(ids,''),from=doc.route.at(-1).source;
      if(from===source)throw error;
      api.registerSyncTransition(from,source);
      return api.appendSyncSource(ids,source,repeats,start);
    }
  }
  function closeConnected(api,ids){
    try{api.analyzeSyncSegments(ids);return ids.slice();}catch{}
    try{return api.closeSyncSegments(ids);}catch(error){
      if(!ids.length||ids.length>=128)throw error;
      const doc=api.exportSyncSegments(ids,''),from=doc.route.at(-1).source,to=doc.route[0].source;
      if(from===to)throw error;
      api.registerSyncTransition(from,to);return api.closeSyncSegments(ids);
    }
  }
  function routeGroups(doc, sources) {
    const groups=[];
    for(const ref of doc.route){
      const prev=groups.at(-1),size=sources[ref.source]?.sets||1;
      if(prev&&prev.source===ref.source&&ref.set===(prev.last+1)%size){prev.last=ref.set;prev.count++;}
      else groups.push({source:ref.source,start:ref.set,last:ref.set,count:1});
    }
    return groups.map(g=>({...g,name:doc.sources[g.source].name,transition:doc.sources[g.source].purpose==='transition',mirror:doc.sources[g.source].mirror,size:sources[g.source]?.sets||1}));
  }
  function ballContactSummary(report){
    return report.ballContact?'球同士の接触あり（許可して再生中）。':report.ballContactAllowed?'球同士の接触を許可中。この周期では接触なし。':'球同士の接触なし。';
  }
  function armPlaybackSummary(report){
    if(report?.skeletonOK)return '腕の1周期：接触・姿勢の検査OK（骨格による近似）。';
    if(!report?.playbackOK)return '腕の動きを確認できません。';
    const issues=[];
    if(report.minArmDistance<=.065)issues.push('腕同士の接触');
    if(report.minBallArmDistance<=.065)issues.push('球と腕の接触');
    if(!report.postureOK)issues.push('姿勢の近似');
    if(report.maxGripError>=.012)issues.push('手が球に届かない区間');
    if(report.maxElbowSpeed>=12||report.maxJointAngularSpeed>=90)issues.push('速い腕の切り替え');
    return `簡易再生：${issues.join('・')||'接触回避の近似'}あり。再生を優先しています。`;
  }
  return {describeSequence,basicVerdict,connectionVerdict,routeGroups,shortChoices,shortKey,namedParts,appendConnected,closeConnected,ballContactSummary,armPlaybackSummary};
})();
