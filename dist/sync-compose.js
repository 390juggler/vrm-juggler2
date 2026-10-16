(() => {
  'use strict';
  const $=id=>document.getElementById(id),clone=v=>structuredClone(v),storageKey='vrm-sync-sequence-v1';
  const app=new VRMJuggler('#stage'),presets=VRMJuggler.syncBoxPresets,examples=VRMJuggler.syncSequenceExamples;
  app.syncPlanningMode='constructive';
  const styles=[['normal','Normal'],['shuffle','Shuffle'],['reverse','Reverse Shuffle'],['inverted','Inverted'],['vertical-up','Column Up'],['vertical-down','Column Down']];
  const throws=[['2x','2x / 反対の手へパス'],['2T','2T / 短く投げて同じ手で捕る'],['4','4 / 同じ手へ'],['4x','4x / 反対の手へ'],['6','6 / 高く・同じ手へ'],['6x','6x / 高く・反対の手へ'],['2','2 / 持ったまま'],['0','0 / 空の手'],['8','8 / 同じ手へ'],['8x','8x / 反対の手へ'],['a','10 / 同じ手へ'],['ax','10x / 反対の手へ'],['c','12 / 同じ手へ'],['cx','12x / 反対の手へ']];
  const columns=[['normal','通常のコラム'],['switched','Switched / 反対側を担当'],['crossed','クロスしたコラム'],['underarm','Underarm / 腕の下']];
  const orders=[['none','指定なし'],['left-over','左腕が上を維持'],['right-over','右腕が上を維持'],['alternate','左上・右上を交代']];
  const routes=[['direct','直接'],['outside','外側'],['inside','内側'],['front','前'],['back','奥']];
  const relations=[['free','指定なし'],['underarm','反対の腕の下']];
  const grips=[['auto','動作に合わせる'],['underhand','下から支える / 手のひらを上へ'],['overhand','上からつかむ / クロー']];
  let draft=clone(examples[0]),applied=null,analysis=null,busy=false,initialized=false,dirty=true,saveTimer,lastImportTemplate='example:0';
  let planningAbort=null;
  const ui=globalThis.SyncComposeUI;
  let routeBuilder;
  let mode='connect',basicCheck=null,previewKind=null,routeDocument=null,partsApplying=false,connectionState={sources:0,count:0,closed:false,canClose:false};
  const templateItems=examples.map((s,i)=>({value:`example:${i}`,name:s.name,group:s.name.includes(' → ')?'接続の見本':VRMJuggler.analyzeSyncSequence(s).balls===4?'4球の見本':'3球の見本'}));
  const el=(tag,text,className)=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=text;if(className)e.className=className;return e;};
  const button=(text,fn,title)=>{const b=el('button',text);b.type='button';b.onclick=fn;if(title)b.title=title;return b;};
  function select(parent,label,items,value,onchange){
    const l=el('label',label),s=el('select');items.forEach(([v,n])=>s.add(new Option(n,v)));s.value=value;s.setAttribute('aria-label',label);s.onchange=()=>onchange(s.value);l.append(s);parent.append(l);return s;
  }
  function number(parent,label,value,min,max,step,onchange){
    const l=el('label',label),n=el('input');n.type='number';n.value=String(value);n.min=min;n.max=max;n.step=step;n.setAttribute('aria-label',label);n.onchange=()=>{if(n.checkValidity()&&Number.isFinite(n.valueAsNumber))onchange(n.valueAsNumber);else n.reportValidity();};l.append(n);parent.append(l);return n;
  }
  function hand(row,h){row.motion.hands ||= [];return row.motion.hands[h] ||= {};}
  function showBallContact(report){const status=$('ball-contact-status');status.textContent=ui.ballContactSummary(report);status.hidden=!report.ballContactAllowed&&!report.ballContact;status.dataset.contact=String(!!report.ballContact);}
  function options(row,h){const m=hand(row,h);if(!m.shortMotion){m.shortMotion=clone(row.motion.shortMotions?.[0]||{});delete m.shortMotion.definition;}delete m.definition;return m.shortMotion;}
  function switchMode(next,focus=true){
    const previous=mode;
    mode=next==='connect'?'connect':'basic';
    for(const id of ['basic','connect']){const active=id===mode;$(`${id}-panel`).hidden=!active;$(`mode-${id}`).setAttribute('aria-selected',String(active));$(`mode-${id}`).tabIndex=active?0:-1;}
    if(previous!==mode)$(`${mode}-panel`).scrollTop=0;
    if(focus){$('mode-'+mode).focus();$('mode-'+mode).scrollIntoView({block:'nearest'});}
    refreshPreviewNotice();refreshModeAction();
  }
  for(const id of ['basic','connect']){
    $('mode-'+id).onclick=()=>switchMode(id);
    $('mode-'+id).onkeydown=e=>{if(['ArrowLeft','ArrowRight','Home','End'].includes(e.key)){e.preventDefault();switchMode(e.key==='Home'?'basic':e.key==='End'?'connect':mode==='basic'?'connect':'basic');}};
  }
  $('connect-to-basic').onclick=()=>switchMode('basic');
  $('connect-next-pattern').onclick=()=>switchMode('basic');
  $('quick-connect').onclick=()=>$('segment-register').click();
  function refreshModeAction(){
    const action=$('mode-action');action.disabled=busy||!initialized;
    $('quick-connect').hidden=mode!=='basic'||currentCheck()?.status!=='passed';$('quick-connect').disabled=busy||!initialized;
    if(mode==='basic'){action.textContent=busy?'動きを生成中…':'▶ 再生';action.disabled ||= !analysis?.ok;$('mode-action-status').textContent=currentCheck()?.status==='failed'?'受け渡しOK・動作は再現待ち':analysis?.ok?`${analysis.balls}球 · ${analysis.movementSets}セットで1周`:$('basic-verdict').textContent;}
    else{action.textContent=busy?'動きを生成中…':'▶ この並びを再生';$('mode-action-status').textContent=routeBuilder?.summary()||'ベースと2xを選ぶ';}
  }
  $('mode-action').onclick=()=>{
    if(mode==='basic'){$('apply').click();return;}
    routeBuilder.play();
  };
  function showSet(index){switchMode('basic',false);$('set-editor').open=true;const card=$('sets').children[index];if(card){card.scrollIntoView({block:'start'});card.focus({preventScroll:true});}}
  function describeInto(id,sequence){
    const description=ui.describeSequence(sequence),dl=el('dl');
    for(const [name,value] of description.fields){dl.append(el('dt',name),el('dd',value));}
    $(id).replaceChildren(dl);return description;
  }
  function checkItem(label,state,text){const li=el('li');li.dataset.state=state;li.append(el('span',label),el('strong',text));return li;}
  function currentCheck(){return basicCheck?.key===`${analysis?.canonical}:${$('mirror').checked}`?basicCheck:null;}
  function refreshBasicStatus(){
    const check=currentCheck(),state=ui.basicVerdict({ready:initialized,valid:analysis?.ok,checking:check?.status==='checking',checked:check?.status==='passed',failed:check?.status==='failed'});
    $('basic-validity').dataset.state=state.state;$('basic-verdict').textContent=state.title;$('basic-next').textContent=state.next;
    $('draft-status').textContent=check?.status==='checking'?'生成中':'';
    $('basic-checks').replaceChildren(checkItem('セット指定・球の受け渡し',analysis?.ok?'passed':'failed',analysis?.ok?'✓ 問題なし':'要確認'),checkItem('アバターの動作生成',check?.status||'pending',check?.status==='passed'?'✓ 生成済み':check?.status==='failed'?'未対応':check?.status==='checking'?'生成中…':'未生成'));
    $('segment-register').disabled=busy||!initialized||check?.status!=='passed';
    refreshPreviewNotice();refreshModeAction();
  }
  function refreshPreviewNotice(){
    let message='';
    if(previewKind&&previewKind!==mode)message=`表示中：${previewKind==='basic'?'基本モード':'つなぐモード'}で最後に再生した動き。モードを切り替えても再生内容は変わりません。`;
    else if(previewKind==='basic'&&dirty)message='表示中は前に確認した動きです。編集中の変更は、まだ再生に反映していません。';
    else if(previewKind==='connect'&&replayApplied&&(replayApplied.detached||JSON.stringify(replayApplied.ids)!==JSON.stringify(segmentRoute)))message='表示中は前の接続列です。変更後の列は「この周期を再生」で反映します。';
    $('preview-difference').textContent=message;$('preview-difference').hidden=!message;
  }
  function clearFailure(){const panel=$('failure');panel.replaceChildren();panel.hidden=true;delete panel.dataset.report;}
  function showFailure(result){
    basicCheck={key:`${analysis.canonical}:${$('mirror').checked}`,status:'failed'};refreshBasicStatus();
    clearFailure();if(!result.failure?.issues?.length)return;
    const panel=$('failure'),failure=clone(result.failure);panel.hidden=false;
    failure.issues.forEach(issue=>{if(!issue.location&&issue.phase!==undefined)issue.location=VRMJuggler.syncSequenceLocationAtPhase(draft,failure.period,issue.phase);});
    panel.dataset.report=JSON.stringify({name:draft.name,canonical:analysis.canonical,mirror:$('mirror').checked,...failure});
    panel.append(el('strong','プログラムが再現できなかった箇所'));
    for(const issue of failure.issues){
      const item=el('div',undefined,'failure-item'),loc=issue.location;
      if(loc){
        const label=`セット${loc.rowIndex+1}${draft.sets[loc.rowIndex].repeat>1?`・${loc.repeatIndex+1}回目`:''}${loc.mirrored?'・左右交代した後半':''}`;
        item.append(el('p',`発生時刻：${label}の時間帯 / ${(issue.phase*failure.period).toFixed(2)}秒（周期の${(issue.phase*100).toFixed(1)}%）`,'hint'));
        item.append(el('p',issue.message.replace(/[^。]*調整してください。/g,'')),button('このセットの設定を見る',()=>showSet(loc.rowIndex),label+'を開く'));
      }else item.append(el('p',issue.message));
      panel.append(item);
    }
    panel.append(el('p',(applied?'表示中の動きは直前に再生できた列です。':'編集中の列の動きは再生していません。')+'球は前のセットから飛んでくるため、発生時刻の前後も確認してください。','hint'));
  }
  function modified(rerender=false){
    if(!planningAbort)$('planning-state').hidden=true;
    clearFailure();
    clearConnectionSuggestions();
    $('append-status').textContent='各見本の左右交代を含めて追加します。区間の境目と、最後から先頭への戻りも検査します。';
    $('transition-status').textContent='通常のBoxとIn-line 3をつないだ列に使います。入口・出口と投球間隔をまとめて設定します。';
    dirty=true;$('draft-status').textContent='編集内容は未再生';$('basic-register-status').textContent='';
    clearTimeout(saveTimer);saveTimer=setTimeout(()=>{try{localStorage.setItem(storageKey,JSON.stringify(draft));}catch{}},250);
    if(rerender)render();else analyze();
  }
  function analyze(){
    analysis=VRMJuggler.analyzeSyncSequence(draft);
    $('balls').textContent=analysis.balls||'—';$('movement').textContent=analysis.ok?analysis.movementSets:'—';$('identity').textContent=analysis.ok?analysis.identitySets:'—';
    $('cycle-brief').textContent=analysis.ok?`${analysis.balls}球 · ${analysis.movementSets}セットで1周 — 周期と速さ`:'周期と速さ';
    const movementSeconds=Number((analysis.movementSets*draft.beatDuration*2).toFixed(3)),identitySeconds=Number((analysis.identitySets*draft.beatDuration*2).toFixed(3));
    $('cycle-explanation').textContent=!analysis.ok?'投げの組合せが成立すると、何周で同じ球まで戻るかを表示します。':analysis.movementSets===analysis.identitySets?
      `${analysis.movementSets}セット（${movementSeconds}秒）で、動きと同じ球の配置が両方戻ります。`:
      `動きは${analysis.movementSets}セット（${movementSeconds}秒）で一周。同じ球の配置まで戻るには、この動きを${analysis.identitySets/analysis.movementSets}周（${analysis.identitySets}セット・${identitySeconds}秒）繰り返します。`;
    $('notation').textContent=analysis.notation||'左右の投げを設定してください。';$('canonical').value=analysis.canonical;
    $('pattern-code').textContent=analysis.ok?`保存内容の識別子：${analysis.code}`:'';
    const description=describeInto('basic-description',draft);$('basic-title').textContent=(draft.name||description.title)+($('mirror').checked?'（左右反転）':'');$('basic-orientation').hidden=!$('mirror').checked;
    $('basic-set-outline').replaceChildren(...description.rows.map(row=>{const li=el('li');li.append(button(`セット${row.index+1}${row.repeat>1?' × '+row.repeat:''}｜${row.label}`,()=>showSet(row.index)));return li;}));
    $('error').textContent=analysis.issues.map(i=>`セット${i.set+1}${i.hand===undefined?'':i.hand===0?' 左手':' 右手'}: ${i.message}`).join('\n');
    $('apply').disabled=busy||!initialized||!analysis.ok;
    $('section-outline').replaceChildren();
    if(draft.sets.some(r=>r.sourceName)){
      $('section-outline').append(el('p','元の見本とセット範囲（各セットは個別に編集できます）'));
      const groups=[];let index=1;
      draft.sets.forEach((row,rowIndex)=>{const name=row.sourceName||'個別セット',last=groups[groups.length-1];if(last?.name===name)last.end+=row.repeat;else groups.push({name,start:index,end:index+row.repeat-1,rowIndex});index+=row.repeat;});
      groups.forEach(g=>{const jump=button(`${g.start===g.end?g.start:g.start+'–'+g.end}：${g.name}`,()=>showSet(g.rowIndex),'この区間の先頭セットを編集');jump.className='section-jump';$('section-outline').append(jump);});
      if(draft.mirrorRepeat)$('section-outline').append(el('p',`${index}–${(index-1)*2}：上の列の左右交代`));
      $('section-outline').append(el('p','末尾 → セット1へ戻る'));
    }
    document.querySelectorAll('.set').forEach((r,i)=>r.classList.toggle('invalid',analysis.issues.some(e=>e.set===i)));
    refreshBasicStatus();
  }
  function waypointEditor(parent,row,h,key,current,label){
    const details=el('details',undefined,'waypoints'),summary=el('summary'),list=el('div');
    let points=clone(current[key]?.via||[]);
    details.append(summary,el('p','基本経路からのずらし量。横は動かす手の側が＋、奥行は体の前が−です。時点は、この運びの開始を0、終了を1とします。','hint'),list);
    const commit=()=>{
      hand(row,h).definition ||= clone(current);
      const route=hand(row,h).definition[key] ||= {route:'direct',amount:0};
      if(points.length)route.via=clone(points);else delete route.via;
      modified();
    };
    const draw=()=>{
      summary.textContent=`${label}（${points.length}点）`;list.replaceChildren();
      points.forEach((p,i)=>{
        const group=el('fieldset'),legend=el('legend',`経由点 ${i+1}`);group.append(legend);
        number(group,`経由点${i+1}の時点`,p.at,.01,.99,.01,v=>{p.at=v;commit();});
        const coords=el('div',undefined,'coordinates');
        ['横','高さ','奥行'].forEach((axis,j)=>{const input=number(coords,`経由点${i+1} ${axis}`,p.offset[j],-1.5,1.5,.001,v=>{p.offset[j]=v;commit();});input.parentElement.firstChild.textContent=axis;});
        group.append(coords,button('この経由点を削除',()=>{points.splice(i,1);commit();draw();}));list.append(group);
      });
      const add=button('＋ 経由点を追加',()=>{
        const nodes=[{at:0,offset:[0,0,0]},...points,{at:1,offset:[0,0,0]}].sort((a,b)=>a.at-b.at);
        let index=0;for(let i=1;i<nodes.length-1;i++)if(nodes[i+1].at-nodes[i].at>nodes[index+1].at-nodes[index].at)index=i;
        const a=nodes[index],b=nodes[index+1];points.push({at:Math.round((a.at+b.at)*50)/100,offset:a.offset.map((v,j)=>(v+b.offset[j])/2)});
        points.sort((a,b)=>a.at-b.at);commit();draw();
      });add.disabled=points.length>=8;list.append(add);
    };
    draw();parent.append(details);
  }
  function gripEditor(parent,row,h){
    for(const [key,label] of (row.throws[h]==='2'?[['releaseGrip','保持中の手の向き']]:[['releaseGrip','この球を投げる手の向き'],['catchGrip','この球を捕る手の向き']]))
      select(parent,label,grips,row.motion.hands?.[h]?.[key]||'auto',v=>{if(v==='auto')delete hand(row,h)[key];else hand(row,h)[key]=v;modified();});
  }
  function positionEditor(parent,row,h){
    const held=row.throws[h]==='2';
    const d=el('details',undefined,'advanced-position');d.append(el('summary',held?'保持中の位置と運びを指定':'投げ・捕りの位置を指定'));
    d.append(el('p','横は投げ手側が＋、奥行は体の前が−。高さは基本の捕球位置から。値は腕の長さに合わせて拡大されます。','hint'));
    const current=VRMJuggler.syncSequenceHandDefinition(row,h);
    for(const [key,label] of (held?[['release','保持中の通過位置']]:[['release','投げる位置'],['catch','捕る位置']])){
      d.append(el('p',label));const coords=el('div',undefined,'coordinates');
      for(const [axis,name] of [['x','横'],['y','高さ'],['z','奥行']])number(coords,name,current[key][axis],-1.5,1.5,.01,v=>{hand(row,h).definition ||= clone(current);hand(row,h).definition[key][axis]=v;modified();});
      d.append(coords);
    }
    if(!held)number(d,'通る位置を確認する時点（飛行の割合）',current.passage.at,.05,.95,.05,v=>{hand(row,h).definition ||= clone(current);hand(row,h).definition.passage={at:v};modified();});
    if(!held){
      const timingFields=el('div'),drawTiming=()=>{
        timingFields.replaceChildren();const value=(row.motion.hands?.[h]?.definition||current).flightFraction;
        if(value!==undefined)number(timingFields,'飛行に使う割合',value,.05,.95,.05,v=>{hand(row,h).definition.flightFraction=v;modified();});
      };
      select(d,'捕球の時刻',[['auto','通常のタイミング'],['apex','上昇の頂点で捕る'],['fraction','次の投げまでの割合で指定']],current.catchAtApex?'apex':current.flightFraction!==undefined?'fraction':'auto',v=>{
        hand(row,h).definition ||= clone(current);const definition=hand(row,h).definition;delete definition.catchAtApex;delete definition.flightFraction;
        if(v==='apex')definition.catchAtApex=true;if(v==='fraction')definition.flightFraction=.75;drawTiming();modified();
      });
      d.append(timingFields);drawTiming();
      d.append(el('p','頂点では投げ位置より高く捕ります。割合は、この球を次に投げるまでの時間を1とした値です。手が空く順序も再検査します。','hint'));
    }
    select(d,held?'保持したまま次の投げへ':'捕ってから次の投げへ',routes,current.carry.route,v=>{hand(row,h).definition ||= clone(current);hand(row,h).definition.carry.route=v;modified();});
    number(d,'運ぶ経路のふくらみ',current.carry.amount,0,.5,.01,v=>{hand(row,h).definition ||= clone(current);hand(row,h).definition.carry.amount=v;modified();});
    waypointEditor(d,row,h,'carry',current,'持った球の途中経路');
    if(!held){
      select(d,'投げた後の空の手',routes,current.emptyReturn?.route||'direct',v=>{hand(row,h).definition ||= clone(current);hand(row,h).definition.emptyReturn ||= {route:'direct',amount:.06};hand(row,h).definition.emptyReturn.route=v;modified();});
      number(d,'空の手の経路のふくらみ',current.emptyReturn?.amount||0,0,.5,.01,v=>{hand(row,h).definition ||= clone(current);hand(row,h).definition.emptyReturn ||= {route:'direct',amount:0};hand(row,h).definition.emptyReturn.amount=v;modified();});
      waypointEditor(d,row,h,'emptyReturn',current,'空の手の途中経路');
    }
    d.append(button('位置指定を解除して基本形へ',()=>{delete hand(row,h).definition;const o=options(row,h);hand(row,h).style ||= row.motion.short?.[0]||'normal';delete o.definition;modified(true);}));
    parent.append(d);
  }
  function templateFrom(value){return value.startsWith('example:')?clone(examples[Number(value.slice(8))]):VRMJuggler.syncSequenceFromPreset(value.slice(7));}
  function fillTemplates(target){
    const groups=new Map(['3球の見本','4球の見本','接続の見本'].map(label=>{const group=el('optgroup');group.label=label;target.append(group);return [label,group];}));
    templateItems.forEach(item=>groups.get(item.group).append(new Option(item.name,item.value)));
    const group=el('optgroup');group.label='既存の技をセットに分解';presets.forEach(p=>group.append(new Option(p.name,`preset:${p.id}`)));target.append(group);
  }
  function describeSet(row){
    const descriptions=row.throws.map((t,h)=>{
      const parts=[`${h?'右':'左'}：${t}`];
      if(t==='0')parts.push('空の手');
      else if(t==='2')parts.push('球を保持');
      else{
        const d=VRMJuggler.syncSequenceHandDefinition(row,h),m=row.motion.hands?.[h];
        if(t.startsWith('2'))parts.push(d.catch.y-d.release.y>.03?'低い位置→高い位置':d.catch.y-d.release.y<-.03?'高い位置→低い位置':'同じ高さへ');
        if(d.release.relation==='underarm')parts.push('腕下から投げる');
        if(d.catch.relation==='underarm'||row.motion.columns==='underarm'&&!t.startsWith('2'))parts.push('腕下で捕る');
        if(m?.releaseGrip==='overhand')parts.push('クローで投げる');
        if(m?.catchGrip==='overhand')parts.push('クローで捕る');
      }
      return parts.join(' / ');
    });
    if(row.motion.armOrder==='alternate')descriptions.push(`上下交代クロス / この投げは${row.motion.armPhase===1?'右':'左'}腕が上`);
    else if(row.motion.armOrder&&row.motion.armOrder!=='none')descriptions.push(orders.find(([v])=>v===row.motion.armOrder)[1]);
    if(row.motion.arrangement==='inline')descriptions.push('In-line 3 / 保持中も常に縦一列');
    else if(row.motion.transition)descriptions.push('In-lineの入口・出口');
    return descriptions.join('\n');
  }
  function setImporter(card,i){
    const details=el('details',undefined,'set-import');details.append(el('summary','見本の1セットを取り込む'));
    let source,rows;
    const sourceSelect=select(details,'取り込む見本',[],'',()=>{lastImportTemplate=sourceSelect.value;refresh();});
    fillTemplates(sourceSelect);sourceSelect.value=lastImportTemplate;
    const setSelect=select(details,'見本内のセット',[],'',()=>describe());
    const hint=el('p',undefined,'hint set-import-preview');hint.setAttribute('role','status');details.append(hint);
    const tempoLabel=el('label',undefined,'hint'),tempo=el('input');tempo.type='checkbox';tempoLabel.append(tempo,document.createTextNode('列全体を、この見本のセット時間にそろえる'));details.append(tempoLabel);
    details.append(el('p','選んだ1セットの投げ・捕り・運びを回数1で取り込みます。組み替えた列は「成立を確認して再生」で確認できます。','hint'));
    const importSet=insert=>{
      if(insert&&draft.sets.length>=64)return;
      const imported=VRMJuggler.extractSyncSequenceSet(source,Number(setSelect.value)),index=i+(insert?1:0);
      if(insert)draft.sets.splice(index,0,imported);else draft.sets[i]=imported;
      if(tempo.checked)draft.beatDuration=source.beatDuration;
      modified(true);showSet(index);
    };
    const actions=el('div',undefined,'line'),insert=button('この後ろに1セット挿入',()=>importSet(true));
    insert.disabled=draft.sets.length>=64;if(insert.disabled)insert.title='セット列は64行までです。';
    actions.append(button('このセットを置き換える',()=>importSet(false)),insert);details.append(actions);
    function describe(){
      const row=VRMJuggler.extractSyncSequenceSet(source,Number(setSelect.value));
      hint.textContent=describeSet(row)+`\n見本は1セット ${Number((source.beatDuration*2).toFixed(5))}秒 / 現在の列は ${Number((draft.beatDuration*2).toFixed(5))}秒`;
    }
    function refresh(){
      source=templateFrom(sourceSelect.value);rows=VRMJuggler.expandSyncSequence(source);setSelect.replaceChildren();
      rows.forEach((r,index)=>setSelect.add(new Option(`セット${index+1} / 左 ${r.throws[0]}・右 ${r.throws[1]}`,String(index))));
      setSelect.value=String(i%rows.length);describe();
    }
    refresh();card.append(details);
  }
  function render(){
    $('allow-ball-contact').checked=draft.allowBallContact===true;
    if(!partsApplying)syncPartsFromDraft();
    $('name').value=draft.name;$('mirror-repeat').checked=draft.mirrorRepeat;$('tempo').value=String(Number((draft.beatDuration*2).toFixed(5)));
    $('sets').replaceChildren();
    draft.sets.forEach((row,i)=>{
      const card=el('section',undefined,'set');card.setAttribute('aria-label',`セット${i+1}`);card.tabIndex=-1;
      const fixedLayout=row.motion.arrangement==='inline'||row.motion.transition;
      const head=el('header'),tools=el('div',undefined,'set-tools');head.append(el('strong',`SET ${String(i+1).padStart(2,'0')}`));
      number(tools,'回数',row.repeat,1,16,1,v=>{row.repeat=v;modified();});
      tools.append(button('↑',()=>{if(i){[draft.sets[i-1],draft.sets[i]]=[row,draft.sets[i-1]];modified(true);}},'このセットを上へ'),button('↓',()=>{if(i<draft.sets.length-1){[draft.sets[i+1],draft.sets[i]]=[row,draft.sets[i+1]];modified(true);}},'このセットを下へ'),button('複製',()=>{if(draft.sets.length<64){draft.sets.splice(i+1,0,clone(row));modified(true);}}),button('削除',()=>{if(draft.sets.length>1){draft.sets.splice(i,1);modified(true);}}));head.append(tools);card.append(head);
      if(row.sourceName){const source=el('p',`元の見本：${row.sourceName}`,'hint'),back=button('区間一覧へ',()=>{$('section-outline').scrollIntoView({block:'start'});$('section-outline').querySelector('button')?.focus({preventScroll:true});});back.className='section-return';source.append(back);card.append(source);}
      setImporter(card,i);
      if(fixedLayout)card.append(el('p',row.motion.transition?`入口・出口 / 縦配置 ${Math.round((row.motion.inlineBlend||0)*100)}%`:'In-line 3 / 保持中も3球が同じ縦線', 'hint'));
      const hands=el('div',undefined,'hands');
      for(let h=0;h<2;h++){
        const p=el('div',undefined,'hand');p.append(el('h3',h?'R / 右手':'L / 左手'));
        select(p,`${h?'右':'左'}手の投げ`,throws,row.throws[h],v=>{row.throws[h]=v;delete hand(row,h).definition;modified(true);});
        if(['2x','2T'].includes(row.throws[h]))select(p,`${h?'右':'左'}の${row.throws[h]}`,styles,row.motion.hands?.[h]?.style||row.motion.short?.[0]||'normal',v=>{hand(row,h).style=v;options(row,h);modified(true);}).disabled=!!fixedLayout;
        if(fixedLayout&&row.throws[h]!=='0'){
          const more=el('details');more.append(el('summary','手の向き'));gripEditor(more,row,h);p.append(more);
        }
        if(!fixedLayout&&row.throws[h]!=='0'){
          const more=el('details');more.append(el('summary','手の向き・高さ・経路'));
          gripEditor(more,row,h);
          number(more,'投げ・捕りの高さをずらす（cm）',(row.motion.hands?.[h]?.heightOffset||0)*100,-40,40,1,v=>{hand(row,h).heightOffset=v/100;modified();});
          const current=VRMJuggler.syncSequenceHandDefinition(row,h);
          if(row.throws[h]!=='2')for(const [key,label] of [['release','投げるときの腕との関係'],['catch','捕るときの腕との関係']]){
            select(more,label,relations,current[key].relation||'free',v=>{
              const m=hand(row,h);
              if(m.definition||!['2x','2T'].includes(row.throws[h])){
                m.definition ||= clone(current);m.definition[key].relation=v;
              }else options(row,h)[key==='release'?'releaseRelation':'catchRelation']=v;
              modified();
            });
          }
          if(['2x','2T'].includes(row.throws[h])){
            const o=row.motion.hands?.[h]?.shortMotion||row.motion.shortMotions?.[0]||{};
            const lane=select(more,'縦の短い投げが通る場所',[['center','中央'],['outside','外側'],['cross-side','反対側']],o.lane||'center',v=>{options(row,h).lane=v;modified();});
            lane.disabled=!(row.motion.hands?.[h]?.style||row.motion.short?.[0]||'normal').startsWith('vertical-');
            select(more,'捕ってから運ぶ経路',[['auto','動作に合わせる'],...routes],row.motion.hands?.[h]?.definition?current.carry.route:o.carry||'auto',v=>{
              const m=hand(row,h);
              if(m.definition){
                if(v==='auto'){
                  const base=clone(row);delete base.motion.hands[h].definition;
                  const fallback=VRMJuggler.syncSequenceHandDefinition(base,h).carry;
                  m.definition.carry.route=fallback.route;m.definition.carry.amount=fallback.amount;
                }else m.definition.carry.route=v;
              }else{const op=options(row,h);if(v==='auto')delete op.carry;else op.carry=v;}
              modified();
            });
            const l=el('label'),c=el('input');c.type='checkbox';c.checked=!!o.lateral;c.onchange=()=>{options(row,h).lateral=c.checked;modified();};l.append(c,document.createTextNode('体の反対側から投げる / lateral'));more.append(l);
          }
          if(row.motion.arrangement!=='inline')positionEditor(more,row,h);
          p.append(more);
        }
        hands.append(p);
      }
      card.append(hands);const layout=el('div',undefined,'set-layout');
      select(layout,'球の配置',[['columns','通常・位置指定'],['inline','In-line 3 / 常に縦一列']],row.motion.arrangement||'columns',v=>{
        const preset=VRMJuggler.syncSequenceFromPreset(v==='inline'?'inline':'box');row.motion=clone(preset.sets[i%preset.sets.length].motion);modified(true);
      });
      select(layout,'コラムの扱い',columns,row.motion.columns||'normal',v=>{row.motion.columns=v;delete row.motion.columnMotion;delete row.motion.profileId;delete row.motion.shortMotions;delete row.motion.hands;delete row.motion.armPhase;if(v==='crossed')row.motion.armOrder='left-over';modified(true);}).disabled=!!fixedLayout;
      select(layout,'クロスの上下',orders,row.motion.armOrder||(row.motion.columns==='crossed'?'left-over':'none'),v=>{row.motion.armOrder=v;delete row.motion.armPhase;modified(true);}).disabled=!!fixedLayout;
      if(row.motion.armOrder==='alternate')select(layout,'このセットのクロス開始',[['auto','列の順番に合わせる'],['0','左腕が上の局面を保つ'],['1','右腕が上の局面を保つ']],row.motion.armPhase===undefined?'auto':String(row.motion.armPhase),v=>{if(v==='auto')delete row.motion.armPhase;else row.motion.armPhase=Number(v);modified();});
      card.append(layout);$('sets').append(card);
    });
    analyze();
  }
  function refreshTemplateStart(){
    const source=templateFrom($('template').value),rows=VRMJuggler.expandSyncSequence(source),select=$('template-start');select.replaceChildren();
    rows.forEach((r,i)=>select.add(new Option(`セット${i+1}から / 左 ${r.throws[0]}・右 ${r.throws[1]}`,String(i))));
    select.disabled=rows.length===1;select.value='0';describeInto('template-description',templateFrom($('template').value));
  }
  function selectedTemplate(){return VRMJuggler.rotateSyncSequenceStart(templateFrom($('template').value),Number($('template-start').value));}
  function clearConnectionSuggestions(){const panel=$('connection-suggestions');panel.replaceChildren();panel.hidden=true;}
  function showConnectionSuggestions(suggestions){
    clearConnectionSuggestions();if(!suggestions.length)return;
    const panel=$('connection-suggestions');panel.hidden=false;
    panel.append(el('strong','この組合せに対応する接続見本'),el('p','入力した2つの動作に合わせた調整例です。ボタンで列全体を置き換え、再生時に読み込んだモデルの球と腕を確認します。','hint'));
    suggestions.forEach(({exampleIndex,sequence})=>{
      const a=VRMJuggler.analyzeSyncSequence(sequence),seconds=Number((sequence.beatDuration*2).toFixed(5)),item=el('div',undefined,'connection-suggestion');
      item.append(el('p',sequence.name),el('p',`展開後${a.expandedSets}セット / 動き${a.movementSets}セット / 同じ球まで${a.identitySets}セット / 1セット${seconds}秒`,'hint'));
      item.append(button('この接続見本で置き換える',()=>{
        draft=clone(sequence);$('template').value=`example:${exampleIndex}`;refreshTemplateStart();modified(true);
        $('append-status').textContent=`接続見本に置き換えました。1セットは${seconds}秒です。「成立を確認して再生」で確認してください。`;
        $('basic-validity').scrollIntoView({block:'start'});
      },sequence.name));panel.append(item);
    });
  }
  fillTemplates($('template'));
  refreshTemplateStart();
  $('template').onchange=()=>{refreshTemplateStart();clearConnectionSuggestions();};
  $('template-start').onchange=clearConnectionSuggestions;
  $('load-template').onclick=()=>{try{draft=selectedTemplate();modified(true);$('append-status').textContent=`見本のセット${Number($('template-start').value)+1}から一周分を読み込みました。`;}catch(e){$('append-status').textContent=e.message;}};
  function appendToDraft(next){
    const suggestions=VRMJuggler.findSyncConnectionExamples(draft,next);
    const connect=$('bridge-transfers').checked&&analysis.ok&&VRMJuggler.analyzeSyncSequence(next).ok;
    const result=(connect?VRMJuggler.connectSyncSequenceCycles:VRMJuggler.appendSyncSequence)(draft,next,$('match-tempo').checked);
    if(result.sequence){draft=result.sequence;modified(true);}$('append-status').textContent=result.message;
    showConnectionSuggestions(suggestions);
  }
  $('manual-append-template').onclick=()=>{try{const start=Number($('template-start').value);appendToDraft(selectedTemplate());if(start)$('append-status').textContent+=` 見本のセット${start+1}から始めています。`;}catch(e){$('append-status').textContent=e.message;}};
  const basicStyles=styles.slice(0,4),heightLabels=['Normal','Shuffle','Reverse Shuffle','Inverted'],partsCells=[],partsChecks=new Map();
  const partsCheckKey=canonical=>`${$('mirror').checked?'mirror:':'normal:'}${canonical}`;
  const partsKnownNames=new Map([...presets.map(p=>VRMJuggler.syncSequenceFromPreset(p.id)),...examples].map(s=>[VRMJuggler.analyzeSyncSequence(s).canonical,s.name]));
  for(const id of ['parts-double-cross','parts-double-self'])basicStyles.forEach(([value,label])=>$(id).add(new Option(label,value)));
  for(const id of ['parts-left','parts-right']){
    for(const group of [...new Set(ui.shortChoices.map(c=>c.group))]){const optgroup=el('optgroup');optgroup.label=group;ui.shortChoices.filter(c=>c.group===group).forEach(c=>optgroup.append(new Option(c.name,c.id)));$(id).append(optgroup);}
  }
  for(const [value,name,hint] of [['normal','Normal','同じ側のコラム'],['switched','Switched','反対側のコラム'],['crossed','Cross','腕を交差する'],['underarm','Underarm','反対の腕の下で捕る']]){
    const pick=button('',()=>{$('parts-columns').value=value==='crossed'?$('parts-cross-order').value:value;chooseParts();});pick.dataset.column=value;pick.append(el('strong',name),el('small',hint));$('column-choices').append(pick);
  }
  $('parts-cross-order').onchange=()=>{$('parts-columns').value=$('parts-cross-order').value;chooseParts();};
  const matrixHead=el('tr');matrixHead.append(el('th','左 ↓ / 右 →'));
  heightLabels.forEach(label=>{const cell=el('th',label);cell.scope='col';matrixHead.append(cell);});$('parts-matrix').tHead.append(matrixHead);
  basicStyles.forEach(([left],i)=>{
    const row=el('tr'),header=el('th',heightLabels[i]);header.scope='row';row.append(header);
    basicStyles.forEach(([right],j)=>{
      const cell=el('td'),pick=button('○',()=>{$('parts-left').value=left;$('parts-right').value=right;chooseParts();});
      pick.setAttribute('aria-label',`左 ${heightLabels[i]}・右 ${heightLabels[j]}を選ぶ`);cell.append(pick);row.append(cell);partsCells.push({left,right,pick});
    });$('parts-matrix').tBodies[0].append(row);
  });
  function basicParts(){
    const s=$('parts-roles').value==='double'?VRMJuggler.syncSequenceFromDoubleParts({crossSet:$('parts-double-cross').value,selfSet:$('parts-double-self').value,crossReleaseGrip:$('parts-double-cross-grip').value||undefined,selfReleaseGrip:$('parts-double-self-grip').value||undefined,crossCatchGrip:$('parts-double-cross-catch').value||undefined,selfCatchGrip:$('parts-double-self-catch').value||undefined}):ui.namedParts(VRMJuggler,{roles:$('parts-roles').value,left:$('parts-left').value,right:$('parts-right').value,shortHand:Number($('parts-hand').value),columns:$('parts-roles').value==='fixed'?'normal':$('parts-columns').value});
    const known=partsKnownNames.get(VRMJuggler.analyzeSyncSequence(s).canonical);
    s.name=(known||($('parts-roles').value==='double'?'Double｜':'')+ui.describeSequence(s).title).slice(0,100);s.allowBallContact=$('allow-ball-contact').checked;return s;
  }
  function refreshParts(){
    const fixed=$('parts-roles').value==='fixed',double=$('parts-roles').value==='double',hand=Number($('parts-hand').value),s=basicParts(),a=VRMJuggler.analyzeSyncSequence(s);
    $('parts-hand-label').hidden=!fixed;$('parts-hand').disabled=!fixed;
    $('parts-column-label').hidden=true;$('parts-columns').disabled=fixed||double;
    const crossed=$('parts-columns').value.startsWith('crossed');$('parts-cross-label').hidden=!crossed||fixed||double;
    $('column-choices').parentElement.hidden=fixed||double;
    for(const pick of $('column-choices').children)pick.setAttribute('aria-pressed',String(pick.dataset.column===(crossed?'crossed':$('parts-columns').value)));
    for(const side of ['left','right'])$('parts-'+side+'-hint').textContent=ui.shortChoices.find(c=>c.id===$('parts-'+side).value)?.hint||'';
    $('parts-left-label').hidden=double||fixed&&hand!==0;$('parts-right-label').hidden=double||fixed&&hand!==1;$('parts-matrix').hidden=fixed||double;
    for(const part of ['cross','self','cross-grip','self-grip','cross-catch','self-catch']){$(`parts-double-${part}-label`).hidden=!double;$(`parts-double-${part}`).disabled=!double;}
    $('parts-check-legend').hidden=fixed||double;
    partsCells.forEach(({left,right,pick})=>{const selected=left===$('parts-left').value&&right===$('parts-right').value;
      const candidate=VRMJuggler.syncSequenceFromBasicParts({roles:'alternate',shortHand:1,columns:$('parts-columns').value,left,right}),checked=partsChecks.get(partsCheckKey(VRMJuggler.analyzeSyncSequence(candidate).canonical));
      pick.setAttribute('aria-pressed',String(selected));pick.dataset.check=checked===true?'passed':checked===false?'adjust':'unknown';pick.textContent=checked===true?'✓':checked===false?'!':selected?'●':'○';pick.title=checked===true?`現在のモデル・1セット${Number((candidate.beatDuration*2).toFixed(6))}秒で検査済み`:checked===false?'位置や運びの調整が必要':'作成後に成立を確認して再生で検査';
    });
    const known=partsKnownNames.get(a.canonical);
    const gripText=id=>({underhand:'下から',overhand:'クロー'})[$(id).value]||'標準';
    const columnText=double?`左が4x→4、右が4x→4。2xの手向き（4x側／4側）：投げ ${gripText('parts-double-cross-grip')}／${gripText('parts-double-self-grip')}、捕り ${gripText('parts-double-cross-catch')}／${gripText('parts-double-self-catch')}。`:fixed?'4xも2xも反対の手へ渡します。':`${$('parts-columns').selectedOptions[0].textContent}。4は同じ手、2xは反対の手へ。`;
    const d=ui.describeSequence(s),c=d.fields[0][1],l=ui.shortChoices.find(c=>c.id===$('parts-left').value)?.name,r=ui.shortChoices.find(c=>c.id===$('parts-right').value)?.name;
    $('parts-preview').textContent=double?`Double × ${$('parts-double-cross').selectedOptions[0].text} / ${$('parts-double-self').selectedOptions[0].text}`:fixed?`4x固定 × ${hand? r:l}`:`${c} × ${l===r?l:'左 '+l+' / 右 '+r}`;
  }
  function chooseParts(){if(busy)return;draft=basicParts();partsApplying=true;try{modified(true);}finally{partsApplying=false;}$('parts-origin').hidden=true;refreshParts();}
  function syncPartsFromDraft(){
    const rows=draft.sets,c=rows[0]?.motion.columns||'normal',order=rows[0]?.motion.armOrder;
    $('parts-columns').value=c==='crossed'?order==='right-over'?'crossed-right':order==='alternate'?'crossed-alternate':'crossed':c;
    if(c==='crossed')$('parts-cross-order').value=$('parts-columns').value;
    const isDouble=rows.length===4&&rows.some(r=>r.throws.includes('4x'))&&rows.some(r=>r.throws.includes('4'));
    $('parts-roles').value=isDouble?'double':rows.every(r=>r.throws.includes('4x'))?'fixed':'alternate';
    for(const h of [0,1]){const row=rows.find(r=>r.throws[h]==='2x');if(row&&ui.shortChoices.some(c=>c.id===ui.shortKey(row,h)))$('parts-'+(h?'right':'left')).value=ui.shortKey(row,h);}
    if($('parts-roles').value==='fixed')$('parts-hand').value=String(rows[0].throws.indexOf('2x'));
    if(isDouble)for(const [index,key] of [[0,'cross'],[1,'self']]){$('parts-double-'+key).value=rows[index].motion.short?.[0]||'normal';const h=rows[index].throws.indexOf('2x');$('parts-double-'+key+'-grip').value=rows[index].motion.hands?.[h]?.releaseGrip||'';$('parts-double-'+key+'-catch').value=rows[index].motion.hands?.[h]?.catchGrip||'';}
    refreshParts();
    const differs=VRMJuggler.analyzeSyncSequence(basicParts()).canonical!==VRMJuggler.analyzeSyncSequence(draft).canonical;
    $('parts-origin').hidden=!differs;$('parts-origin').textContent='セットごとの指定も含む技です。上で選び直すと、その組合せで作り直します。';
  }
  ['parts-roles','parts-hand','parts-left','parts-right','parts-columns','parts-double-cross','parts-double-self','parts-double-cross-grip','parts-double-self-grip','parts-double-cross-catch','parts-double-self-catch'].forEach(id=>{$(id).onchange=chooseParts;});refreshParts();
  $('parts-replace').onclick=()=>{draft=basicParts();modified(true);};
  $('manual-append-parts').onclick=()=>appendToDraft(basicParts());
  $('use-description-name').onclick=()=>{draft.name=ui.describeSequence(draft).title.slice(0,100);$('name').value=draft.name;modified();};
  $('inline-transitions').onclick=()=>{const result=VRMJuggler.addSyncInlineTransitions(draft);if(result.sequence){draft=result.sequence;modified(true);}$('transition-status').textContent=result.message;};
  $('name').oninput=()=>{draft.name=$('name').value;modified();};$('mirror-repeat').onchange=()=>{draft.mirrorRepeat=$('mirror-repeat').checked;modified();};
  $('tempo').onchange=()=>{if($('tempo').checkValidity()){draft.beatDuration=$('tempo').valueAsNumber/2;modified();}else $('tempo').reportValidity();};
  $('add-set').onclick=()=>{if(draft.sets.length>=64)return;const s=clone(draft.sets[draft.sets.length-1]);s.throws.reverse();if(s.motion.hands)s.motion.hands.reverse();s.repeat=1;draft.sets.push(s);modified(true);};
  $('add-blank').onclick=()=>{if(draft.sets.length<64){draft.sets.push(VRMJuggler.syncSequenceFromPreset('box').sets[draft.sets.length%2]);modified(true);}};
  function showProgram(){
    const p=app.getSyncProgram();$('program').replaceChildren();if(!p)return;
    for(const f of p.flights){
      const row=el('div',undefined,'program-row');row.append(el('p',`球${f.prop+1} / ${f.hand?'右':'左'}手 → ${f.catchHand?'右':'左'}手 / ${f.value}${f.hand!==f.catchHand?'x':f.value===2?'T':''}`));
      const stages=[['投げる',f.release],['通る',f.passage],['捕る',f.catch]];
      if(f.carry)stages.push(['次の投げへ',{time:(f.carry.from+f.carry.duration)%p.period,position:f.carry.end}]);
      stages.forEach(([n,s])=>row.append(button(n+(s.grip==='overhand'?' / クロー':s.grip==='underhand'?' / 下から':''),()=>app.seekPhase(s.time/p.period),`${s.time.toFixed(3)}秒 / ${s.position.map(v=>(v*100).toFixed(0)).join(', ')} cm`)));$('program').append(row);
    }
  }
  async function apply(){
    if(busy||!initialized)return;busy=true;clearFailure();basicCheck={key:`${analysis.canonical}:${$('mirror').checked}`,status:'checking'};analyze();$('draft-status').textContent='球と腕を検査しています…';
    planningAbort=new AbortController();
    // Persist before the expensive work starts, including an immediately
    // preceding selection whose debounced save has not fired yet.
    try{localStorage.setItem(storageKey,JSON.stringify(draft));}catch{}
    const controls=[...$('basic-panel').querySelectorAll('input,select,button,textarea')].filter(e=>e.id!=='planning-cancel').map(e=>[e,e.disabled]);
    controls.forEach(([e])=>{e.disabled=true;});$('planning-state').hidden=false;$('planning-cancel').hidden=false;let cancelled=false;
    const started=performance.now();let caption='計算の準備をしています…';
    const showProgress=()=>{$('planning-detail').textContent=`${caption} ${Math.floor((performance.now()-started)/1000)}秒 · 中止できます。`;};
    showProgress();const progressTimer=setInterval(showProgress,1000);
    try{
      const result=await app.setSyncSequenceAsync(clone(draft),$('mirror').checked,{signal:planningAbort.signal,onProgress:message=>{caption=message;showProgress();}});
      if(!result.ok){partsChecks.set(partsCheckKey(analysis.canonical),false);refreshParts();$('error').textContent=result.failure?'':result.message;showFailure(result);if(!applied&&!replayApplied){app.pause();$('playing-name').textContent='選んだ動きはまだ再現できていません';$('preview-origin').textContent='再生待ち';$('audit').textContent='現在の動作生成では再現できませんでした。';}return;}
      const geometry=app.getSyncBoxReport(),skeleton=app.inspectSyncCycle();
      if(!skeleton?.playbackOK){
        partsChecks.set(partsCheckKey(analysis.canonical),false);refreshParts();
        const phase=!skeleton?.plannedCycle?skeleton?.planInfo?.phase:!skeleton.postureOK?skeleton.posturePhase:
          skeleton.maxGripError>=.012?skeleton.gripPhase:skeleton.minArmDistance<=.065?skeleton.armPhase:skeleton.minBallArmDistance<=.065?skeleton.ballArmPhase:undefined;
        showFailure({failure:{period:geometry.period,issues:[{kind:'arm-path',phase,message:'再生中の腕の間隔・曲げ方・動く速さを1周期にわたって保てません。投げ・捕り・手の運びを調整してください。'}]}});
        if(applied)app.setSyncSequence(applied.sequence,applied.mirror);app.pause();$('error').textContent='腕の周期検査に通らないため停止しました。投げ・捕り・運びの位置を調整してください。';$('draft-status').textContent='腕の経路を調整してください';return;
      }
      partsChecks.set(partsCheckKey(analysis.canonical),true);refreshParts();
      applied={sequence:clone(draft),analysis:result.analysis,mirror:$('mirror').checked};dirty=false;basicCheck={key:`${analysis.canonical}:${$('mirror').checked}`,status:'passed'};previewKind='basic';$('preview-origin').textContent='基本モードで確認した動き';app.setMotionPaths($('paths').checked);app.play();
      applied.labels=draft.sets.flatMap(r=>Array(r.repeat).fill(r.motion.arrangement==='inline'?'In-line 3 / 常に縦一列':r.motion.transition?`入口・出口 / 縦配置 ${Math.round((r.motion.inlineBlend||0)*100)}%`:`${r.sourceName?r.sourceName+' / ':''}左 ${r.throws[0]} / 右 ${r.throws[1]}`));
      if(draft.mirrorRepeat)applied.labels.push(...applied.labels);
      $('playing-name').textContent=draft.name||result.analysis.notation;$('draft-status').textContent='この列を再生中';$('error').textContent='';
      $('audit').textContent=`${geometry.balls}球。${ui.armPlaybackSummary(skeleton)}${ui.ballContactSummary(geometry)}`;
      $('arm-playback-status').hidden=!!skeleton.skeletonOK;
      $('arm-playback-status').textContent=skeleton.skeletonOK?'':'簡易再生：接触・姿勢の近似を許可中';
      $('arm-playback-status').title=ui.armPlaybackSummary(skeleton);
      showBallContact(geometry);
      $('audit').dataset.report=JSON.stringify({name:draft.name,analysis:result.analysis,geometry,skeleton});
      $('timeline').replaceChildren();for(let i=0;i<result.analysis.movementSets;i++)$('timeline').append(button(`${i+1}`,()=>app.seekPhase(i*2*applied.sequence.beatDuration/app.getMotionSnapshot().period),`セット${i+1}へ`));
      showProgram();try{localStorage.setItem(storageKey,JSON.stringify(draft));}catch{}
    }catch(e){
      if(e.name==='AbortError'){cancelled=true;basicCheck=null;$('error').textContent='';}
      else{basicCheck={key:`${analysis.canonical}:${$('mirror').checked}`,status:'failed'};$('error').textContent=e.message||String(e);$('draft-status').textContent='検査できませんでした';}
    }
    finally{clearInterval(progressTimer);planningAbort=null;$('planning-state').hidden=!cancelled;$('planning-cancel').hidden=true;if(cancelled)$('planning-detail').textContent='生成を中止しました。選んだ組合せは保持しています。';controls.forEach(([e,disabled])=>{e.disabled=disabled;});busy=false;$('apply').disabled=!analysis?.ok;refreshBasicStatus();}
  }
  $('planning-cancel').onclick=()=>planningAbort?.abort();
  $('apply').onclick=apply;$('mirror').onchange=()=>{modified();refreshParts();};
  $('allow-ball-contact').onchange=()=>{draft.allowBallContact=$('allow-ball-contact').checked;modified();refreshParts();};
  let segmentRoute=[],segmentHistory=[],replayApplied=null,pendingTransition=null,pendingTransitionDraft=null,connectionReport=null;
  $('open-segment-builder').onclick=()=>switchMode('connect');
  const segmentStorageKey='vrm-sync-segments-v1';
  function persistSegments(onDocument){
    try{const saved=app.exportSyncSegments(segmentRoute,($('segment-name').value||$('route-title').textContent).slice(0,100));onDocument?.(saved);localStorage.setItem(segmentStorageKey,JSON.stringify(saved));}
    catch(e){$('segment-status').textContent+=' 自動保存できませんでした: '+e.message;}
  }
  function replaceSegmentRoute(ids){
    segmentHistory.push(segmentRoute.slice());if(segmentHistory.length>128)segmentHistory.shift();
    segmentRoute=ids.slice();
  }
  function segmentCycleInfo(ids){
    if(!ids.length)return {text:'接続列は空です。最初の動作を選んでください。',closed:false,canClose:false};
    try{
      const a=app.analyzeSyncSegments(ids);
      return {text:`動きの周期 ${a.sets}セット / 同じ球まで ${a.identitySets}セット。先頭につながっています。`,closed:true,canClose:false};
    }catch{
      try{
        const closed=app.closeSyncSegments(ids),a=app.analyzeSyncSegments(closed),closingSets=closed.length-ids.length;
        return {text:`現在 ${ids.length}セット。戻りの${closingSets}セットを加えると、動きの周期 ${a.sets}セット / 同じ球まで ${a.identitySets}セット。`,closed:false,canClose:true,closingSets};
      }catch(e){return {text:`現在 ${ids.length}セット。周期を確定できません: ${e.message}`,closed:false,canClose:false};}
    }
  }
  function refreshSourceStart(){
    const select=$('segment-source-start'),index=$('segment-source').value;
    const source=app.getSyncSegmentSources().find(s=>String(s.index)===index);
    const previous=select.dataset.source===index?select.value:'0';
    select.replaceChildren();
    for(let i=0;i<(source?.sets||0);i++)select.add(new Option(`セット${i+1}から（最後はセット${(i+source.sets-1)%source.sets+1}）`,String(i)));
    select.value=source&&Number(previous)<source.sets?previous:'0';
    select.disabled=!source||source.sets===1;select.dataset.source=index;
  }
  function refreshSourceAppend(){
    const select=$('segment-source'),repeat=$('segment-source-repeat'),status=$('segment-source-status');
    const source=routeDocument?.sources[Number(select.value)];
    $('source-description').replaceChildren();if(select.value&&source){describeInto('source-description',source.sequence);if(source.mirror)$('source-description').prepend(el('p','左右反転で登録済み。内訳は反転前の定義です。','hint'));}
    status.dataset.state='pending';
    $('segment-source-add').disabled=true;
    if(!select.value){status.textContent='基本モードで動作を登録するか、「使う動作を用意する」でまとめて準備してください。';return;}
    if(!repeat.checkValidity()||!Number.isInteger(repeat.valueAsNumber)){status.textContent='繰り返す回数を1〜16の整数で指定してください。';return;}
    try{
      const result=app.appendSyncSource(segmentRoute,Number(select.value),repeat.valueAsNumber,Number($('segment-source-start').value)),cycle=segmentCycleInfo(result.ids);
      const motionSets=source?VRMJuggler.analyzeSyncSequence(source.sequence).movementSets:result.sourceSets;
      status.textContent=`✓ 追加できます。${result.bridge.length?`移行${result.bridge.length}セットを挟みます。`:'前の動作から直接つながります。'}登録1周は${result.sourceSets}セット${motionSets&&motionSets!==result.sourceSets?`（動きの${result.sourceSets/motionSets}周分）`:''}。今回の追加は動作${result.sourceSets*result.repeats}セットです。${cycle.text}`;
      status.dataset.state='passed';
      $('segment-source-add').disabled=false;
    }catch(e){status.dataset.state='failed';status.textContent=`! 追加には移行の準備が必要です: ${e.message} 「つながらないとき：AとBの移行を準備」を開いてください。`;}
  }
  function refreshRoutePresentation(sources,cycle){
    connectionState={sources:sources.length,count:segmentRoute.length,...cycle};
    const verdict=ui.connectionVerdict(connectionState);
    $('connect-validity').dataset.state=verdict.state;$('connect-verdict').textContent=verdict.title;$('connect-next').textContent=verdict.next;
    $('connect-checks').replaceChildren(checkItem('動作の球・腕',sources.length?'passed':'pending',sources.length?'✓ 登録時に検査済み':'未登録'),checkItem('隣同士の接続',segmentRoute.length?'passed':'pending',segmentRoute.length?'✓ 接続済み':'動作を選択'),checkItem('末尾 → 先頭',cycle.closed?'passed':'pending',cycle.closed?'✓ 戻れます':cycle.canClose?'戻りを追加できます':'未接続'));
    const groups=routeDocument?ui.routeGroups(routeDocument,sources):[];
    $('route-overview').replaceChildren();
    groups.forEach(g=>{const item=el('li',undefined,g.transition?'route-bridge':'route-motion');
      item.append(el('strong',g.transition?'つなぎ（自動）':g.name+(g.mirror?'（左右反転）':'')),el('span',`${g.count}セット`,'route-length'));
      if(g.transition)item.title=g.name;
      else{
        const description=ui.describeSequence(routeDocument.sources[g.source].sequence);
        const fields=description.fields,left=fields[1][1].replace(/^2x /,''),right=fields[2][1].replace(/^2x /,'');
        item.append(el('p',`${fields[0][1]} × ${left===right?left:'左 '+left+' / 右 '+right}`,'hint'));
      }
      $('route-overview').append(item);
    });
    const motions=groups.filter(g=>!g.transition).map(g=>g.name),title=motions.slice(0,4).join(' → ')+(motions.length>4?' → …':'');
    $('route-title').dataset.suggested=title||'動作を選んでください';$('route-title').textContent=$('segment-name').value||$('route-title').dataset.suggested;$('segment-name').placeholder=(title||'例：Box → クロー → Box').slice(0,100);
    refreshPreviewNotice();refreshModeAction();
  }
  function refreshSegments(){
    const context=app.getSyncSegmentContext();
    $('segment-context').textContent=context?`登録済み: ${context.balls}球 / 1セット約${Number(context.secondsPerSet.toFixed(6))}秒。別の時間を使う場合は登録部品をクリアしてから登録してください。`:'登録した動作の球数と1セットの時間をここに表示します。';
    $('segment-match-tempo').disabled=!context;
    const sources=app.getSyncSegmentSources();
    if($('library-tools').dataset.populated!=='true')$('library-tools').open=false;
    $('library-tools').dataset.populated=String(!!sources.length);
    $('library-summary').textContent='詳細：動作の一括準備・管理';
    $('segment-canonical').value='';
    routeDocument=null;$('segment-code').textContent='動作を登録すると、保存内容の識別子を表示します。';
    if(sources.length)try{
      routeDocument=app.exportSyncSegments(segmentRoute,$('segment-name').value);
      const description=app.describeSyncSegments(segmentRoute);$('segment-canonical').value=description.canonical;
      $('segment-code').textContent=`保存内容の識別子：${description.code}${description.identitySets===null?' / 周期未確定':''}`;
    }catch(e){$('segment-code').textContent=`識別子を作れません: ${e.message}`;}
    const anchors=sources.filter(s=>s.purpose!=='transition'),anchorSelect=$('segment-connection-anchor'),oldAnchor=anchorSelect.value;
    anchorSelect.replaceChildren();anchors.forEach(s=>anchorSelect.add(new Option(s.name+(s.mirror?' / 左右反転':''),String(s.index))));
    anchorSelect.value=anchors.some(s=>String(s.index)===oldAnchor)?oldAnchor:String(anchors[0]?.index??'');
    connectionReport=null;$('segment-connection-rows').replaceChildren();$('segment-connection-table').hidden=true;
    $('segment-connection-check').disabled=!anchors.length;
    $('segment-connection-status').textContent=anchors.length?'現在の登録内容で接続状況を確認できます。':'動作を登録すると確認できます。';
    const transitions=sources.filter(s=>s.purpose==='transition').length,sourceSelect=$('segment-source'),selected=sourceSelect.value;
    $('segment-inventory').textContent=sources.length?`登録済みの動作 ${sources.length-transitions}件 / 移行用の区間 ${transitions}件。次の動作の選択時は登録済みの経路を使います。`:'まだ動作を登録していません。';
    const sourceChoices=sources.filter(s=>$('segment-source-transitions').checked||s.purpose!=='transition');
    sourceSelect.replaceChildren();sourceChoices.forEach(s=>sourceSelect.add(new Option(s.name+(s.mirror?' / 左右反転':'')+`（${s.sets}セット）`,String(s.index))));
    sourceSelect.value=sourceChoices.some(s=>String(s.index)===selected)?selected:String(sourceChoices[0]?.index??'');
    refreshSourceStart();
    for(const [id,fallback] of [['segment-from',0],['segment-to',1]]){
      const select=$(id),previous=select.value;select.replaceChildren();
      sources.forEach(s=>select.add(new Option(s.name+(s.mirror?' / 左右反転':''),String(s.index))));
      select.value=sources.some(s=>String(s.index)===previous)?previous:String(Math.min(fallback,sources.length-1));
    }
    if(sources.length>1&&$('segment-from').value===$('segment-to').value)$('segment-to').value=String(sources.find(s=>String(s.index)!==$('segment-from').value).index);
    $('segment-transition').disabled=sources.length<2;
    if(sources.length<2)$('segment-transition-status').textContent='まず2つの動作を登録してください。';
    else if($('segment-transition-status').textContent==='まず2つの動作を登録してください。')$('segment-transition-status').textContent='動作AとBを選び、移行を検査して登録してください。';
    const choices=app.getSyncSegmentChoices(segmentRoute.length?segmentRoute[segmentRoute.length-1]:undefined),all=app.getSyncSegmentChoices();
    $('segment-next').replaceChildren();choices.forEach(e=>$('segment-next').add(new Option(e.name,String(e.id))));
    $('segment-add').disabled=!choices.length||segmentRoute.length>=128;$('segment-undo').disabled=!segmentRoute.length&&!segmentHistory.length;
    $('segment-undo').textContent=segmentHistory.length?'直前の追加・変更を戻す':'最後の1セットを戻す';
    $('segment-route').replaceChildren();segmentRoute.forEach(id=>$('segment-route').append(el('li',all.find(e=>e.id===id)?.name||'登録が失われた部品')));
    const cycle=segmentCycleInfo(segmentRoute);$('segment-cycle').textContent=cycle.text;
    refreshRoutePresentation(sources,cycle);
    $('segment-play').disabled=!segmentRoute.length;$('segment-close').disabled=!cycle.canClose;
    $('segment-close').textContent=cycle.canClose?`先頭への戻りを補う（${cycle.closingSets}セット）`:'先頭への戻りを補う';
    $('segment-save').disabled=!all.length;$('segment-status').textContent='';refreshSourceAppend();
    if(!segmentRoute.length)return;
    try{app.analyzeSyncSegments(segmentRoute);$('segment-play').disabled=false;}
    catch{}
  }
  async function registerSegments(action){
    if(busy||!initialized)return;
    busy=true;$('basic-register-status').textContent='接続先の条件に合わせて球と腕を検査し、登録しています…';refreshBasicStatus();
    $('segment-status').textContent=$('basic-register-status').textContent;
    await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
    try{
      const source=action(),result=ui.appendConnected(app,segmentRoute,source);
      replaceSegmentRoute(result.ids);refreshSegments();$('basic-register-status').textContent='技の並びに追加しました。';persistSegments();$('legacy-connect').open=true;switchMode('connect');
    }catch(e){refreshSegments();$('basic-register-status').textContent='この技の動き、または次の技へのつなぎをまだ生成できません。追加前の並びを保っています。';$('segment-status').textContent=e.message;}
    finally{busy=false;refreshBasicStatus();}
  }
  $('segment-register').onclick=()=>{
    if(currentCheck()?.status!=='passed')return;
    registerSegments(()=>{
      const sequence=registrationSequence(draft),mirror=$('mirror').checked;
      const doc=app.getSyncSegmentSources().length?app.exportSyncSegments(segmentRoute,''):null;
      const canonical=VRMJuggler.analyzeSyncSequence(sequence).canonical;
      const existing=doc?.sources.findIndex(s=>s.mirror===mirror&&VRMJuggler.analyzeSyncSequence(s.sequence).canonical===canonical)??-1;
      if(existing>=0)return existing;
      app.registerSyncSequence(sequence,mirror);return app.getSyncSegmentSources().length-1;
    });
  };
  function registrationSequence(sequence){const s=clone(sequence),context=app.getSyncSegmentContext();if(context)s.beatDuration=context.secondsPerSet/2;return s;}
  let cancelPreparation=false;
  function refreshPreparationFamily(){
    $('segment-prepare-hint').textContent=$('segment-prepare-family').value==='hf-underarm'?
      '通常Box・Reverse Shuffle・Box Rollと、腕下投げ・捕球・クロー・Double・役割固定を含む11動作を1セット0.5秒でつなぎます。別のテンポで登録済みの場合は、接続列をJSON保存してから「登録部品をクリア」してください。':
      '通常・Switched・腕下の各16通り、クロスの8通り、縦2xなどの18経路、基本Doubleの16通りを合わせた90動作を準備します。登録庫が空なら1セット0.41秒、登録済みならそのテンポを使います。';
  }
  $('segment-prepare-family').onchange=refreshPreparationFamily;refreshPreparationFamily();
  $('segment-prepare-cancel').onclick=()=>{cancelPreparation=true;$('segment-prepare-status').textContent='準備を中止しています…';};
  $('segment-prepare').onclick=async()=>{
    if(busy||!initialized)return;
    const mirror=$('mirror').checked,task=app.prepareSyncBasicNetwork(mirror,$('segment-prepare-family').value),progress=$('segment-prepare-progress'),status=$('segment-prepare-status');
    const controls=[...document.querySelectorAll('button,input,select,textarea')].filter(e=>e.id!=='segment-prepare-cancel').map(e=>[e,e.disabled]);
    busy=true;cancelPreparation=false;controls.forEach(([e])=>{e.disabled=true;});
    $('segment-prepare').setAttribute('aria-busy','true');$('segment-prepare-cancel').hidden=false;progress.hidden=false;progress.value=0;
    try{
      let step=task.next();
      while(!step.done){
        progress.max=step.value.total;progress.value=step.value.completed;
        status.textContent=`${step.value.completed} / ${step.value.total} 完了 · ${step.value.stage==='source'?'部品':'移行'}を検査: ${step.value.name}`;
        await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
        if(cancelPreparation){task.return();status.textContent='準備を中止しました。準備途中の部品・移行は追加していません。';return;}
        step=task.next();
      }
      const result=step.value;progress.value=progress.max=result.total;
      if(!segmentRoute.length)segmentRoute=result.ids;
      clearPendingTransition();refreshSegments();
      persistSegments(saved=>result.sourceIndices.forEach(i=>partsChecks.set(partsCheckKey(VRMJuggler.analyzeSyncSequence(saved.sources[i].sequence).canonical),true)));
      $('segment-from').value=String(result.sourceIndices[0]);$('segment-to').value=String(result.sourceIndices[1]);
      status.textContent=`${result.sourceIndices.length}部品の準備ができました。追加した部品${result.addedSources}件・移行${result.addedTransitions}件。「次の動作を追加」で並べると、準備した経路を使ってつなぎます。`;
    }catch(e){
      task.return();status.textContent=`準備できませんでした: ${e.message} 準備途中の部品・移行は追加していません。`;
    }finally{
      busy=false;$('segment-prepare').removeAttribute('aria-busy');$('segment-prepare-cancel').hidden=true;
      controls.forEach(([e,disabled])=>{e.disabled=disabled;});refreshParts();refreshSegments();analyze();
      $('segment-transition-apply').disabled=!pendingTransition;$('segment-transition-edit').disabled=!pendingTransitionDraft;
    }
  };
  function clearPendingTransition(){pendingTransition=null;pendingTransitionDraft=null;$('segment-transition-apply').disabled=true;$('segment-transition-edit').disabled=true;}
  function renderConnections(){
    const rows=$('segment-connection-rows');rows.replaceChildren();
    if(!connectionReport){$('segment-connection-table').hidden=true;return;}
    const report=connectionReport,missing=report.totalStarts-report.connectedStarts;
    $('segment-connection-status').textContent=`先頭から一周: ${report.connected} / ${report.sources.length}動作で往復可能。全開始位置: ${report.connectedStarts} / ${report.totalStarts}か所で往復可能、未接続${missing}か所。${missing?'未接続の行から、準備する移行を選べます。':'各開始位置と基準の往復経路を確認できました。'}`;
    $('segment-connection-caption').textContent=`${report.name}との接続（追加の移行セット数）`;
    const rowsByStart=report.sources.flatMap(s=>$('segment-connection-starts').checked?s.starts.map(start=>({...s,...start})):[{...s,startSet:0}]);
    const shown=rowsByStart.filter(s=>!$('segment-connection-missing').checked||s.forwardSets===null||s.returnSets===null);
    for(const s of shown){
      const row=el('tr');row.append(el('td',s.name+(s.mirror?' / 左右反転':'')+` / セット${s.startSet+1}から`),
        el('td',s.forwardSets===null?'未接続':`${s.forwardSets}セット`),el('td',s.returnSets===null?'未接続':`${s.returnSets}セット`));
      const action=el('td');
      if(s.forwardSets===null||s.returnSets===null)action.append(button('移行を準備',()=>{
        if(busy)return;
        $('transition-tools').open=true;
        $('segment-from').value=String(report.anchor);$('segment-to').value=String(s.index);clearPendingTransition();
        $('segment-transition-status').textContent='この2つの動作を選びました。「移行を検査して登録」で不足する経路を準備します。';
        $('segment-transition').scrollIntoView({block:'center'});$('segment-transition').focus({preventScroll:true});
      },`${report.name}と${s.name}の移行を準備`));
      else action.append(button('この開始位置を選ぶ',()=>{
        if(busy)return;
        $('segment-source').value=String(s.index);refreshSourceStart();$('segment-source-start').value=String(s.startSet);refreshSourceAppend();
        $('segment-source-start').closest('details').open=true;
        $('segment-source-start').scrollIntoView({block:'center'});$('segment-source-start').focus({preventScroll:true});
      },`${s.name}をセット${s.startSet+1}から追加する設定を選ぶ`));
      row.append(action);rows.append(row);
    }
    $('segment-connection-table').hidden=!shown.length;
  }
  $('segment-connection-anchor').onchange=()=>{
    connectionReport=null;renderConnections();$('segment-connection-status').textContent='選んだ基準で接続状況を確認してください。';
  };
  $('segment-connection-missing').onchange=renderConnections;
  $('segment-connection-starts').onchange=renderConnections;
  $('segment-connection-check').onclick=async()=>{
    if(busy||!$('segment-connection-anchor').value)return;
    busy=true;$('segment-connection-check').disabled=true;$('segment-connection-status').textContent='登録済みの経路を確認しています…';
    await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
    try{connectionReport=app.getSyncSourceConnections(Number($('segment-connection-anchor').value));renderConnections();}
    catch(e){connectionReport=null;renderConnections();$('segment-connection-status').textContent=e.message;}
    finally{busy=false;$('segment-connection-check').disabled=!$('segment-connection-anchor').value;}
  };
  $('segment-from').onchange=$('segment-to').onchange=()=>{clearPendingTransition();$('segment-transition-status').textContent='この2つの動作の移行を確認してください。';};
  $('segment-transition').onclick=async()=>{
    if(busy||!initialized)return;
    const from=Number($('segment-from').value),to=Number($('segment-to').value);
    if(from===to){$('segment-transition-status').textContent='異なる2つの動作を選んでください。';return;}
    clearPendingTransition();busy=true;$('segment-from').disabled=$('segment-to').disabled=true;$('segment-transition-status').textContent='既存の移行を探し、必要な区間の球と腕を検査しています…';
    await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
    try{
      const result=app.registerSyncTransition(from,to),sources=app.getSyncSegmentSources();
      const name=`${sources[from].name} → ${sources[to].name} → ${sources[from].name}`.slice(0,100);
      // The button below explicitly replaces the route; inspection alone keeps it.
      app.analyzeSyncSegments(result.route);pendingTransition={...result,from,to,name};
      refreshSegments();$('segment-transition-apply').disabled=false;
      $('segment-transition-status').textContent=`${result.added?'新しい移行を登録しました':'登録済みの移行を再利用できます'}${result.via?`（${result.via}経由）`:''}。A→Bは${result.forward.length}セット、B→Aは${result.backward.length}セットの移行。往復列は${result.route.length}セットです。`;
      persistSegments();
    }catch(e){
      $('segment-transition-status').textContent=e.message;
      if(e.sequence){pendingTransitionDraft={sequence:clone(e.sequence),failure:e.failure,mirror:e.mirror};$('segment-transition-edit').disabled=false;$('segment-transition-status').textContent+=' 「調整用の移行を編集欄へ」で、候補の投げ・捕り・運びを変更できます。';}
    }finally{busy=false;$('segment-from').disabled=$('segment-to').disabled=false;refreshModeAction();}
  };
  $('segment-transition-apply').onclick=()=>{
    if(busy||!pendingTransition)return;
    replaceSegmentRoute(pendingTransition.route);$('segment-name').value=pendingTransition.name;
    refreshSegments();persistSegments();
  };
  $('segment-transition-edit').onclick=()=>{
    if(busy||!pendingTransitionDraft)return;
    switchMode('basic',false);$('set-editor').open=true;
    draft=clone(pendingTransitionDraft.sequence);$('mirror').checked=!!pendingTransitionDraft.mirror;modified(true);
    if(pendingTransitionDraft.failure)showFailure(pendingTransitionDraft);
    $('draft-status').textContent='移行の調整中 / この候補は未再生';showSet(0);
  };
  $('segment-source').onchange=()=>{refreshSourceStart();refreshSourceAppend();};
  $('segment-source-start').onchange=$('segment-source-repeat').oninput=refreshSourceAppend;
  $('segment-source-transitions').onchange=refreshSegments;
  $('segment-source-add').onclick=()=>{
    if(busy||!$('segment-source').value)return;
    try{
      const result=app.appendSyncSource(segmentRoute,Number($('segment-source').value),$('segment-source-repeat').valueAsNumber,Number($('segment-source-start').value));
      replaceSegmentRoute(result.ids);refreshSegments();persistSegments();
    }catch(e){$('segment-source-status').textContent=e.message;}
  };
  $('segment-add').onclick=()=>{if(busy||!$('segment-next').value)return;replaceSegmentRoute([...segmentRoute,Number($('segment-next').value)]);refreshSegments();persistSegments();};
  $('segment-undo').onclick=()=>{if(busy)return;segmentRoute=segmentHistory.length?segmentHistory.pop():segmentRoute.slice(0,-1);refreshSegments();persistSegments();};
  $('segment-reset').onclick=()=>{if(busy)return;replaceSegmentRoute([]);refreshSegments();$('segment-status').textContent='最初の部品を選んでください。';if(app.getSyncSegmentChoices().length)persistSegments();};
  $('segment-clear').onclick=()=>{if(busy)return;app.clearSyncSegments();segmentRoute=[];segmentHistory=[];if(replayApplied)replayApplied.detached=true;clearPendingTransition();refreshSegments();try{localStorage.removeItem(segmentStorageKey);}catch{}$('segment-status').textContent='登録部品をクリアしました。';$('segment-transition-status').textContent='まず2つの動作を登録してください。';};
  $('segment-close').onclick=()=>{if(busy)return;try{replaceSegmentRoute(app.closeSyncSegments(segmentRoute));refreshSegments();persistSegments();}catch(e){$('segment-status').textContent=e.message;}};
  $('segment-name').oninput=()=>{$('route-title').textContent=$('segment-name').value||$('route-title').dataset.suggested;if(!busy&&app.getSyncSegmentChoices().length)persistSegments();};
  $('segment-save').onclick=()=>{
    if(busy)return;
    try{const doc=app.exportSyncSegments(segmentRoute,($('segment-name').value||$('route-title').textContent).slice(0,100)),a=el('a');
      a.href=URL.createObjectURL(new Blob([JSON.stringify(doc,null,2)],{type:'application/json'}));
      a.download=(doc.name||'接続列').replace(/[\\/:*?"<>|]/g,'_')+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);persistSegments();
    }catch(e){$('segment-status').textContent=e.message;}
  };
  async function restoreSegments(read){
    if(busy||!initialized)return;
    busy=true;$('segment-status').textContent='保存した元の動作を、現在のモデルで再検査しています…';
    try{
      const text=await read();if(!text)throw new Error('自動保存した接続列はまだありません。');
      if(text.length>2000000)throw new Error('接続列JSONは2MB以内で読み込んでください。');
      const doc=JSON.parse(text);await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
      const result=app.restoreSyncSegments(doc);segmentRoute=result.ids;segmentHistory=[];if(replayApplied)replayApplied.detached=true;clearPendingTransition();$('segment-name').value=result.name;
      refreshSegments();$('segment-status').textContent=(segmentRoute.length?$('segment-status').textContent:'接続列は空です。最初の部品を選んでください。')+` ${result.sources}件の元動作を再検査し、${result.segments}部品を復元しました。`;persistSegments();
    }catch(e){$('segment-status').textContent='復元できませんでした: '+e.message;}finally{busy=false;refreshBasicStatus();}
  }
  $('segment-import').onchange=()=>{const f=$('segment-import').files[0];$('segment-import').value='';if(f)restoreSegments(()=>{if(f.size>2000000)throw new Error('接続列JSONは2MB以内で読み込んでください。');return f.text();});};
  $('segment-restore').onclick=()=>restoreSegments(()=>localStorage.getItem(segmentStorageKey));
  $('segment-play').onclick=async()=>{
    if(busy||!initialized)return;
    busy=true;refreshModeAction();$('segment-status').textContent='つなぎを確認しています…';
    await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
    try{const closed=ui.closeConnected(app,segmentRoute);const next=app.playSyncSegments(closed);
      if(JSON.stringify(closed)!==JSON.stringify(segmentRoute))replaceSegmentRoute(closed);
      replayApplied=next;replayApplied.ids=segmentRoute.slice();refreshSegments();persistSegments();
      previewKind='connect';$('preview-origin').textContent='つなぐモードで再生した動き';refreshPreviewNotice();
      $('playing-name').textContent=$('segment-name').value||$('route-title').textContent;$('current-section').textContent='';
      const skeleton=app.inspectSyncCycle();
      $('audit').textContent=`${replayApplied.sets}セットの周期。${ui.armPlaybackSummary(skeleton)}${ui.ballContactSummary(replayApplied)}`;
      $('arm-playback-status').hidden=!!skeleton?.skeletonOK;
      $('arm-playback-status').textContent=skeleton?.skeletonOK?'':'簡易再生：接触・姿勢の近似を許可中';
      $('arm-playback-status').title=ui.armPlaybackSummary(skeleton);
      $('audit').dataset.report=JSON.stringify({skeleton});
      showBallContact(replayApplied);
      $('program').replaceChildren();$('timeline').replaceChildren();
      replayApplied.segments.forEach((s,i)=>$('timeline').append(button(String(i+1),()=>app.seekPhase(i*replayApplied.secondsPerSet/replayApplied.period),s.name)));
    }catch(e){$('segment-status').textContent='先頭へのつなぎを、まだ自動生成できません。並びは変更していません。';}
    finally{busy=false;refreshModeAction();}
  };
  refreshSegments();
  $('play').onclick=()=>app.togglePause();$('step').onclick=()=>app.step();$('reset').onclick=()=>app.seekPhase(0);
  $('view').onchange=()=>app.setCameraView($('view').value);$('speed').onchange=()=>app.setSpeed(Number($('speed').value));
  $('phase').oninput=()=>app.seekPhase(Number($('phase').value)/1000);$('paths').onchange=()=>app.setMotionPaths($('paths').checked);
  $('stage').addEventListener('statechange',e=>{$('play').textContent=e.detail.paused?'再生':'一時停止';});
  $('save').onclick=()=>{const a=el('a');a.href=URL.createObjectURL(new Blob([JSON.stringify(draft,null,2)],{type:'application/json'}));a.download=(draft.name||'sync-pattern').replace(/[\\/:*?"<>|]/g,'_')+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);};
  function loadJSON(text){const parsed=JSON.parse(text),a=VRMJuggler.analyzeSyncSequence(parsed);if(!a.documentOK)throw new Error(a.issues.map(i=>i.message).join('\n'));draft=parsed;modified(true);}
  $('import').onchange=async()=>{try{const f=$('import').files[0];if(f){if(f.size>200000)throw new Error('JSONは200KB以内で読み込んでください。');loadJSON(await f.text());}}catch(e){$('error').textContent='読み込み: '+e.message;}finally{$('import').value='';}};
  $('restore').onclick=()=>{try{const saved=localStorage.getItem(storageKey);if(saved)loadJSON(saved);else $('error').textContent='自動保存した列はまだありません。';}catch(e){$('error').textContent='自動保存の読み込み: '+e.message;}};
  $('model').onchange=async()=>{const f=$('model').files[0];if(!f||busy)return;const url=URL.createObjectURL(f);busy=true;basicCheck=null;partsChecks.clear();refreshParts();analyze();try{await app.loadModel(url);applied=null;previewKind=null;}finally{URL.revokeObjectURL(url);busy=false;segmentRoute=[];segmentHistory=[];replayApplied=null;clearPendingTransition();refreshSegments();if(mode==='connect')await routeBuilder.play();else await apply();}};
  let catalog=[];
  function selectCatalogComponent(id){$('catalog-component').value=id;$('catalog-filter').value='all';$('catalog-search').value='';showCatalog();}
  function loadCatalogParts(record){
    if(busy||record.builder?.kind!=='double')return;
    try{
      const sequence=VRMJuggler.syncSequenceFromDoubleParts(record.builder.parts);
      $('parts-roles').value='double';$('parts-double-cross').value=record.builder.parts.crossSet;$('parts-double-self').value=record.builder.parts.selfSet;
      for(const id of ['cross-grip','self-grip','cross-catch','self-catch'])$(`parts-double-${id}`).value='';
      refreshParts();$('parts-builder').open=true;draft=sequence;draft.name=('組合せ候補 / '+record.name).slice(0,100);modified(true);
      $('draft-status').textContent='部品対応から作った候補 / 原動作の手向き・運びとの一致は未照合';switchMode('basic');
    }catch(e){$('catalog-count').textContent=`候補を作れませんでした: ${e.message}`;}
  }
  function showCatalog(){
    const q=$('catalog-search').value.trim().toLowerCase(),filter=$('catalog-filter').value,component=$('catalog-component').value;
    const basis=catalog.filter(r=>r.category==='HFの18分類'),unresolved=new Set(basis.filter(r=>r.status==='reference').map(r=>r.id));
    const combinations=catalog.filter(r=>r.component_refs),byId=new Map(catalog.map(r=>[r.id,r]));
    $('catalog-basis').textContent=`基本${basis.length}分類：見本・対応部品あり${basis.length-unresolved.size}、原動作の照合待ち${unresolved.size}。Double ${combinations.length}組のうち、未照合の基本部品を含むものは${combinations.filter(r=>r.component_refs.some(id=>unresolved.has(id))).length}組。基本部品から候補を作れるものは${combinations.filter(r=>r.builder).length}組です。`;
    const rows=catalog.filter(r=>(filter==='all'||r.status===filter)&&(!component||r.id===component||r.component_refs?.includes(component))&&`${r.name} ${r.category} ${r.note}`.toLowerCase().includes(q));
    $('catalog-items').replaceChildren();
    for(const r of rows){
      const row=el('div',undefined,'catalog-row');row.append(el('strong',r.name),el('small',r.category),el('p',r.note));
      if(r.component_refs){
        r.component_refs.forEach((id,i)=>{
          const part=byId.get(id),state=part?.status==='playable'?'見本あり':part?.status==='components'?'対応部品あり':'原動作未照合';
          row.append(button(`${i===0?'4x側':'4側'}：${part?.name||id} / ${state}`,()=>selectCatalogComponent(id),'この基本部品を使う組合せを表示'));
        });
      }else if(r.category==='HFの18分類')row.append(button('この部品を使うDoubleを表示',()=>selectCatalogComponent(r.id)));
      const a=el('a','参照資料 ↗');a.href=r.source;a.target='_blank';a.rel='noreferrer';row.append(a);
      if(r.template)row.append(button('基本モードで編集',()=>{$('template').value=r.template;refreshTemplateStart();draft=selectedTemplate();modified(true);switchMode('basic');}));
      else if(r.builder)row.append(button('基本部品で候補を作る',()=>loadCatalogParts(r),'標準の手向きで候補を作り、投げ・捕り・運びを編集'));
      $('catalog-items').append(row);
    }
    $('catalog-count').textContent=`${rows.length}件を表示 / 出典別${catalog.length}項目。再生できる見本、対応部品、原動作の照合待ちを分けています。`;
  }
  $('catalog-search').oninput=showCatalog;$('catalog-filter').onchange=showCatalog;
  $('catalog-component').onchange=()=>{if($('catalog-component').value)$('catalog-filter').value='all';showCatalog();};
  fetch('./sync-catalog.json').then(r=>{if(!r.ok)throw new Error();return r.json();}).then(c=>{
    catalog=c.records;catalog.filter(r=>r.category==='HFの18分類').forEach(r=>$('catalog-component').add(new Option(r.name,String(r.id))));showCatalog();
  }).catch(()=>{$('catalog-count').textContent='対応表を読み込めませんでした。ページを再読み込みしてください。';});
  document.addEventListener('keydown',e=>{if(busy||/INPUT|SELECT|BUTTON|TEXTAREA/.test(e.target.tagName))return;if(e.code==='Space'){e.preventDefault();app.togglePause();}if(e.code==='ArrowRight'){e.preventDefault();app.step();}});
  const params=new URLSearchParams(location.search),presetId=params.get('preset'),example=Number(params.get('example'));
  if(presetId&&presets.some(p=>p.id===presetId)){draft=VRMJuggler.syncSequenceFromPreset(presetId);$('template').value=`preset:${presetId}`;}
  else if(params.has('example')&&examples[example]){draft=clone(examples[example]);$('template').value=`example:${example}`;}
  else{try{const saved=localStorage.getItem(storageKey);if(saved){const s=JSON.parse(saved);if(VRMJuggler.analyzeSyncSequence(s).documentOK)draft=s;}}catch{}}
  refreshTemplateStart();render();app.setSpeed(.5);app.setBodyMotion(0);app.setCameraView('close');
  async function applyBaseRoute(route,document){
    if(busy||!initialized)return;busy=true;refreshModeAction();
    planningAbort=new AbortController();$('route-cancel').hidden=false;
    const controls=[...$('route-builder').querySelectorAll('input,select,button')].filter(e=>e.id!=='route-cancel').map(e=>[e,e.disabled]);
    controls.forEach(([e])=>e.disabled=true);$('route-status').textContent='境目の投げと腕の運びを生成しています…';
    try{
      const result=await app.setSyncSequenceAsync(route.sequence,document.mirror,{directBoundaries:true,signal:planningAbort.signal,onProgress:message=>$('route-status').textContent=message});
      if(!result.ok)throw new Error(result.message||'動作を生成できませんでした。');
      const sequence=result.sequence,geometry=app.getSyncBoxReport(),skeleton=app.inspectSyncCycle();
      applied={sequence,analysis:result.analysis,mirror:document.mirror,labels:sequence.sets.flatMap(r=>Array(r.repeat).fill(r.sourceName||'受け渡し'))};
      replayApplied=null;previewKind='connect';$('preview-origin').textContent='つなぐモード / テンポを保って直接移行';
      $('playing-name').textContent=document.blocks.map(b=>({box:'Box','high-low':'High-Low',shower:'Shower',double:'Double Box'})[b.parts.base]).join(' → ');
      $('audit').dataset.report=JSON.stringify({name:sequence.name,analysis:result.analysis,geometry,skeleton,boundaries:route.boundaries,redirectedThrows:result.redirectedThrows});
      $('arm-playback-status').hidden=!!skeleton.skeletonOK;$('arm-playback-status').textContent='簡易再生：接触・姿勢の近似を許可中';$('arm-playback-status').title=ui.armPlaybackSummary(skeleton);showBallContact(geometry);
      $('timeline').replaceChildren();for(let i=0;i<result.analysis.movementSets;i++)$('timeline').append(button(String(i+1),()=>app.seekPhase(i*2*sequence.beatDuration/app.getMotionSnapshot().period),applied.labels[i]));
      $('route-status').textContent=`再生中：${route.requestedSets}セット${route.addedSets?`＋球の受け渡し ${route.addedSets}セット`:'・追加セットなし'}。1セット ${(document.beatDuration*2).toFixed(2)}秒。\n同じ球の配置まで ${result.analysis.identitySets}セット。${result.redirectedThrows}投を、次の技の投球位置へ合わせました。`;
      $('error').textContent='';app.setMotionPaths($('paths').checked);app.play();showProgram();refreshPreviewNotice();
    }catch(e){$('route-status').textContent=e.name==='AbortError'?'生成を中止しました。選択は保持しています。':e.message;}
    finally{planningAbort=null;controls.forEach(([e,disabled])=>e.disabled=disabled);$('route-cancel').hidden=true;busy=false;refreshModeAction();}
  }
  $('route-cancel').onclick=()=>planningAbort?.abort();
  routeBuilder=createSyncRouteBuilder({onPlay:applyBaseRoute,onChange:changed=>{refreshModeAction();if(changed&&previewKind==='connect'&&!busy){$('preview-difference').textContent='変更は「この並びを再生」で反映します。';$('preview-difference').hidden=false;}},isBusy:()=>busy||!initialized});
  switchMode(params.has('preset')||params.has('example')?'basic':'connect',false);
  function tick(){
    const s=app.getMotionSnapshot();
    if(!initialized&&s.modelReady){initialized=true;if(mode==='connect')routeBuilder.play();else apply();}
    $('phase').value=String(s.phase*1000);
    if(s.reusingSegments&&replayApplied){const index=Math.floor(s.phase*s.period/replayApplied.secondsPerSet)%replayApplied.sets;
      $('position').textContent=`接続セット ${index+1} / ${replayApplied.sets} · ${(s.phase*100).toFixed(0)}%`;
      $('current-section').textContent=replayApplied.segments[index].name;
      [...$('timeline').children].forEach((b,i)=>b.classList.toggle('active',i===index));
    }else if(applied){const index=Math.floor(s.phase*s.period/(2*applied.sequence.beatDuration))%applied.analysis.movementSets;$('position').textContent=`セット ${index+1} / ${applied.analysis.movementSets} · ${(s.phase*100).toFixed(0)}%`;
      $('current-section').textContent=applied.labels[index];
      [...$('timeline').children].forEach((b,i)=>b.classList.toggle('active',i===index));}
    requestAnimationFrame(tick);
  }
  tick();
})();
