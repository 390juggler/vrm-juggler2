/* The recipe is saved separately from generated boundary throws. */
globalThis.createSyncRouteBuilder=({onPlay,onChange,isBusy})=>{
  const $=id=>document.getElementById(id),clone=structuredClone,key='vrm-sync-base-route-v1';
  const names={box:'Box','high-low':'High-Low',shower:'Shower',double:'Double Box'};
  const columns={normal:'Normal',switched:'Switched',crossed:'Cross 左上','crossed-right':'Cross 右上','crossed-alternate':'Cross 上下交代',underarm:'Underarm'};
  const defaults={base:'box',columns:'normal',passes:['normal','normal'],highHand:0,alternateHigh:true,swap:'alternate',highPath:'vertical'};
  let doc={kind:'sync-base-route',version:1,beatDuration:.205,mirror:false,blocks:[{parts:clone(defaults),repeats:1}]},selected=0;
  try{const saved=JSON.parse(localStorage.getItem(key));VRMJuggler.compileSyncBaseRoute(saved);doc=saved;}catch{}
  const el=(tag,text)=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=text;return e;};
  const button=(text,fn)=>{const b=el('button',text);b.type='button';b.onclick=fn;return b;};
  const descriptions={box:'左右のコラムと、左・右それぞれの2xを組み合わせます。2セットが基本です。',
    'high-low':'ハイ＋2x → 両手の2xスワップを繰り返します。ハイの左右と、スワップの上下は別々に指定します。',
    shower:'2xの到着位置から高い球を投げ、2xを投げる位置へ戻します。Lateralも同じ位置関係で組みます。',
    double:'4セットの2xを1つずつ選びます。高い球は全て縦にするか、手を替える4xでShowerの軌道を使います。'};
  function persist(){try{localStorage.setItem(key,JSON.stringify(doc));}catch{};onChange?.(true);}
  function summary(){try{const r=VRMJuggler.compileSyncBaseRoute(doc);return `${doc.blocks.length}技・${r.requestedSets}セット${r.addedSets?`＋受け渡し${r.addedSets}セット`:'・追加セットなし'}`;}catch(e){return e.message;}}
  function update(){
    const p=doc.blocks[selected].parts;
    $('route-base').value=p.base;$('route-columns').value=p.columns;$('route-high-hand').value=String(p.highHand);
    $('route-alternate').value=String(p.alternateHigh);$('route-swap').value=p.swap;$('route-high-path').value=p.highPath;
    $('route-repeats').value=String(doc.blocks[selected].repeats);$('route-tempo').value=String(doc.beatDuration*2);$('route-mirror').checked=doc.mirror;
    $('route-columns-label').hidden=!['box','high-low'].includes(p.base);
    $('route-high-settings').hidden=!['high-low','shower'].includes(p.base);
    $('route-alternate-label').hidden=p.base!=='high-low';$('route-swap-label').hidden=p.base!=='high-low';$('route-high-path-label').hidden=p.base!=='double';
    $('route-definition').textContent=descriptions[p.base];$('route-edit-heading').textContent=`${selected+1}番目の技を編集`;
    $('route-passes').replaceChildren();p.passes.forEach((value,i)=>{
      const label=el('label',p.base==='box'?`${i?'右':'左'}手の2x`:p.base==='double'?`セット${i+1}の2x`:'ハイと同時に投げる2x'),select=el('select');
      select.setAttribute('aria-label',label.textContent);let group;
      for(const choice of SyncComposeUI.shortChoices){if(group?.label!==choice.group){group=el('optgroup');group.label=choice.group;select.append(group);}group.append(new Option(choice.name,choice.id));}
      select.value=value;const hint=el('small',SyncComposeUI.shortChoices.find(c=>c.id===value)?.hint);
      select.onchange=()=>{p.passes[i]=select.value;persist();update();};label.append(select,hint);$('route-passes').append(label);
    });
    $('route-blocks').replaceChildren();doc.blocks.forEach((b,i)=>{
      const li=el('li');li.className=i===selected?'selected':'';
      const pick=button(`${i+1}. ${names[b.parts.base]} × ${b.repeats}`,()=>{selected=i;update();});pick.setAttribute('aria-pressed',String(i===selected));
      const p=b.parts,layout=['box','high-low'].includes(p.base)?columns[p.columns]:p.base==='double'?(p.highPath==='vertical'?'全コラム縦':'Showerを挟む'):p.highHand?'ハイ右手':'ハイ左手';
      const detail=el('small',layout+' · '+p.passes.map(id=>SyncComposeUI.shortChoices.find(c=>c.id===id)?.name).join(' / '));
      if(p.base==='high-low')detail.textContent+=` · ハイ${p.alternateHigh?'左右交代':p.highHand?'右固定':'左固定'} · スワップ${p.swap==='alternate'?'上下交代':p.swap==='left-over'?'左上':'右上'}`;
      const up=button('↑',()=>{[doc.blocks[i-1],doc.blocks[i]]=[doc.blocks[i],doc.blocks[i-1]];selected=i-1;persist();update();});up.disabled=i===0;up.setAttribute('aria-label',`${i+1}番目の技を前へ`);
      const remove=button('削除',()=>{doc.blocks.splice(i,1);selected=Math.min(selected,doc.blocks.length-1);persist();update();});remove.disabled=doc.blocks.length===1;
      li.append(pick,up,remove,detail);$('route-blocks').append(li);
    });
    $('route-summary').textContent=summary();$('route-add').disabled=doc.blocks.length>=16;onChange?.(false);
  }
  $('route-base').onchange=()=>{const p=doc.blocks[selected].parts;p.base=$('route-base').value;
    p.passes=Array.from({length:p.base==='box'?2:p.base==='double'?4:1},(_,i)=>p.passes[i]||p.passes[0]||'normal');persist();update();};
  for(const [id,prop,convert] of [['columns','columns',String],['high-hand','highHand',Number],['alternate','alternateHigh',v=>v==='true'],['swap','swap',String],['high-path','highPath',String]])
    $('route-'+id).onchange=()=>{doc.blocks[selected].parts[prop]=convert($('route-'+id).value);persist();update();};
  $('route-repeats').onchange=()=>{if(!$('route-repeats').reportValidity())return;doc.blocks[selected].repeats=Number($('route-repeats').value);persist();update();};
  $('route-tempo').onchange=()=>{if(!$('route-tempo').reportValidity())return;doc.beatDuration=Number($('route-tempo').value)/2;persist();update();};
  $('route-mirror').onchange=()=>{doc.mirror=$('route-mirror').checked;persist();};
  $('route-add').onclick=()=>{doc.blocks.push(clone(doc.blocks[selected]));selected=doc.blocks.length-1;persist();update();};
  $('route-save').onclick=()=>{const url=URL.createObjectURL(new Blob([JSON.stringify(doc,null,2)],{type:'application/json'})),a=el('a');a.href=url;a.download='juggling-route.json';a.click();URL.revokeObjectURL(url);};
  $('route-load').onchange=async()=>{try{const next=JSON.parse(await $('route-load').files[0].text());VRMJuggler.compileSyncBaseRoute(next);doc=next;selected=0;persist();update();$('route-status').textContent='読み込みました。「この並びを再生」で反映します。';}catch(e){$('route-status').textContent=e.message;}finally{$('route-load').value='';}};
  async function play(){if(isBusy())return;try{const r=VRMJuggler.compileSyncBaseRoute(doc);persist();await onPlay(r,clone(doc));}catch(e){$('route-status').textContent=e.message;}}
  update();return {play,summary};
};
