// デモページの操作パネル。設定はこのブラウザに保存し、URL のパラメータ(リンクの共有)で上書きできる
//
// URL のパラメータ
//   ss=531            サイトスワップ
//   prop=club         小道具(ball / club / ring)
//   speed=0.5         再生速度
//   body=1.5          体の動きの大きさ(0 〜 2)
//   cam=side          カメラ(front / diagonal / side / close)
//   bg=transparent    背景を透明に(OBS などの配信ソフト向け)。bg=ffffff のように色も指定できる
//   ui=0              操作パネルを出さない
//   model=URL         読み込む VRM(相手のサーバーが読み込みを許可している必要がある)
(() => {
  const STORAGE_KEY = 'vrm-juggler:settings';
  const DEFAULTS = { ss: '3', prop: 'ball', speed: 1, body: 1, cam: 'front', collapsed: false };
  const BACKGROUND = ['#fbfbfd', '#dfe2ea'];
  const PROPS = ['ball', 'club', 'ring'];
  const VIEWS = ['front', 'diagonal', 'side', 'close'];

  const $ = (id) => document.getElementById(id);

  // ---- 設定の読み込み(保存した設定 → URL の順に上書き) ----

  const loadSaved = () => {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}') || {};
    } catch (e) {
      return {};
    }
  };

  const save = (settings) => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    } catch (e) {
      // プライベートモードなどで保存できない時はそのまま
    }
  };

  const params = new URLSearchParams(location.search);
  const number = (value) => (value === null || value === '' || !Number.isFinite(Number(value)) ? undefined : Number(value));
  const fromUrl = {
    ss: params.get('ss') || undefined,
    prop: PROPS.includes(params.get('prop')) ? params.get('prop') : undefined,
    speed: number(params.get('speed')),
    body: number(params.get('body')),
    cam: VIEWS.includes(params.get('cam')) ? params.get('cam') : undefined,
  };
  const settings = { ...DEFAULTS, ...loadSaved() };
  Object.entries(fromUrl).forEach(([key, value]) => {
    if (value !== undefined) settings[key] = value;
  });

  const bg = params.get('bg');
  const transparent = bg === 'transparent';
  const bgColor = bg && !transparent && /^#?[0-9a-f]{3}([0-9a-f]{3})?$/i.test(bg) ? '#' + bg.replace('#', '') : null;
  const showUi = params.get('ui') !== '0';
  const model = params.get('model') || undefined;

  if (transparent) document.documentElement.classList.add('transparent');
  if (!showUi) document.documentElement.classList.add('no-ui');

  // ---- ジャグラー ----

  // モデルを指定しなければ ./models/default.vrm を読み込む
  const juggler = new VRMJuggler('#vrm-juggler', model);
  window.juggler = juggler;
  // 背景も canvas に描く(録画にも入るように)
  juggler.setBackground(transparent ? null : bgColor || BACKGROUND);
  if (bgColor) document.body.style.background = bgColor;

  juggler.setProp(settings.prop);
  juggler.setSpeed(settings.speed);
  juggler.setBodyMotion(settings.body);
  juggler.setCameraView(settings.cam);
  juggler.setSiteswap(settings.ss);

  // ---- パネル ----

  const panel = $('panel');
  const presets = VRMJuggler.presets || [];

  const setPressed = (container, value) =>
    container.querySelectorAll('button').forEach((button) => {
      button.setAttribute('aria-pressed', String(button.dataset.value === value));
    });

  // パターン一覧(ボールの数ごと)
  const presetButtons = [];
  [...new Set(presets.map((p) => p.balls))].forEach((balls) => {
    const label = document.createElement('div');
    label.className = 'balls';
    label.textContent = `${balls} 個`;
    const chips = document.createElement('div');
    chips.className = 'chips';
    presets
      .filter((p) => p.balls === balls)
      .forEach((preset) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = preset.siteswap;
        button.dataset.value = preset.siteswap;
        button.title = `${preset.name}: ${preset.description}`;
        button.addEventListener('click', () => juggler.setSiteswap(preset.siteswap));
        chips.appendChild(button);
        presetButtons.push(button);
      });
    $('presets').append(label, chips);
  });

  const describe = (siteswap) => {
    const preset = presets.find((p) => p.siteswap === siteswap);
    const el = $('pattern-description');
    el.textContent = '';
    const title = document.createElement('strong');
    title.textContent = preset ? preset.name : siteswap;
    el.append(title, document.createElement('br'));
    el.append(preset ? preset.description : '入力したパターン');
  };

  const render = (state) => {
    if (document.activeElement !== $('siteswap')) $('siteswap').value = state.siteswap;
    presetButtons.forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.value === state.siteswap)));
    describe(state.siteswap);
    setPressed($('prop'), state.prop);
    setPressed($('camera'), state.camera);
    $('play').textContent = state.paused ? '▶ 再生' : '⏸ 一時停止';
    $('speed').value = state.speed;
    $('speed-value').textContent = `${state.speed.toFixed(2)}×`;
    $('body').value = state.bodyMotion;
    $('body-value').textContent = state.bodyMotion.toFixed(1);
    $('record').setAttribute('aria-pressed', String(state.recording));
    if (!state.recording) $('record').textContent = '● 録画';
  };

  const setCollapsed = (collapsed) => {
    panel.classList.toggle('collapsed', collapsed);
    $('collapse').setAttribute('aria-expanded', String(!collapsed));
    $('collapse').title = collapsed ? 'パネルを開く' : 'パネルをたたむ';
  };
  setCollapsed(settings.collapsed);

  const container = $('vrm-juggler');
  container.addEventListener('statechange', (e) => {
    const state = e.detail;
    render(state);
    settings.ss = state.siteswap;
    settings.prop = state.prop;
    settings.speed = state.speed;
    settings.body = state.bodyMotion;
    if (state.camera !== 'free') settings.cam = state.camera;
    save(settings);
  });
  render(juggler.getState());

  $('siteswap-form').addEventListener('submit', (e) => {
    e.preventDefault();
    $('siteswap').blur();
    juggler.setSiteswap($('siteswap').value);
  });

  $('prop').addEventListener('click', (e) => {
    const value = e.target.closest('button')?.dataset.value;
    if (value) juggler.setProp(value);
  });

  $('camera').addEventListener('click', (e) => {
    const value = e.target.closest('button')?.dataset.value;
    if (value) juggler.setCameraView(value);
  });

  $('play').addEventListener('click', () => juggler.togglePause());
  $('step').addEventListener('click', () => juggler.step());
  $('speed').addEventListener('input', (e) => juggler.setSpeed(Number(e.target.value)));
  $('body').addEventListener('input', (e) => juggler.setBodyMotion(Number(e.target.value)));

  $('collapse').addEventListener('click', () => {
    settings.collapsed = !panel.classList.contains('collapsed');
    setCollapsed(settings.collapsed);
    save(settings);
  });

  let objectURL;
  $('vrm-file').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (objectURL) URL.revokeObjectURL(objectURL);
    objectURL = URL.createObjectURL(file);
    juggler.loadModel(objectURL);
    e.target.value = '';
  });

  // ---- お知らせ ----

  let toastTimer;
  const toast = (text) => {
    const el = $('toast');
    el.textContent = text;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 2400);
  };

  // ---- リンクの共有 ----

  const shareUrl = () => {
    const state = juggler.getState();
    const query = new URLSearchParams();
    query.set('ss', state.siteswap);
    if (state.prop !== DEFAULTS.prop) query.set('prop', state.prop);
    if (state.speed !== DEFAULTS.speed) query.set('speed', String(Math.round(state.speed * 100) / 100));
    if (state.bodyMotion !== DEFAULTS.body) query.set('body', String(Math.round(state.bodyMotion * 10) / 10));
    if (state.camera !== 'free' && state.camera !== DEFAULTS.cam) query.set('cam', state.camera);
    ['bg', 'ui', 'model'].forEach((key) => params.has(key) && query.set(key, params.get(key)));
    return `${location.origin}${location.pathname}?${query.toString().replace(/%2C/g, ',')}`;
  };

  $('share').addEventListener('click', async () => {
    const url = shareUrl();
    try {
      await navigator.clipboard.writeText(url);
      toast('リンクをコピーしました');
    } catch (e) {
      window.prompt('このリンクをコピーしてください', url);
    }
  });

  // ---- 録画 ----

  let recordStart = 0;
  let recordTimer;
  $('record').addEventListener('click', async () => {
    if (juggler.getState().recording) {
      clearInterval(recordTimer);
      const blob = await juggler.stopRecording();
      if (!blob || blob.size === 0) return toast('録画できませんでした');
      const extension = blob.type.includes('mp4') ? 'mp4' : 'webm';
      const name = juggler.getState().siteswap.replace(/[^0-9a-zA-Z]+/g, '_');
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = `vrm-juggler-${name}.${extension}`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(link.href), 10000);
      toast('動画を保存しました');
      return;
    }
    if (!juggler.startRecording()) return toast('このブラウザでは録画できません');
    if (transparent) toast('背景が透明なので、動画の背景は黒くなることがあります');
    recordStart = performance.now();
    const tick = () => {
      const seconds = Math.floor((performance.now() - recordStart) / 1000);
      $('record').textContent = `■ 停止 ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
    };
    tick();
    recordTimer = setInterval(tick, 500);
  });

  // ---- キーボード ----

  document.addEventListener('keydown', (e) => {
    const target = e.target;
    if (target instanceof HTMLElement && (target.closest('input, textarea, select') || target.isContentEditable)) return;
    if (e.key === ' ') {
      // ボタンにフォーカスがあっても、そのボタンを押さずに一時停止する
      e.preventDefault();
      if (target instanceof HTMLElement && target.closest('button')) target.blur();
      juggler.togglePause();
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      juggler.step();
    }
  });
})();
