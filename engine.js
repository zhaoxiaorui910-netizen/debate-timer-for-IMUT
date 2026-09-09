// 辩论赛计时器 · 计时引擎(纯函数状态机,无 DOM)
// 三种环节类型(statement/cross-exam/free-debate)共用同构引擎:
//   每环节 正/反 各一钟,同一时刻仅一个钟在走(active),操作员换边切换。
// fixed:进环节时该方剩余 = 环节名义时长;pool:进环节时 = 全队预算(跨环节沿承)。
// 精度:仅在 start/pause 等动作改写 remaining;运行中由 deadline(绝对截止)推导,EVAL 收敛。
// dispatch(state, action, nowMs) -> { state, cues };nowMs 显式传入以便确定性测试。
(function (root) {
  'use strict';
  const SIDES = ['aff', 'neg'];
  const WARN_DEFAULT = 30;

  const isPoolStage = (s) => s.mode === 'pool';
  const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

  // ---------- 时钟 ----------
  // status: paused | running | finished | inactive(该环节无此方)
  function freshClock(remainingMs, absentAsFinished) {
    if (remainingMs <= 0) return {
      remainingMs: 0, status: absentAsFinished ? 'finished' : 'inactive',
      deadlineMs: null, fired: { warning: false, end: false }, warnArmed: false,
    };
    return {
      remainingMs, status: 'paused', deadlineMs: null,
      fired: { warning: false, end: false }, warnArmed: false,
    };
  }

  function seedClockFor(state, idx, side) {
    const stage = state.format.stages[idx];
    if (isPoolStage(stage)) {
      const b = state.budget[side];                 // 沿承全队预算
      return freshClock(b, true);                   // 预算耗尽→finished(便于跨环节提示)
    }
    const sec = side === 'aff' ? stage.affSec : stage.negSec;
    return freshClock(sec * 1000, false);           // 名义 0→inactive(本环节无此方)
  }

  function enterStage(state, idx) {
    const stage = state.format.stages[idx];
    state.idx = idx;
    state.clocks = {};
    for (const side of SIDES) {
      state.clocks[side] = seedClockFor(state, idx, side);
      state.segmentStart[side] = state.clocks[side].remainingMs;
    }
    state.active = pickActive(state.clocks, stage);
  }

  function pickActive(clocks, stage) {
    const lead = stage.leadSide === 'neg' ? 'neg' : 'aff';
    const other = lead === 'neg' ? 'aff' : 'neg';
    if (clocks[lead].remainingMs > 0) return lead;
    if (clocks[other].remainingMs > 0) return other;
    return null;
  }

  // 池环节把当前剩余写回全场预算
  function writebackBudget(state, side) {
    if (isPoolStage(state.format.stages[state.idx])) {
      state.budget[side] = state.clocks[side].remainingMs;
    }
  }

  function start(state, side, nowMs) {
    const c = state.clocks[side];
    if (!c || c.status === 'running' || c.remainingMs <= 0) return;
    c.warnArmed = c.remainingMs > WARN_DEFAULT * 1000;  // 短于警告阈值的环节不响警告
    c.deadlineMs = nowMs + c.remainingMs;
    c.status = 'running';
    state.active = side;
  }

  function pause(state, side, nowMs) {
    const c = state.clocks[side];
    if (!c || c.status !== 'running') return;
    const rem = Math.max(0, c.deadlineMs - nowMs);
    c.remainingMs = rem;
    c.deadlineMs = null;
    c.status = rem > 0 ? 'paused' : 'finished';
    // 暂停不清空选中侧:暂停后“开始”即可续走;归零由 settle 清空
    writebackBudget(state, side);
  }

  // 结算一个运行中的钟:推导剩余、触发跨阈值提示、归零置 finished
  function settle(state, side, nowMs) {
    const c = state.clocks[side];
    if (c.status !== 'running') return [];
    const cues = [];
    const rem = c.deadlineMs - nowMs;
    if (rem <= WARN_DEFAULT * 1000 && rem > 0 && c.warnArmed && !c.fired.warning) {
      c.fired.warning = true;
      cues.push({ side, type: 'warning' });
    }
    if (rem <= 0) {
      c.remainingMs = 0;
      c.deadlineMs = null;
      if (!c.fired.end) { c.fired.end = true; cues.push({ side, type: 'end' }); }
      c.status = 'finished';
      if (state.active === side) state.active = null;
    } else {
      c.remainingMs = rem;
    }
    writebackBudget(state, side);
    return cues;
  }

  // ---------- 状态创建 / 动作 ----------
  function create(format) {
    const stages = (format.stages || []).slice();
    if (!stages.length) return { empty: true };
    const norm = Object.assign({}, format, {
      stages,
      warningSec: format.warningSec == null ? WARN_DEFAULT : format.warningSec,
    });
    const budget0 = {
      aff: (norm.poolPerSideSec && norm.poolPerSideSec.aff || 0) * 1000,
      neg: (norm.poolPerSideSec && norm.poolPerSideSec.neg || 0) * 1000,
    };
    const state = {
      format: norm, idx: 0,
      budget: { aff: budget0.aff, neg: budget0.neg },  // 全队池预算(权威值)
      budget0,                                          // RESET_ALL 的回满基准
      clocks: null, active: null,
      segmentStart: { aff: 0, neg: 0 },
    };
    enterStage(state, 0);
    return state;
  }

  function resetStage(state, nowMs) {
    if (state.active) pause(state, state.active, nowMs);
    const idx = state.idx;
    state.clocks = {};
    for (const side of SIDES) {
      const rem = state.segmentStart[side];           // fixed→名义值;pool→进环节时的预算(撤销本段消耗)
      state.clocks[side] = isPoolStage(state.format.stages[idx])
        ? freshClock(rem, true) : freshClock(rem, false);
      writebackBudget(state, side);
    }
    state.active = pickActive(state.clocks, state.format.stages[idx]);
  }

  function resetAll(state) {
    state.budget = { aff: state.budget0.aff, neg: state.budget0.neg };
    enterStage(state, 0);
  }

  function anyRunning(state) {
    return SIDES.some((side) => state.clocks[side].status === 'running');
  }

  function dispatch(prev, action, nowMs) {
    if (prev.empty) return { state: prev, cues: [] };
    const t = action.type;
    // 无运行钟时 EVAL 无任何效果:原引用直接返回,便于 UI 跳过重渲染
    if (t === 'EVAL' && !anyRunning(prev)) return { state: prev, cues: [] };
    const state = cloneState(prev);
    const cues = [];
    const cur = () => state.format.stages[state.idx];

    switch (t) {
      case 'EVAL':
        for (const side of SIDES) cues.push.apply(cues, settle(state, side, nowMs));
        break;
      case 'START': start(state, state.active, nowMs); break;
      case 'PAUSE': if (state.active) pause(state, state.active, nowMs); break;
      case 'TOGGLE':
        if (state.active && state.clocks[state.active].status === 'running') pause(state, state.active, nowMs);
        else start(state, state.active, nowMs);
        break;
      case 'SWITCH': {
        const side = action.side;
        if (side !== 'aff' && side !== 'neg') break;
        const wasRunning = !!(state.active && state.clocks[state.active].status === 'running');
        if (state.active && state.active !== side) pause(state, state.active, nowMs);
        if (state.clocks[side].remainingMs <= 0) break;           // 目标已无时间/本环节无此方
        state.active = side;
        if (wasRunning && state.clocks[side].status === 'paused') start(state, side, nowMs); // 接棒续跑
        break;
      }
      case 'NEXT': case 'PREV': case 'SET_STAGE': {
        const target = t === 'NEXT' ? state.idx + 1
          : t === 'PREV' ? state.idx - 1
          : clamp(action.index | 0, 0, state.format.stages.length - 1);
        const ni = clamp(target, 0, state.format.stages.length - 1);
        if (ni === state.idx) return { state: prev, cues: [] }; // 无操作,不打扰进行中的钟
        if (state.active) pause(state, state.active, nowMs);
        enterStage(state, ni);
        break;
      }
      case 'RESET_STAGE': resetStage(state, nowMs); break;
      case 'RESET_ALL': resetAll(state); break;
      default: break;
    }
    if (!state.active) state.active = pickActive(state.clocks, cur());
    return { state, cues };
  }

  // 运行中钟的即时剩余(高帧渲染用,不改状态;暂停/未开始返回已存值)
  function remainingMs(state, side, nowMs) {
    const c = state.clocks[side];
    if (c.status === 'running') return Math.max(0, c.deadlineMs - nowMs);
    return c.remainingMs;
  }

  function cloneState(prev) {
    const s = {
      format: prev.format, idx: prev.idx,
      budget: { aff: prev.budget.aff, neg: prev.budget.neg },
      budget0: prev.budget0,
      active: prev.active,
      segmentStart: { aff: prev.segmentStart.aff, neg: prev.segmentStart.neg },
      clocks: {},
    };
    for (const side of SIDES) {
      const c = prev.clocks[side];
      s.clocks[side] = {
        remainingMs: c.remainingMs, status: c.status, deadlineMs: c.deadlineMs,
        fired: { warning: c.fired.warning, end: c.fired.end },
        warnArmed: c.warnArmed,
      };
    }
    return s;
  }

  const API = { create, dispatch, remainingMs, resetStage, resetAll, SIDES, WARN_DEFAULT };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  else root.DebateEngine = API;
})(typeof self !== 'undefined' ? self : this);
