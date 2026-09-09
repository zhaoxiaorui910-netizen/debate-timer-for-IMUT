// 内置赛制(参考模板)+ 数据校验(纯逻辑,node 安全可测)
// 内置数据一律只读:编辑器只能以"可编辑副本"方式载入,禁止直接改 builtin。
(function (root) {
  'use strict';
  // 类型分两组:计时(有钟,驱动 UI) 与 内容(无钟,fixed+0/0,图文/文字/封面/结束)
  const TIMED_TYPES = ['statement', 'cross-exam', 'free-debate'];
  const CONTENT_TYPES = ['image', 'text'];
  const TYPES = TIMED_TYPES.concat(CONTENT_TYPES);
  const MODES = ['fixed', 'pool'];
  const SIDES = ['aff', 'neg'];
  const MAX_SEC = 90 * 60; // 单环节上限 90 分钟,防误填
  const MIN_MS_STR = (t, s) => `${t} · ${s}`;
  const clampNum = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
  const CONTENT_LABEL = { image: '图文', text: '文字' };

  // 行构造简写:type 段=一个发言方的动作;非发言方 0(无钟)
  function seg(type, title, sec, side, lead) {
    return {
      title, type, mode: 'fixed',
      affSec: side === 'aff' ? sec : 0,
      negSec: side === 'neg' ? sec : 0,
      leadSide: lead || side,
    };
  }
  function poolSeg(type, title, lead) {
    return { title, type, mode: 'pool', affSec: 0, negSec: 0, leadSide: lead || 'aff' };
  }
  // 内容环节构造:引擎结构恒为 fixed + 0/0 + lead aff(无钟、不碰预算),外加各自负载
  function contentSeg(type, title, over) {
    const o = Object.assign({}, over || {});
    const base = { title, type, mode: 'fixed', affSec: 0, negSec: 0, leadSide: 'aff' };
    if (type === 'image') {
      base.imageData = (typeof o.imageData === 'string' && o.imageData) ? o.imageData : null;
      base.bg = (o.bg === 'blue' || o.bg === 'purple') ? o.bg : null;
    } else if (type === 'text') {
      base.text = typeof o.text === 'string' ? o.text : '';
      base.textSize = Number.isFinite(o.textSize) ? clampNum(o.textSize, 0.5, 2) : 1;
    }
    return base;
  }
  // 内容行归一化(固定语义):任何入口(载入/导入/copyOf)都过这里,保证引擎只看 fixed 0/0
  function normalizeStage(st) {
    if (!st || typeof st !== 'object') return st;
    if (CONTENT_TYPES.indexOf(st.type) < 0) return st;   // 计时/未知类型原样返回(不复制)
    const s = Object.assign({}, st);
    s.mode = 'fixed'; s.affSec = 0; s.negSec = 0;
    s.leadSide = s.leadSide === 'neg' ? 'neg' : 'aff';
    if (s.type === 'image') {
      s.imageData = (typeof s.imageData === 'string' && s.imageData) ? s.imageData : null;
      s.bg = (s.bg === 'blue' || s.bg === 'purple') ? s.bg : null;
    } else if (s.type === 'text') {
      if (typeof s.text !== 'string') s.text = '';
      const n = Number(s.textSize);
      s.textSize = Number.isFinite(n) ? clampNum(n, 0.5, 2) : 1;
    }
    return s;
  }
  const isContent = (st) => !!(st && CONTENT_TYPES.indexOf(st.type) >= 0);

  // ---------- 华语辩论世界杯(参考模板;时长以当届官方为准,可编辑) ----------
  const worldCup = {
    name: '华语辩论世界杯(参考模板)',
    builtin: true,
    poolPerSideSec: { aff: 0, neg: 0 },
    warningSec: 30,
    stages: [
      contentSeg('image', '封面'),
      seg('statement', '正方一辩开篇立论', 210, 'aff', 'aff'),
      seg('statement', '反方一辩开篇立论', 210, 'neg', 'neg'),
      seg('cross-exam', '反方二辩质询正方一辩', 120, 'neg', 'neg'),
      seg('cross-exam', '正方二辩质询反方一辩', 120, 'aff', 'aff'),
      seg('statement', '反方二辩质询小结', 90, 'neg', 'neg'),
      seg('statement', '正方二辩质询小结', 90, 'aff', 'aff'),
      { title: '四辩对辩', type: 'free-debate', mode: 'fixed', affSec: 90, negSec: 90, leadSide: 'aff' },
      seg('cross-exam', '反方三辩盘问', 120, 'neg', 'neg'),
      seg('cross-exam', '正方三辩盘问', 120, 'aff', 'aff'),
      seg('statement', '反方三辩盘问小结', 90, 'neg', 'neg'),
      seg('statement', '正方三辩盘问小结', 90, 'aff', 'aff'),
      { title: '自由辩论', type: 'free-debate', mode: 'fixed', affSec: 240, negSec: 240, leadSide: 'aff' },
      seg('statement', '反方四辩总结陈词', 210, 'neg', 'neg'),
      seg('statement', '正方四辩总结陈词', 210, 'aff', 'aff'),
      contentSeg('image', '结束'),
    ].map(idMap()),
  };

  // ---------- 国际华语辩论邀请赛(新国辩;预算池制,2025 起每队 18 分钟) ----------
  const newGuoBian = {
    name: '国际华语辩论邀请赛(新国辩)',
    builtin: true,
    poolPerSideSec: { aff: 18 * 60, neg: 18 * 60 }, // 每队 18:00,除自由辩论外共用
    warningSec: 30,
    stages: [
      contentSeg('image', '封面'),
      poolSeg('statement', '陈词1(双方一辩)', 'aff'),
      poolSeg('cross-exam', '质询1(四辩质对方一辩)', 'neg'),
      poolSeg('statement', '陈词2(双方二辩)', 'aff'),
      poolSeg('cross-exam', '质询2(三辩质对方二辩)', 'neg'),
      poolSeg('statement', '质询小结(双方三辩)', 'neg'),
      { title: '自由辩论', type: 'free-debate', mode: 'fixed', affSec: 240, negSec: 240, leadSide: 'aff' },
      poolSeg('statement', '总结陈词(双方四辩,结辩≥3分钟)', 'aff'),
      contentSeg('image', '结束'),
    ].map(idMap()),
  };

  function idMap() {
    let i = 0;
    return (s) => Object.assign({}, s, { id: String(i++) });
  }

  // ---------- 校验 ----------
  function errs(msg) { return { ok: false, errors: [msg] }; }

  function validate(format) {
    if (!format || typeof format !== 'object') return errs('赛制数据不是对象');
    const errors = [];
    const push = (m) => errors.push(m);
    if (typeof format.name !== 'string' || !format.name.trim()) push('赛制缺少名称');
    const stages = format.stages;
    if (!Array.isArray(stages) || !stages.length) push('环节不能为空');
    let anyPool = false;
    (stages || []).forEach((st, i) => {
      const at = `第 ${i + 1} 行`;
      if (!st || typeof st !== 'object') return push(`${at}:无效`);
      if (typeof st.title !== 'string' || !st.title.trim()) push(`${at}:缺环节名`);
      const content = CONTENT_TYPES.indexOf(st.type) >= 0;
      const timed = TIMED_TYPES.indexOf(st.type) >= 0;
      if (!timed && !content) push(`${at}:类型须为 计时(陈词/质询/对辩) 或 内容(图文/文字) 之一`);
      else if (content) {
        if (st.mode != null && st.mode !== 'fixed') push(`${at}:内容环节(图文/文字)只可固定,不可设为预算共用`);
        for (const side of SIDES) {
          const v = st[side === 'aff' ? 'affSec' : 'negSec'];
          if (v != null && v !== 0) push(`${at}:内容环节不需要时长,该侧需为 0`);
        }
        if (st.type === 'image') {
          if (st.imageData != null && typeof st.imageData !== 'string') push(`${at}:图片数据无效`);
          if (st.bg != null && st.bg !== 'blue' && st.bg !== 'purple') push(`${at}:内置底色无效`);
        } else if (st.type === 'text') {
          if (st.text != null && typeof st.text !== 'string') push(`${at}:文字内容需为文本`);
          if (st.textSize != null && (!Number.isFinite(st.textSize) || st.textSize < 0.5 || st.textSize > 2)) push(`${at}:字号档需在 0.5~2`);
        }
      } else {
        if (MODES.indexOf(st.mode) < 0) push(`${at}:计时方式须为 固定/预算 之一`);
        if (st.mode === 'pool') anyPool = true;
        for (const side of SIDES) {
          const v = st[side === 'aff' ? 'affSec' : 'negSec'];
          if (!Number.isFinite(v) || v < 0 || v > MAX_SEC) push(`${at}:时长需为 0~${MAX_SEC} 秒`);
        }
        if (st.leadSide !== 'aff' && st.leadSide !== 'neg') push(`${at}:先手方无效`);
      }
    });
    if (anyPool) {
      for (const side of SIDES) {
        const v = format.poolPerSideSec && format.poolPerSideSec[side];
        if (!Number.isFinite(v) || v <= 0) push('预算共用制需要填写每队总预算(>0)');
      }
    }
    const w = format.warningSec;
    if (w != null && (!Number.isFinite(w) || w < 0)) push('警告提示秒数无效');
    return { ok: errors.length === 0, errors };
  }

  // 深拷贝内置为可编辑副本
  function copyOf(format) {
    const copy = JSON.parse(JSON.stringify(Object.assign({}, format, { builtin: false })));
    if (Array.isArray(copy.stages)) copy.stages = copy.stages.map(normalizeStage);
    return copy;
  }

  // 时间字符串互转(mm:ss 或纯秒),编辑/展示共用
  function parseSec(text) {
    const t = String(text == null ? '' : text).trim();
    if (t === '') return NaN;
    if (/^\d+(\.\d+)?$/.test(t)) return Number(t);            // 纯秒
    const m = t.match(/^(\d{1,3})[:：](\d{1,2})(?:\.(\d{1,2}))?$/);
    if (m) return Number(m[1]) * 60 + Number(m[2]) + (m[3] ? Number('0.' + m[3]) : 0);
    return NaN;
  }
  function fmtSec(sec) {
    if (!Number.isFinite(sec) || sec < 0) return '0:00';
    const s = Math.round(sec);
    const mm = Math.floor(s / 60);
    const ss = s % 60;
    return mm + ':' + String(ss).padStart(2, '0');
  }

  const API = { BUILTINS: [worldCup, newGuoBian], validate, copyOf, parseSec, fmtSec,
                TYPES, MODES, SIDES, TIMED_TYPES, CONTENT_TYPES,
                contentSeg, normalizeStage, isContent, CONTENT_LABEL };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  else root.Presets = API;
})(typeof self !== 'undefined' ? self : this);
