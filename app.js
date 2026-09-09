// 辩论赛计时器 · 应用主控(设置/投屏 + 音频 + 全屏 + 主循环)
// 投屏只有一面 #screen-timing:按当前环节类型呈现三种形态之一——
//   计时环节:辩题/队名 + 环节名 + 双方时钟(可换边/暂停);
//   图文环节:全屏该环节自带的整幅图(无图回退内置底色);
//   文字环节:计时页全局背景 + 居中多行文字。
// 封面/结束 不再是独立屏,只是排进环节链的首/末图文行,由「上一环/下一环」推进。
(function (root) {
  'use strict';
  const Engine = root.DebateEngine;
  const P = root.Presets;
  const DT = root.DT;
  const $ = (id) => document.getElementById(id);
  const SIDE_LABEL = { aff: '正方', neg: '反方' };
  const toast = (msg) => {
    const t = $('toast');
    t.textContent = msg; t.classList.remove('hidden');
    clearTimeout(toast._h); toast._h = setTimeout(() => t.classList.add('hidden'), 2600);
  };

  // ---------- 音频(WebAudio,免素材;首个用户手势解锁) ----------
  const Sound = (() => {
    let ctx = null, enabled = true;
    function ensure() {
      if (!ctx) { try { ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { return null; } }
      if (ctx.state === 'suspended') ctx.resume();
      return ctx;
    }
    function tone(c, t, freq, dur, vol) {
      const o = c.createOscillator(), g = c.createGain();
      o.type = 'sine'; o.frequency.value = freq;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(vol || 0.4, t + 0.015);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g); g.connect(c.destination); o.start(t); o.stop(t + dur + 0.03);
    }
    function beep(freq, n, dur, gap) {
      if (!enabled) return;
      const c = ensure(); if (!c) return;
      const t0 = c.currentTime;
      for (let i = 0; i < n; i++) tone(c, t0 + i * (dur + gap), freq, dur);
    }
    return {
      ensure,
      warn() { beep(880, 2, 0.14, 0.1); },
      end() { beep(1320, 3, 0.24, 0.12); },
      test() { beep(880, 1, 0.15, 0.05); setTimeout(() => beep(1320, 2, 0.2, 0.1), 380); },
      setEnabled(v) { enabled = !!v; },
      isEnabled() { return enabled; },
    };
  })();

  const msText = (ms) => {
    const s = Math.max(0, Math.ceil(ms / 1000));
    return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
  };

  // ---------- 全局右下角操作栏(悬停展开) ----------
  // content=true 时环节是图文/文字页:主按钮=「下一环节」,无「时间」组(没有钟可动)
  const Ops = (() => {
    let root = null, primaryEl = null;
    const getRoot = () => { if (!root) root = document.getElementById('ops-root'); return root; };
    const panel = (label, items) => '<div class="og"><div class="og-t">' + label + '</div>' +
      items.map((b) => '<button class="og-btn' + (b.d ? ' danger' : '') + '" data-act="' + b.a + '">' + b.l + '</button>').join('') + '</div>';

    function build(content) {
      const r = getRoot();
      const groups = content ? [
          panel('环节', [{ a: 'prev', l: '上一环节' }, { a: 'next', l: '下一环节' }]),
          panel('画面', [{ a: 'full', l: '全屏' }, { a: 'test', l: '试音' }, { a: 'exit', l: '返回设置' }]),
        ] : [
          panel('环节', [{ a: 'prev', l: '上一环节' }, { a: 'next', l: '下一环节' }]),
          panel('时间', [{ a: 'resetStage', l: '重置本环节' }, { a: 'resetAll', l: '全场重置', d: 1 }]),
          panel('画面', [{ a: 'full', l: '全屏' }, { a: 'test', l: '试音' }, { a: 'exit', l: '返回设置' }]),
        ];
      const primaryAct = content ? 'next' : 'toggle';
      const primaryLabel = content ? '下一环节' : '开始';
      r.innerHTML = '<div class="ops"><div class="ops-panel">' + groups.join('') + '</div>' +
        '<div class="ops-bar"><button class="btn-start dock-main" data-act="' + primaryAct + '">' + primaryLabel + '</button>' +
        '<button class="ops-dot" data-act="more" title="固定/收起">⋯</button></div></div>';
      primaryEl = r.querySelector('.dock-main');
      r.classList.remove('hidden');
    }
    function hide() { const r = getRoot(); if (r) r.classList.add('hidden'); }
    function primaryText(t) { if (primaryEl) primaryEl.textContent = t; }
    return { build, hide, primaryText };
  })();

  // ---------- 投屏外观应用(把 dt.appearance 落到真实 DOM) ----------
  // 铁律:默认外观不加类、不写 inline,视觉与改动前逐像素一致。
  // 计时环节与纯文字环节都显示页头 → 都套用外观;图文环节整幅图、无页头,不套。
  const TGT_IDS = {
    topic: ['t-topic'], teams: ['name-aff', 'name-neg'],
    stage: ['t-stage'], time: ['time-aff', 'time-neg'], state: ['state-aff', 'state-neg'],
  };
  const textIds = () => Object.keys(TGT_IDS).reduce((a, k) => a.concat(TGT_IDS[k]), []);
  const clampNum = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const hasBox = (el) => { if (!el) return false; const st = getComputedStyle(el); if (st.display === 'none') return false; const r = el.getBoundingClientRect(); return r.width > 2 && r.height > 2; };
  const clearProps = (el, props) => { if (el) props.forEach((p) => { el.style[p] = ''; }); };

  function resetAppearanceLayout(scr) {
    scr.classList.remove('userpos');
    const head = scr.querySelector('.t-head'); if (head) head.style.display = '';
    clearProps($('t-topic'), ['position', 'top', 'left', 'right', 'transform', 'textAlign', 'paddingLeft', 'paddingRight']);
    clearProps(scr.querySelector('.t-teams'), ['position', 'top', 'left', 'right', 'transform', 'textAlign', 'paddingLeft', 'paddingRight']);
    textIds().forEach((id) => { const el = $(id); if (el) { el.style.fontSize = ''; el.style.color = ''; el.style.textShadow = ''; } });
  }

  // 中央时钟带 = #t-stage + 可见数字的包围盒,上下各让 margin
  function clockBand(scr) {
    const sr = scr.getBoundingClientRect();
    let top = Infinity, bot = -Infinity;
    ['t-stage', 'time-aff', 'time-neg'].forEach((id) => {
      const el = $(id); if (!hasBox(el)) return;
      const r = el.getBoundingClientRect();
      top = Math.min(top, r.top); bot = Math.max(bot, r.bottom);
    });
    if (!isFinite(top)) return { low: 34, high: 56 };   // 兜底(理论上不会走到)
    const h = sr.height || 1;
    const margin = Math.max(2, (bot - top) * 0.06) / h * 100;
    return {
      low: clampNum((top - sr.top) / h * 100 - margin, 0, 48),
      high: clampNum((bot - sr.top) / h * 100 + margin, 50, 100),
    };
  }

  function styleMoved(el, y, align) {
    if (!el) return;
    el.style.position = 'absolute';
    el.style.left = '0'; el.style.right = '0';
    el.style.top = clampNum(y, 0, 100) + '%';
    el.style.transform = 'translateY(-50%)';
    el.style.textAlign = align;
    el.style.paddingLeft = align === 'left' ? '6%' : '';
    el.style.paddingRight = align === 'right' ? '6%' : '';
  }

  function applyAppearance() {
    const scr = $('screen-timing');
    if (!scr) return;
    resetAppearanceLayout(scr);      // 先还原默认,每次都从原始流式布局重新量测
    if (scr.classList.contains('content-img')) return;    // 图文环节整幅图、无页头,不套外观
    const ap = (root.DT && root.DT.appearanceStore) ? root.DT.appearanceStore.get() : Appearance.normalize(null);
    if (Appearance.isDefault(ap)) return;

    // 1) 颜色 / 字号 / 投影
    Object.keys(TGT_IDS).forEach((g) => {
      const s = ap.style[g];
      const fs = s.size !== 1 ? (Appearance.fontCss(g, s.size) || '') : '';
      const col = s.color !== Appearance.DEFAULT_COLOR ? s.color : '';
      TGT_IDS[g].forEach((id) => { const el = $(id); if (el) { el.style.fontSize = fs; el.style.color = col; } });
    });
    const sh = ap.shadow ? '' : 'none';
    textIds().forEach((id) => { const el = $(id); if (el) el.style.textShadow = sh; });

    // 仅当用户真改了位置才启用自定义布局;只改颜色/字号时保持原流式排版
    if (!Appearance.userPosActive(ap)) return;

    // 2) 位置:先量测当前(默认)流式中心,再套用户位置。
    //    计时环节有中央时钟带要避让 → 用 clockBand 钳制;
    //    纯文字环节没有时钟,直接原样保留用户存的位置(顶部/底部都照搬)。
    const centerPct = (el) => { const r = el.getBoundingClientRect(); const sr = scr.getBoundingClientRect(); return (r.top + r.height / 2 - sr.top) / (sr.height || 1) * 100; };
    const topicM = hasBox($('t-topic')) ? centerPct($('t-topic')) : 8;
    const teamsM = hasBox(scr.querySelector('.t-teams')) ? centerPct(scr.querySelector('.t-teams')) : 20;
    const textStage = scr.classList.contains('content-text');
    let topicY, teamsY;
    if (textStage) {
      topicY = ap.pos.topic ? ap.pos.topic.y : topicM;
      teamsY = ap.pos.teams ? ap.pos.teams.y : teamsM;
    } else {
      const band = clockBand(scr);
      topicY = Appearance.clampY(ap.pos.topic ? ap.pos.topic.y : topicM, band.low, band.high);
      teamsY = Appearance.clampY(ap.pos.teams ? ap.pos.teams.y : teamsM, band.low, band.high);
    }
    const align = ap.pos.topic ? ap.pos.topic.align : 'center';

    scr.classList.add('userpos');
    const head = scr.querySelector('.t-head'); if (head) head.style.display = 'contents';
    styleMoved($('t-topic'), topicY, align);
    styleMoved(scr.querySelector('.t-teams'), teamsY, 'center');
  }

  let appearScheduled = false;
  function scheduleAppearance() {
    if (appearScheduled) return;
    appearScheduled = true;
    requestAnimationFrame(() => { appearScheduled = false; applyAppearance(); });
  }

  // ---------- 应用状态 ----------
  const App = {
    matchFmt: null,   // 本场赛制副本
    g: null,          // engine 状态
    sess: null,       // 本场比赛信息快照

    showScreen(name) {
      document.querySelectorAll('.screen').forEach((s) => s.classList.remove('active'));
      $('screen-' + name).classList.add('active');
    },

    // 当前环节所用背景:图文环节→该行自带的图/底色;计时与文字环节→计时页全局背景(卡4)
    applyStageBg(stage) {
      const el = $('timer-bg'); if (!el) return;
      el.classList.remove('preset-blue', 'preset-purple', 'has-img');
      el.style.backgroundImage = '';
      let url = null, preset = null;
      const s = this.sess;
      if (stage && P.isContent(stage) && stage.type === 'image') {
        url = stage.imageData || null;
        preset = url ? null : (stage.bg === 'blue' || stage.bg === 'purple' ? stage.bg : null);
      } else {
        url = (s && s.art && s.art.timer) || null;
        preset = (s && s.bgPreset && s.bgPreset.timer) || null;
      }
      if (preset) el.classList.add('preset-' + preset);
      if (url) { el.style.backgroundImage = 'url("' + url + '")'; el.classList.add('has-img'); }
    },

    // 顶部辩题/队伍名(计时环节每帧由 render 重填;图文环节整幅图不需要,文字环节要)
    updateHeader() {
      const s = this.sess || DT.store.session();
      const topic = (s.topic || '').trim();
      const topicEl = $('t-topic');
      topicEl.textContent = topic;
      topicEl.classList.toggle('hidden', !topic);
      Engine.SIDES.forEach((side) => {
        const team = ((s.teamName[side] || '').trim());
        $('name-' + side).textContent = team ? SIDE_LABEL[side] + ' · ' + team : SIDE_LABEL[side];
      });
    },

    // 每次进入/切换环节时布置画面:切 content 形态、填文字/页头、铺背景、重建操作栏
    enterStageUI() {
      const g = this.g;
      const scr = $('screen-timing');
      const stage = g ? g.format.stages[g.idx] : null;
      const content = stage ? P.isContent(stage) : false;
      scr.classList.remove('content-mode', 'content-img', 'content-text');
      scr.classList.remove('solo');                  // 时钟形态由 render 每帧重算,先复位
      if (content) {
        scr.classList.add('content-mode');
        scr.classList.add(stage.type === 'image' ? 'content-img' : 'content-text');
        if (stage.type === 'text') this.updateHeader();   // 纯文字环节仍显示辩题/队名
      }
      this.applyStageBg(stage);
      const sl = $('slide-layer'), msgEl = $('content-msg');
      if (content && stage.type === 'text') {
        msgEl.textContent = stage.text || '';
        sl.style.setProperty('--txt-scale', String(stage.textSize == null ? 1 : stage.textSize));
      } else {
        msgEl.textContent = '';
        sl.style.setProperty('--txt-scale', '1');
      }
      Ops.build(content);
      if (content && stage.type === 'text') applyAppearance();   // 文字环节页头也要吃用户自定义外观
    },

    // 从设置屏发起本场 → 直接进投屏,首环节即从 0 开始(若首行是图文封面则像旧封面页)
    start() {
      const v = DT.validateCurrent();
      if (!v.ok) { toast('赛制未通过:' + (v.errors[0] || '')); return; }
      stopLoop();
      this.matchFmt = DT.currentCopy();
      this.sess = DT.store.session();
      this.g = Engine.create(this.matchFmt);
      this.showScreen('timing');
      this.enterStageUI();
      startLoop();
      scheduleAppearance();
    },

    exitTiming() {
      stopLoop(); this.g = null;
      this.showScreen('setup');
      Ops.hide();
    },

    // ---- 主循环回调(每帧 EVAL + 渲染) ----
    onCue(cue) {
      // 仅提示音:剩余30s/时间到 都只响铃,不弹气泡
      if (cue.type === 'warning') Sound.warn();
      else Sound.end();
    },

    render() {
      const g = this.g;
      if (!g) return;
      const stage = g.format.stages[g.idx];
      if (P.isContent(stage)) return;    // 图文/文字环节:画面已由 enterStageUI 布置,不碰时钟
      const now = performance.now();
      $('t-stage').textContent = stage.title;
      this.updateHeader();

      // 本环节参与发言的一方(fixed:有名义时长的方;pool:双方)
      const parts = stage.mode === 'pool' ? Engine.SIDES.slice()
        : Engine.SIDES.filter((sd) => (sd === 'aff' ? stage.affSec : stage.negSec) > 0);
      const solo = parts.length === 1;
      $('screen-timing').classList.toggle('solo', solo);
      Engine.SIDES.forEach((side) => {
        // 非发言方:计时器整格隐藏(队伍名保持显示,不变淡)
        $('card-' + side).classList.toggle('hidden', parts.indexOf(side) < 0);
      });

      const runId = g.active && g.clocks[g.active].status === 'running' ? g.active : null;

      Engine.SIDES.forEach((side) => {
        const c = g.clocks[side];
        const ms = Engine.remainingMs(g, side, now);
        $('time-' + side).textContent = msText(ms);
        // 数字下方只在“时间到”时提示,其余保持空白
        $('state-' + side).textContent = c.status === 'finished' ? '时间到' : '';
        // 仅“对辩(自由辩论)”环节:不发言一方的数字半透明
        const off = stage.type === 'free-debate' && !!runId && side !== runId;
        $('card-' + side).classList.toggle('off', off);
      });

      Ops.primaryText(runId ? '暂停' : '开始');
    },

    // ---- dock 动作 ----
    dispatch(type, payload) {
      if (!this.g) return;
      const r = Engine.dispatch(this.g, Object.assign({ type }, payload || {}), performance.now());
      this.g = r.state;
      r.cues.forEach((cue) => this.onCue(cue));
      this.render();
    },
    switchTo(side) {
      if (!this.g) return;
      this.dispatch('SWITCH', { side });
      if (this.g.active !== side) toast(SIDE_LABEL[side] + ' 已无时间或本环节无此方');
    },
    goNext() {
      const g = this.g; if (!g) return;
      this.dispatch('NEXT');            // 引擎在首/末环节自动钳制,不越界
      this.enterStageUI();
      scheduleAppearance();
    },
    goPrev() { if (!this.g) return; this.dispatch('PREV'); this.enterStageUI(); scheduleAppearance(); },
    resetAll() {
      this.g = Engine.create(this.matchFmt);
      this.enterStageUI();
      this.render();
      scheduleAppearance();
    },

    fullscreen() {
      if (document.fullscreenElement) document.exitFullscreen();
      else if (document.documentElement.requestFullscreen) {
        document.documentElement.requestFullscreen().catch(() => toast('无法进入全屏'));
      }
    },
    // 卡4 计时背景在比赛中途被改时即时刷新当前环节背景
    onArtChange() {
      if (!this.g) return;
      this.sess = DT.store.session();
      this.applyStageBg(this.g.format.stages[this.g.idx]);
    },
  };

  let raf = 0;
  function startLoop() {
    if (raf) cancelAnimationFrame(raf);
    raf = requestAnimationFrame(onFrame);
  }
  function stopLoop() {
    if (raf) { cancelAnimationFrame(raf); raf = 0; }
  }
  function onFrame() {
    const now = performance.now();
    const r = Engine.dispatch(App.g, { type: 'EVAL' }, now);
    App.g = r.state;
    r.cues.forEach((cue) => App.onCue(cue));
    App.render();
    raf = requestAnimationFrame(onFrame);
  }

  // ---------- 操作栏动作路由 ----------
  function runAction(act) {
    switch (act) {
      case 'more': {
        const ops = document.querySelector('#ops-root .ops');
        if (ops) ops.classList.toggle('open');
        break;
      }
      case 'full': App.fullscreen(); break;
      case 'test': Sound.ensure(); Sound.test(); break;
      case 'toggle': Sound.ensure(); App.dispatch('TOGGLE'); break;
      case 'prev': App.goPrev(); break;
      case 'next': App.goNext(); break;
      case 'resetStage': App.dispatch('RESET_STAGE'); break;
      case 'resetAll':
        if (App.matchFmt && confirm('全场重置:回到第 1 环节并恢复全部时间?')) App.resetAll();
        break;
      case 'exit':
        if (confirm('返回设置页(本场进度将丢弃)?')) App.exitTiming();
        break;
      default: break;
    }
  }

  function bind() {
    $('btn-start').addEventListener('click', () => App.start());

    // 全局操作栏点击委托
    document.addEventListener('click', (e) => {
      const btn = e.target.closest('#ops-root [data-act]');
      if (btn) { runAction(btn.getAttribute('data-act')); return; }
      // 点别处收起固定面板
      if (!e.target.closest('#ops-root')) {
        const ops = document.querySelector('#ops-root .ops');
        if (ops) ops.classList.remove('open');
      }
    });

    // 换边:点想发言的一方卡片即可(接棒续跑由引擎处理)
    Engine.SIDES.forEach((side) => {
      $('card-' + side).addEventListener('click', () => App.switchTo(side));
    });

    // 窗口尺寸变化时,按 % 存储本身自适,但仍重算钳制带
    window.addEventListener('resize', scheduleAppearance);
  }

  root.AppAPI = { onArtChange(k, url) { App.onArtChange(); } };
  document.addEventListener('DOMContentLoaded', bind);
})(typeof self !== 'undefined' ? self : this);
