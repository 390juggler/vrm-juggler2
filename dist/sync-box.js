(() => {
  const $ = id => document.getElementById(id);
  const app = new VRMJuggler('#stage');
  // Public handle makes it possible to inspect the same running animation used by the controls.
  window.syncBoxApp = app;
  const presets = VRMJuggler.syncBoxPresets;
  let current = presets[0];
  let reportKey = '';
  let loadingModel = false;
  let batchRunning = false;
  let selection = 0;
  const styles=[['normal','Normal / 下→下'],['shuffle','Shuffle / 上→下'],['reverse','Reverse / 下→上'],['inverted','Inverted / 上→上'],['vertical-up','縦2x / 上投げ'],['vertical-down','縦2x / 下投げ']];
  const lanes=[['center','Center（2本の縦軌道の間）'],['outside','Inside（投げ手と同じ側の外側）'],['cross-side','Outside（投げ手と反対側の外側）']];
  const relations=[['free','指定なし'],['underarm','反対の腕の下']];
  const routes=[['auto','動作に合わせる'],['direct','直接運ぶ'],['outside','外側を回る'],['inside','内側を回る'],['front','前を回る'],['back','奥を回る']];
  const addSelect=(parent,id,label,items)=>{
    const l=document.createElement('label'),s=document.createElement('select'); l.textContent=label;s.id=id;
    items.forEach(([v,n])=>s.add(new Option(n,v)));l.append(s);parent.append(l);
  };
  ['outward','returning'].forEach((id,i)=>{
    const f=document.createElement('fieldset'),legend=document.createElement('legend');legend.textContent=i?'戻りの2x':'片方向の2x';f.append(legend);
    addSelect(f,id,'投げる高さ → 捕る高さ',styles);
    addSelect(f,id+'-lane','縦2xが通る場所',lanes);
    const lateral=document.createElement('label');lateral.innerHTML=`<input id="${id}-lateral" type="checkbox">投げ・捕りの左右を反転（Lateral）`;f.append(lateral);
    addSelect(f,id+'-release','投げるときの腕との関係',relations);
    addSelect(f,id+'-catch','捕るときの腕との関係',relations);
    addSelect(f,id+'-carry','捕ってから次の投げへ',routes);
    $('motion-editors').append(f);
  });
  function fillEditor(config) {
    $('columns').value=config.columns==='crossed'?'switched':config.columns;
    $('arm-order').value=config.armOrder || (config.columns==='crossed'?'left-over':'none');
    $('arrangement').value=config.arrangement || 'columns';
    $('rise').value=String(Math.round((config.columnRise || .3893)*100));
    $('rise-value').textContent=$('rise').value+' cm';
    ['outward','returning'].forEach((id,i)=>{
      const m=config.shortMotions?.[i%config.shortMotions.length] || {};
      $(id).value=config.short[i%config.short.length];$(id+'-lane').value=m.lane || 'center';
      $(id+'-lateral').checked=!!m.lateral;$(id+'-release').value=m.releaseRelation || 'free';
      $(id+'-catch').value=m.catchRelation || 'free';$(id+'-carry').value=m.carry || 'auto';
      $(id+'-lane').disabled=!$(id).value.startsWith('vertical-');
    });
  }
  function showProgram() {
    const p=app.getSyncProgram();if(!p)return;
    $('program-steps').replaceChildren();$('program').dataset.program=JSON.stringify(p);
    p.flights.forEach((f,i)=>{
      const row=document.createElement('div'),heading=document.createElement('p');row.className='motion-step';
      heading.textContent=`${i+1}. ${f.value===4?'4':'2x'} / ${f.hand===0?'左':'右'}手 → ${f.catchHand===0?'左':'右'}手`;row.append(heading);
      const stages=[['投げる',f.release],['通る',f.passage],['捕る',f.catch]];
      if(f.carry) stages.push(['次の投げへ',{time:(f.carry.from+f.carry.duration)%p.period,position:f.carry.end}]);
      stages.forEach(([name,stage])=>{
        const button=document.createElement('button');button.textContent=name;
        button.title=`${stage.time.toFixed(3)}秒 / 座標 ${stage.position.map(n=>(n*100).toFixed(0)).join(', ')} cm${stage.relation==='underarm'?' / 腕の下':''}`;
        button.onclick=()=>app.seekPhase(stage.time/p.period);row.append(button);
      });$('program-steps').append(row);
    });
  }
  function clearSkeletonReport() {
    $('skeleton-status').textContent = '';
    $('skeleton-status').removeAttribute('data-report');
    $('skeleton-values').replaceChildren();
  }
  for (const p of presets) $('pattern').add(new Option(p.name, p.id));
  function select(config) {
    const result = app.setSyncBox({ ...config, mirror: $('mirror').checked });
    if (!result.ok) { $('error').textContent = result.message; $('pattern').value=current.id; $('mirror').checked=!!current.mirror; return; }
    current = {...config,mirror:$('mirror').checked};
    selection++;
    fillEditor(config);
    showProgram();
    reportKey = '';
    clearSkeletonReport();
    $('error').textContent = '';
    $('description').textContent = config.description;
    $('siteswap').textContent = config.siteswap;
    $('kind').textContent = config.experimental ? '組合せ候補' : '参照名あり';
    $('source').hidden = !config.source;
    if (config.source) $('source').href = config.source;
    app.setMotionPaths($('paths').checked);
    app.play();
    const url = new URL(location.href);
    if (presets.some(p => p.id === config.id)) url.searchParams.set('pattern', config.id);
    else {url.searchParams.set('pattern','custom');url.searchParams.set('motion',JSON.stringify(config));}
    if(config.id!=='custom') url.searchParams.delete('motion');
    history.replaceState(null, '', url);
  }
  $('pattern').onchange = () => select(presets.find(p => p.id === $('pattern').value));
  $('play').onclick = () => app.togglePause();
  $('step').onclick = () => app.step();
  $('reset').onclick = () => app.seekPhase(0);
  $('speed').oninput = () => { app.setSpeed(Number($('speed').value)); $('speed-value').textContent = Number($('speed').value).toFixed(2) + '×'; };
  $('phase').oninput = () => app.seekPhase(Number($('phase').value) / 1000);
  $('paths').onchange = () => app.setMotionPaths($('paths').checked);
  // Larger balls are for appearance only; clearance checks keep the real size.
  const largeBallsKey = 'vrm-sync-large-balls';
  try { $('large-balls').checked = localStorage.getItem(largeBallsKey) === '1'; } catch {}
  app.setLargeSyncBalls($('large-balls').checked);
  $('large-balls').onchange = () => { app.setLargeSyncBalls($('large-balls').checked); try { localStorage.setItem(largeBallsKey, $('large-balls').checked ? '1' : '0'); } catch {} };
  $('mirror').onchange = () => select(current);
  $('inspect').onclick = () => {
    const r = app.inspectSyncCycle();
    if (!r) return;
    const issues = [];
    if (r.maxGripError >= 0.012) issues.push('手と球のずれ');
    if (r.minArmDistance <= 0.065 || r.minBallArmDistance <= 0.065) issues.push('腕の間隔');
    if (r.maxElbowSpeed >= 12 || r.maxJointAngularSpeed >= 90 || !r.plannedCycle) issues.push('肘・前腕の動きのつながり');
    if (!r.postureOK) issues.push('胴体への侵入・肘と手首の曲がり');
    $('skeleton-status').textContent = r.skeletonOK && r.plannedCycle ? '接続・間隔・姿勢の制約・周期：確認OK' : issues.join('、') + 'に要確認';
    $('skeleton-status').dataset.report = JSON.stringify(r);
    const entries = [['手と球の最大ずれ',(r.maxGripError*100).toFixed(2)+' cm'],['腕の骨同士の最小間隔',(r.minArmDistance*100).toFixed(1)+' cm'],['球中心と腕の骨の最小間隔',(r.minBallArmDistance*100).toFixed(1)+' cm'],['肘の最大速度（1倍速）',r.maxElbowSpeed.toFixed(1)+' m/s'],['胴体・肘・手首の制約',r.postureOK?'範囲内':'要確認']];
    $('skeleton-values').replaceChildren(...entries.flatMap(([key,value])=> { const dt=document.createElement('dt'),dd=document.createElement('dd'); dt.textContent=key; dd.textContent=value; return [dt,dd]; }));
  };
  $('views').onclick = event => { if (event.target.dataset.view) app.setCameraView(event.target.dataset.view); };
  $('apply').onclick = () => {
    const shortMotions=['outward','returning'].map(id=>({lane:$(id+'-lane').value,lateral:$(id+'-lateral').checked,
      releaseRelation:$(id+'-release').value,catchRelation:$(id+'-catch').value,carry:$(id+'-carry').value==='auto'?undefined:$(id+'-carry').value}));
    const requested={ ...current, columnMotion:undefined,id:'custom', name:'動作の組合せ',columns:$('arm-order').value==='none'?$('columns').value:'crossed',armOrder:$('arm-order').value,
      arrangement:$('arrangement').value,columnRise:Number($('rise').value)/100,short:[$('outward').value,$('returning').value],shortMotions,
      description:'投げ・通過・捕り・次の投げへの運びを指定した組合せ。',source:undefined,experimental:true };
    const key=c=>JSON.stringify({siteswap:c.siteswap,columns:c.columns,arm:c.armOrder || (c.columns==='crossed'?'left-over':'none'),arrangement:c.arrangement||'columns',
      short:[0,1].map(i=>c.short[i%c.short.length]),moves:[0,1].map(i=>{const m=c.shortMotions?.[i%c.shortMotions.length]||{};return [m.lane||'center',!!m.lateral,m.releaseRelation||'free',m.catchRelation||'free',m.carry||'auto'];})});
    const match=presets.find(p=>key(p)===key(requested));
    select(match?{...structuredClone(match),id:'custom',name:requested.name,columnRise:requested.columnRise,description:requested.description,source:undefined,experimental:true}:requested);
    if(current.id==='custom') $('pattern').selectedIndex=-1;
  };
  $('rise').oninput=()=>$('rise-value').textContent=$('rise').value+' cm';
  $('arm-order').onchange=()=>{if($('arm-order').value!=='none')$('columns').value='switched';};
  $('columns').onchange=()=>{if($('columns').value!=='switched')$('arm-order').value='none';};
  ['outward','returning'].forEach(id=>$(id).onchange=()=>$(id+'-lane').disabled=!$(id).value.startsWith('vertical-'));
  $('inspect-all').onclick=async()=>{
    if(batchRunning)return;
    batchRunning=true;
    const saved=current,mirror=$('mirror').checked,phase=app.getMotionSnapshot().phase;
    const controls=[...document.querySelectorAll('aside button,aside input,aside select')];
    const disabled=controls.map(c=>c.disabled);controls.forEach(c=>c.disabled=true);
    const results=[];$('batch-download').hidden=true;app.pause();
    try {
      for(const config of presets) for(const reflected of [false,true]) {
        $('batch-status').textContent=`検査中 ${results.length+1}/${presets.length*2}：${config.name}${reflected?'（反転）':''}`;
        await new Promise(resolve=>requestAnimationFrame(resolve));
        const result=app.setSyncBox({...config,mirror:reflected});
        results.push({id:config.id,mirror:reflected,geometry:app.getSyncBoxReport(),skeleton:result.ok?app.inspectSyncCycle():null,error:result.ok?undefined:result.message});
        $('batch-status').dataset.report=JSON.stringify(results);
      }
      const bad=results.filter(r=>r.error || !r.geometry?.geometryOK || !r.skeleton?.skeletonOK);
      $('batch-status').textContent=`${results.length}件の検査完了、要確認 ${bad.length}件${bad.length?'：'+[...new Set(bad.map(r=>r.id))].join('、'):''}`;
      const link=$('batch-download');if(link.href.startsWith('blob:'))URL.revokeObjectURL(link.href);
      link.href=URL.createObjectURL(new Blob([JSON.stringify(results,null,2)],{type:'application/json'}));link.hidden=false;
    } catch(error) {$('batch-status').textContent='検査中にエラー：'+error.message;}
    finally {batchRunning=false;controls.forEach((c,i)=>c.disabled=disabled[i]);$('mirror').checked=mirror;select(saved);app.seekPhase(phase);}
  };
  $('model').onchange = async () => {
    const file = $('model').files[0];
    if (!file) return;
    const url = URL.createObjectURL(file);
    loadingModel = true;
    $('inspect').disabled = true;
    clearSkeletonReport();
    try { await app.loadModel(url); reportKey = ''; }
    finally { loadingModel = false; URL.revokeObjectURL(url); }
  };
  document.addEventListener('keydown', event => {
    if (/INPUT|SELECT|BUTTON|TEXTAREA/.test(event.target.tagName)) return;
    if (event.code === 'Space') { event.preventDefault(); app.togglePause(); }
    if (event.code === 'ArrowRight') { event.preventDefault(); app.step(); }
  });
  $('stage').addEventListener('statechange', event => { $('play').textContent = event.detail.paused ? '再生' : '一時停止'; });
  function tick() {
    const snapshot = app.getMotionSnapshot();
    $('inspect').disabled = batchRunning || loadingModel || !snapshot.modelReady;
    $('phase').value = String(snapshot.phase * 1000);
    $('phase-value').textContent = (snapshot.phase * 100).toFixed(1) + '%';
    if (snapshot.modelReady && !loadingModel) {
      const key = selection + ':' + $('mirror').checked;
      if (reportKey !== key) {
        const report = app.getSyncBoxReport();
        if (report) {
          $('audit-status').textContent = report.geometryOK ? '3球・球間隔・手の到達範囲：確認OK' : '干渉または到達範囲に要確認の箇所があります';
          $('audit-status').dataset.report = JSON.stringify(report);
          const entries = [['球の数',String(report.balls)],['球表面の最小間隔',(report.ballClearance*100).toFixed(1)+' cm'],['手の最小間隔',(report.minHandDistance*100).toFixed(1)+' cm'],['手首の到達範囲使用率',(report.maxReachRatio*100).toFixed(0)+'%'],['球の最高点（床から）',(report.peakY*100).toFixed(0)+' cm'],['1周期',report.period.toFixed(2)+' 秒']];
          $('audit-values').replaceChildren(...entries.flatMap(([key,value]) => { const dt=document.createElement('dt'),dd=document.createElement('dd'); dt.textContent=key; dd.textContent=value; return [dt,dd]; }));
          reportKey = key;
        }
      }
    }
    requestAnimationFrame(tick);
  }
  const params=new URLSearchParams(location.search);
  let initial = presets.find(p => p.id === params.get('pattern')) || presets[0];
  if(params.get('pattern')==='custom' && params.has('motion')) {try {initial={...JSON.parse(params.get('motion')),id:'custom'};} catch {} }
  $('pattern').value = initial.id;
  select(initial);
  app.setSpeed(0.5);
  app.setBodyMotion(0);
  app.setCameraView('close');
  tick();
})();
