// 辩论赛计时器 · 投屏外观(纯逻辑,node 安全可测)
// 定义「投屏外观」默认值、归一化与字号换算;不含 DOM / localStorage。
// 一份外观 = 辩题/队伍名 的位置(pos: 百分比 x/y,块心坐标) + 五组文字的颜色/字号(style) + 投影开关。
// 铁律:全为默认时不产生任何 inline/类 → 计时屏视觉与改动前逐像素一致。
(function (root) {
  'use strict';

  // 各组默认字号(= 现 style.css 生效值):clamp(min px, vw vw, max px)
  // 用户缩放因子 s 时:三端点同乘 → 曲线不变、仍随屏缩放。
  const FONTS = {
    topic: { min: 22, vw: 4, max: 52 },
    teams: { min: 22, vw: 4, max: 52 },
    stage: { min: 20, vw: 3, max: 46 },
    time:  { min: 64, vw: 15, max: 210 },
    state: { min: 13, vw: 1.8, max: 20 },
  };
  const GROUPS = ['topic', 'teams', 'stage', 'time', 'state'];
  const DEFAULT_COLOR = '#ffffff';
  const SIZE_MIN = 0.5, SIZE_MAX = 2;
  const DEFAULT_X = 50;                                    // 辩题块心默认落在屏幕水平中央
  const TEAMS_X_MAX = 50;                                  // 队名:正方块心上界(不许越过中线,反方取 100-x)
  const ALIGN_X = { left: 12, center: 50, right: 88 };     // 旧版 align(三档)→ x,仅用于读旧数据

  const newStyle = () => ({ color: DEFAULT_COLOR, size: 1 });
  const newDefault = () => ({
    pos: { topic: null, teams: null },
    style: { topic: newStyle(), teams: newStyle(), stage: newStyle(), time: newStyle(), state: newStyle() },
    shadow: true,
  });

  const isHexColor = (v) => typeof v === 'string' && /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(v);
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const num = (v, d) => (Number.isFinite(v) ? v : d);

  // 位置:x/y 均为百分比(0-100)。topic 的 x 是块心(缺省 50 居中,旧数据只有 align 时按 ALIGN_X 折算);
  // teams 的 x 是「正方块心」(反方块心恒为 100 - x),缺省/非法为 null = 水平沿用默认(正方贴左、反方贴右)。
  function normPos(v, kind) {
    if (v == null || typeof v !== 'object') return null;
    const r1 = (n) => Math.round(n * 10) / 10;
    const y = clamp(r1(num(v.y, NaN)), 0, 100);
    if (!Number.isFinite(y)) return null;
    let xv = v.x;
    if (kind === 'topic') {
      if (xv == null && v.align != null && ALIGN_X[v.align] != null) xv = ALIGN_X[v.align];
      return { x: clamp(r1(num(xv, DEFAULT_X)), 0, 100), y };
    }
    const n = num(xv, NaN);
    return { x: Number.isFinite(n) ? clamp(r1(n), 0, TEAMS_X_MAX) : null, y };
  }

  function normStyle(s) {
    const o = newStyle();
    if (s == null || typeof s !== 'object') return o;
    o.color = isHexColor(s.color) ? String(s.color).toLowerCase() : DEFAULT_COLOR;
    o.size = clamp(num(s.size, 1), SIZE_MIN, SIZE_MAX);
    return o;
  }

  // 归一化:兜底缺省/脏输入;旧数据无键时(raw 为 null)返回全新默认。
  function normalize(raw) {
    const out = newDefault();
    if (raw == null || typeof raw !== 'object') return out;
    const p = (raw.pos && typeof raw.pos === 'object') ? raw.pos : {};
    out.pos.topic = normPos(p.topic, 'topic');
    out.pos.teams = normPos(p.teams, 'teams');
    const st = (raw.style && typeof raw.style === 'object') ? raw.style : {};
    GROUPS.forEach((g) => { out.style[g] = normStyle(st[g]); });
    out.shadow = raw.shadow !== false;
    return out;
  }

  // 是否等于默认(决定是否需写 inline / 加 .userpos)
  function isDefault(ap) {
    if (ap.pos.topic || ap.pos.teams) return false;
    if (ap.shadow !== true) return false;
    return GROUPS.every((g) => {
      const s = ap.style[g];
      return s.color === DEFAULT_COLOR && s.size === 1;
    });
  }

  function userPosActive(ap) { return !!(ap.pos.topic || ap.pos.teams); }

  // 用户字号因子 → clamp 字符串;因子≈1 返回 null(用样式表默认)
  function fontCss(key, factor) {
    const f = FONTS[key];
    if (!f) return null;
    if (factor == null || factor === 1) return null;
    const s = clamp(num(factor, 1), SIZE_MIN, SIZE_MAX);
    const r = (v) => Math.round(v * 10) / 10;
    return 'clamp(' + r(f.min * s) + 'px,' + r(f.vw * s) + 'vw,' + r(f.max * s) + 'px)';
  }

  // 纵向钳制到「顶部带」或「底部带」:y ≤ lowMax 或 y ≥ highMin,否则归到较近的带边。
  function clampY(y, lowMax, highMin) {
    const v = clamp(num(y, NaN), 0, 100);
    if (!Number.isFinite(v)) return highMin > 0 ? highMin : 0;
    if (v <= lowMax) return Math.max(0, Math.min(v, lowMax));
    if (v >= highMin) return Math.min(100, Math.max(v, highMin));
    return (v - lowMax <= highMin - v) ? Math.max(0, lowMax) : Math.min(100, highMin);
  }

  const API = { FONTS, GROUPS, DEFAULT_COLOR, SIZE_MIN, SIZE_MAX, DEFAULT_X, TEAMS_X_MAX,
                normalize, isDefault, userPosActive, fontCss, clampY };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  else root.Appearance = API;
})(typeof self !== 'undefined' ? self : this);
