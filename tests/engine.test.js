// 辩论赛计时器 引擎测试(零依赖,node 直跑)
// 运行: node tests/engine.test.js   全部通过 exit 0,任一失败 exit 1
'use strict';
const assert = require('node:assert');
const D = require('../engine.js');

let pass = 0, fail = 0;
function section(name, fn) {
  try { fn(); pass++; process.stdout.write('  ok  ' + name + '\n'); }
  catch (e) { fail++; process.stdout.write('FAIL  ' + name + '\n      ' + e.message + '\n'); }
}
const S = 1000; // 秒 -> ms
function fixedStage(over) { return Object.assign({
  title: 't', type: 'statement', mode: 'fixed', affSec: 0, negSec: 0, leadSide: 'aff'
}, over); }
function fmt(stages, extra) { return Object.assign({
  name: 'test', builtin: false, warningSec: 30,
  poolPerSideSec: { aff: 0, neg: 0 }
}, extra || {}, { stages: stages.map((s, i) => Object.assign({}, s, { id: i })) }); }
const act = (type, extra) => Object.assign({ type }, extra || {});
const run = (st, action, now) => D.dispatch(st, action, now);
// 简化:从 st 出发连续执行并返回最终 state
function ev(st, nowMs, until) {
  // 从 nowMs 推进计时,直到当前 active 钟走完(模拟逐帧)
  let cur = st, cues = [];
  let n = nowMs, lim = nowMs + until;
  let guard = 0;
  while (n <= lim && guard++ < 100000) {
    const r = D.dispatch(cur, act('EVAL'), n);
    cues = cues.concat(r.cues);
    cur = r.state;
    n += 50;
  }
  return { state: cur, cues };
}

// ---------- 1. 陈词(fixed 单方)基本流程 ----------
section('陈词:create 默认与先手方', () => {
  const st = D.create(fmt([fixedStage({ title: '立论', affSec: 210, leadSide: 'aff' })]), 0);
  assert.strictEqual(st.idx, 0);
  assert.strictEqual(st.clocks.aff.remainingMs, 210 * S);
  assert.strictEqual(st.clocks.aff.status, 'paused');
  assert.strictEqual(st.clocks.neg.status, 'inactive'); // 0 => 无钟
  assert.strictEqual(st.clocks.neg.remainingMs, 0);
  assert.strictEqual(st.active, 'aff');
});

section('陈词:start 后精确递减且不到阈值无提示', () => {
  let st = D.create(fmt([fixedStage({ affSec: 210 })]), 0);
  st = run(st, act('START'), 0).state;
  const r = run(st, act('EVAL'), 10 * S);
  assert.strictEqual(r.state.clocks.aff.remainingMs, 200 * S);
  assert.strictEqual(r.cues.length, 0);
  assert.strictEqual(r.state.clocks.neg.remainingMs, 0);
});

section('陈词:pause 冻结 / resume 续走', () => {
  let st = D.create(fmt([fixedStage({ affSec: 60 })]), 0);
  st = run(st, act('START'), 0).state;
  st = run(st, act('EVAL'), 5 * S).state;
  assert.strictEqual(st.clocks.aff.remainingMs, 55 * S);
  st = run(st, act('PAUSE'), 5 * S).state;
  assert.strictEqual(st.clocks.aff.status, 'paused');
  st = run(st, act('EVAL'), 20 * S).state;            // 暂停期间不走
  assert.strictEqual(st.clocks.aff.remainingMs, 55 * S);
  st = run(st, act('START'), 20 * S).state;           // resume
  st = run(st, act('EVAL'), 30 * S).state;
  assert.strictEqual(st.clocks.aff.remainingMs, 45 * S);
});

section('陈词:30s 警告只触发一次,归零触发结束音并置 finished', () => {
  let st = D.create(fmt([fixedStage({ affSec: 40 })]), 0);
  st = run(st, act('START'), 0).state;
  let cues = [];
  let r = run(st, act('EVAL'), 9 * S); cues = cues.concat(r.cues); st = r.state;
  assert.deepStrictEqual(cues, []);
  r = run(st, act('EVAL'), 10 * S); cues = cues.concat(r.cues); st = r.state;
  assert.deepStrictEqual(cues, [{ side: 'aff', type: 'warning' }]);
  assert.strictEqual(st.clocks.aff.remainingMs, 30 * S);
  r = run(st, act('EVAL'), 15 * S); cues = r.cues; st = r.state;  // 25s,不再触发
  assert.deepStrictEqual(cues, []);
  r = run(st, act('EVAL'), 40 * S); st = r.state;
  assert.deepStrictEqual(r.cues, [{ side: 'aff', type: 'end' }]);
  assert.strictEqual(st.clocks.aff.remainingMs, 0);
  assert.strictEqual(st.clocks.aff.status, 'finished');
});

section('陈词:短环节(20s<警告)不触发警告音', () => {
  let st = D.create(fmt([fixedStage({ affSec: 20 })]), 0);
  st = run(st, act('START'), 0).state;
  let r = run(st, act('EVAL'), 10 * S);   // 10s 剩余,低于 30 但从未高于
  assert.deepStrictEqual(r.cues, []);
  r = run(st, act('EVAL'), 20 * S);
  assert.deepStrictEqual(r.cues, [{ side: 'aff', type: 'end' }]);
});

// ---------- 2. 质询:仅质询方走表 ----------
section('质询:只有质询方(本测试反方)有钟,先手自动为质询方', () => {
  const st = D.create(fmt([fixedStage({
    title: '正方一辩被反方二辩质询', type: 'cross-exam',
    affSec: 0, negSec: 120, leadSide: 'neg'
  })]), 0);
  assert.strictEqual(st.clocks.neg.status, 'paused');
  assert.strictEqual(st.clocks.neg.remainingMs, 120 * S);
  assert.strictEqual(st.clocks.aff.status, 'inactive'); // 被质询方不走表
  assert.strictEqual(st.active, 'neg');
});

section('质询:换到无钟一方会被忽略', () => {
  let st = D.create(fmt([fixedStage({ type: 'cross-exam', affSec: 0, negSec: 120, leadSide: 'neg' })]), 0);
  st = run(st, act('SWITCH', { side: 'aff' }), 0).state; // aff 无钟
  assert.strictEqual(st.active, 'neg');
});

// ---------- 3. 对辩/自由辩论:双表交替 ----------
section('对辩:create 双钟 paused,先手正方', () => {
  const st = D.create(fmt([fixedStage({
    title: '自由辩论', type: 'free-debate', affSec: 240, negSec: 240, leadSide: 'aff'
  })]), 0);
  assert.strictEqual(st.clocks.aff.remainingMs, 240 * S);
  assert.strictEqual(st.clocks.neg.remainingMs, 240 * S);
  assert.strictEqual(st.clocks.aff.status, 'paused');
  assert.strictEqual(st.clocks.neg.status, 'paused');
  assert.strictEqual(st.active, 'aff');
});

section('对辩:换边冻结进行中钟,被切离方不扣时', () => {
  let st = D.create(fmt([fixedStage({ type: 'free-debate', affSec: 60, negSec: 60 })]), 0);
  st = run(st, act('START'), 0).state;                 // aff 跑
  st = run(st, act('EVAL'), 5 * S).state;              // aff 55s
  assert.strictEqual(st.clocks.aff.remainingMs, 55 * S);
  st = run(st, act('SWITCH', { side: 'neg' }), 5 * S).state;
  assert.strictEqual(st.clocks.aff.remainingMs, 55 * S); // aff 冻结
  assert.strictEqual(st.clocks.aff.status, 'paused');
  st = run(st, act('START'), 5 * S).state;             // neg 跑(5s→10s 只跑 5s)
  st = run(st, act('EVAL'), 10 * S).state;
  assert.strictEqual(st.clocks.neg.remainingMs, 55 * S);
  assert.strictEqual(st.clocks.aff.remainingMs, 55 * S); // aff 保持
});

section('对辩:运行中换边=接棒,新方自动开跑', () => {
  let st = D.create(fmt([fixedStage({ type: 'free-debate', affSec: 60, negSec: 60 })]), 0);
  st = run(st, act('START'), 0).state;                 // aff 跑
  st = run(st, act('EVAL'), 5 * S).state;
  st = run(st, act('SWITCH', { side: 'neg' }), 5 * S).state; // 接棒
  assert.strictEqual(st.clocks.neg.status, 'running'); // 反方自动开跑
  assert.strictEqual(st.clocks.aff.status, 'paused');
  st = run(st, act('EVAL'), 10 * S).state;
  assert.strictEqual(st.clocks.neg.remainingMs, 55 * S);
  assert.strictEqual(st.clocks.aff.remainingMs, 55 * S);
});

section('对辩:一方归零后另一方仍可继续走', () => {
  let st = D.create(fmt([fixedStage({ type: 'free-debate', affSec: 10, negSec: 60 })]), 0);
  st = run(st, act('START'), 0).state;
  let r = run(st, act('EVAL'), 10 * S); st = r.state;
  assert.deepStrictEqual(r.cues, [{ side: 'aff', type: 'end' }]);
  assert.strictEqual(st.clocks.aff.status, 'finished');
  assert.strictEqual(st.clocks.neg.remainingMs, 60 * S); // 另一方完好
  st = run(st, act('SWITCH', { side: 'neg' }), 10 * S).state;
  st = run(st, act('START'), 10 * S).state;
  r = run(st, act('EVAL'), 70 * S); st = r.state;
  assert.deepStrictEqual(r.cues, [{ side: 'neg', type: 'end' }]);
  assert.strictEqual(st.clocks.neg.status, 'finished');
});

// ---------- 4. 预算池(pool)跨环节 ----------
section('pool:预算跨环节保留,不因进环节而重置', () => {
  const g = fmt([
    fixedStage({ title: '陈词1', mode: 'pool', leadSide: 'aff' }),
    fixedStage({ title: '陈词2', mode: 'pool', leadSide: 'aff' }),
    fixedStage({ title: '陈词3', mode: 'pool', leadSide: 'aff' }),
  ], { poolPerSideSec: { aff: 100, neg: 100 } });
  let st = D.create(g, 0);
  assert.strictEqual(st.clocks.aff.remainingMs, 100 * S); // 进环节 = 全队预算
  st = run(st, act('START'), 0).state;
  st = run(st, act('EVAL'), 10 * S).state;
  assert.strictEqual(st.clocks.aff.remainingMs, 90 * S);
  st = run(st, act('PAUSE'), 10 * S).state;
  st = run(st, act('NEXT'), 10 * S).state;               // 进入陈词2
  assert.strictEqual(st.clocks.aff.remainingMs, 90 * S); // 沿承预算,非 100
  assert.strictEqual(st.clocks.neg.remainingMs, 100 * S);
});

section('pool:池环节“重置本环节”=撤销本段消耗,全场重置才回满', () => {
  const g = fmt([
    fixedStage({ title: '陈词1', mode: 'pool', leadSide: 'aff' }),
  ], { poolPerSideSec: { aff: 100, neg: 100 } });
  let st = D.create(g, 0);
  st = run(st, act('START'), 0).state;
  st = run(st, act('EVAL'), 10 * S).state;               // 90s
  st = run(st, act('PAUSE'), 10 * S).state;
  st = run(st, act('RESET_STAGE'), 10 * S).state;        // 撤销本段(10s)
  assert.strictEqual(st.clocks.aff.remainingMs, 100 * S);
  assert.strictEqual(st.clocks.aff.status, 'paused');
  assert.strictEqual(st.budget.aff, 100 * S);            // 预算同步回滚

  // 再跑一段后全场重置
  st = run(st, act('START'), 10 * S).state;
  st = run(st, act('EVAL'), 20 * S).state;               // 90s
  st = run(st, act('PAUSE'), 20 * S).state;
  assert.strictEqual(st.budget.aff, 90 * S);
  st = run(st, act('RESET_ALL'), 20 * S).state;
  assert.strictEqual(st.idx, 0);
  assert.strictEqual(st.clocks.aff.remainingMs, 100 * S);
  assert.strictEqual(st.budget.neg, 100 * S);
});

section('pool:fixed 环节(如自由辩论)不消耗预算,与池环节混排', () => {
  const g = fmt([
    fixedStage({ title: '陈词1', mode: 'pool', leadSide: 'aff' }),
    fixedStage({ title: '自由辩论', type: 'free-debate', mode: 'fixed', affSec: 60, negSec: 60 }),
    fixedStage({ title: '总结陈词', mode: 'pool', leadSide: 'aff' }),
  ], { poolPerSideSec: { aff: 100, neg: 100 } });
  let st = D.create(g, 0);
  st = run(st, act('START'), 0).state;
  st = run(st, act('EVAL'), 10 * S).state;               // aff 池 90
  st = run(st, act('PAUSE'), 10 * S).state;
  st = run(st, act('NEXT'), 10 * S).state;               // 自由辩论(fixed)
  assert.strictEqual(st.clocks.aff.remainingMs, 60 * S); // 60s 不是预算
  assert.strictEqual(st.budget.aff, 90 * S);             // 预算保持 90
  st = run(st, act('RESET_STAGE'), 10 * S).state;        // 重置 fixed 环节
  assert.strictEqual(st.clocks.aff.remainingMs, 60 * S);
  assert.strictEqual(st.budget.aff, 90 * S);             // 不影响预算
  st = run(st, act('NEXT'), 10 * S).state;               // 总结陈词(pool)
  assert.strictEqual(st.clocks.aff.remainingMs, 90 * S); // 回到 90
});

section('pool:跑光一方,该方 finished 且预算归零,另一方不受影响', () => {
  const g = fmt([
    fixedStage({ title: '陈词1', mode: 'pool', leadSide: 'aff' }),
    fixedStage({ title: '陈词2', mode: 'pool', leadSide: 'aff' }),
  ], { poolPerSideSec: { aff: 10, neg: 100 } });
  let st = D.create(g, 0);
  st = run(st, act('START'), 0).state;
  st = run(st, act('EVAL'), 10 * S).state;
  assert.strictEqual(st.clocks.aff.status, 'finished');
  assert.strictEqual(st.budget.aff, 0);
  assert.strictEqual(st.clocks.neg.remainingMs, 100 * S);
  st = run(st, act('PAUSE'), 10 * S).state;              // finished 后 pause 无害
  st = run(st, act('NEXT'), 10 * S).state;
  assert.strictEqual(st.clocks.aff.status, 'finished');  // 下一环节 aff 也无预算
  assert.strictEqual(st.clocks.neg.remainingMs, 100 * S);
});

// ---------- 5. 环节导航 ----------
section('导航:边界钳制不越界、不改运行态;fixed 重进恢复名义值', () => {
  let st = D.create(fmt([
    fixedStage({ title: 'A', affSec: 30, leadSide: 'aff' }),
    fixedStage({ title: 'B', negSec: 30, leadSide: 'neg' }),
  ]), 0);
  st = run(st, act('START'), 0).state;                   // idx0 跑
  st = run(st, act('PREV'), 0).state;                    // 已在首环节,no-op
  assert.strictEqual(st.idx, 0);
  assert.strictEqual(st.clocks.aff.status, 'running');   // 进行中的钟不被打扰
  st = run(st, act('NEXT'), 5 * S).state;                // 进入 idx1(B:仅反方 30s)
  assert.strictEqual(st.idx, 1);
  assert.strictEqual(st.clocks.aff.remainingMs, 0);      // fixed 进环节=名义值(非 A 残留)
  assert.strictEqual(st.clocks.neg.remainingMs, 30 * S);
  assert.strictEqual(st.active, 'neg');                  // B 先手反方
  st = run(st, act('PREV'), 5 * S).state;                // 退回 idx0(A):同样恢复名义值
  assert.strictEqual(st.idx, 0);
  assert.strictEqual(st.clocks.aff.remainingMs, 30 * S);
  assert.strictEqual(st.active, 'aff');
  st = run(st, act('NEXT'), 6 * S).state;
  st = run(st, act('NEXT'), 6 * S).state;                // 已到末尾 idx1,钳制不越界
  assert.strictEqual(st.idx, 1);
});

// ---------- 6. 空转幂等 ----------
section('无运行钟时 EVAL 幂等、无提示', () => {
  let st = D.create(fmt([fixedStage({ affSec: 60, leadSide: 'aff' })]), 0);
  const r = run(st, act('EVAL'), 50 * S);
  assert.strictEqual(r.cues.length, 0);
  assert.strictEqual(r.state, st);
  const r2 = run(st, act('EVAL'), 100 * S);
  assert.strictEqual(r2.state, st);
});

// ---------- 7. 重置语义 ----------
section('fixed:重置本环节恢复名义时长', () => {
  let st = D.create(fmt([fixedStage({ type: 'free-debate', affSec: 60, negSec: 60 })]), 0);
  st = run(st, act('START'), 0).state;
  st = run(st, act('EVAL'), 20 * S).state;               // aff 40
  st = run(st, act('PAUSE'), 20 * S).state;
  st = run(st, act('RESET_STAGE'), 20 * S).state;
  assert.strictEqual(st.clocks.aff.remainingMs, 60 * S);
  assert.strictEqual(st.clocks.neg.remainingMs, 60 * S);
});

// ---------- 8. 内容环节(图文/文字:无钟)语义 = fixed 0/0 ----------
section('内容:进图文/文字环节双 inactive、active=null、EVAL 幂等', () => {
  const st = D.create(fmt([fixedStage({ type: 'image', title: '封面' })]), 0);
  assert.strictEqual(st.idx, 0);
  assert.strictEqual(st.clocks.aff.status, 'inactive');
  assert.strictEqual(st.clocks.neg.status, 'inactive');
  assert.strictEqual(st.clocks.aff.remainingMs, 0);
  assert.strictEqual(st.clocks.neg.remainingMs, 0);
  assert.strictEqual(st.active, null);
  const r = run(st, act('EVAL'), 30 * S);
  assert.strictEqual(r.state, st);                     // 原引用返回
  assert.strictEqual(r.cues.length, 0);
});

section('内容:START/TOGGLE/SWITCH 均不产生运行钟', () => {
  let st = D.create(fmt([fixedStage({ type: 'text', title: '本场规则' })]), 0);
  st = run(st, act('START'), 0).state;
  assert.strictEqual(st.active, null);
  st = run(st, act('TOGGLE'), 0).state;
  assert.strictEqual(st.active, null);
  st = run(st, act('SWITCH', { side: 'aff' }), 0).state;
  assert.strictEqual(st.active, null);
  st = run(st, act('SWITCH', { side: 'neg' }), 0).state;
  assert.strictEqual(st.active, null);
  const running = D.SIDES.some((s) => st.clocks[s].status === 'running');
  assert.strictEqual(running, false);
});

section('内容:夹在两 pool 段之间,穿过内容环节不丢预算', () => {
  const g = fmt([
    fixedStage({ title: '陈词A', mode: 'pool', leadSide: 'aff' }),
    fixedStage({ type: 'image', title: '图文过渡' }),
    fixedStage({ title: '陈词B', mode: 'pool', leadSide: 'aff' }),
  ], { poolPerSideSec: { aff: 100, neg: 100 } });
  let st = D.create(g, 0);
  st = run(st, act('START'), 0).state;
  st = run(st, act('EVAL'), 10 * S).state;             // aff 90
  st = run(st, act('PAUSE'), 10 * S).state;
  st = run(st, act('NEXT'), 10 * S).state;             // 进图文
  assert.strictEqual(st.idx, 1);
  assert.strictEqual(st.clocks.aff.status, 'inactive');
  assert.strictEqual(st.clocks.neg.status, 'inactive');
  assert.strictEqual(st.budget.aff, 90 * S);           // 预算保持
  st = run(st, act('EVAL'), 20 * S).state;             // 内容段空转
  assert.strictEqual(st.budget.aff, 90 * S);
  st = run(st, act('NEXT'), 20 * S).state;             // 进 poolB
  assert.strictEqual(st.clocks.aff.remainingMs, 90 * S); // 沿承 90
  assert.strictEqual(st.clocks.neg.remainingMs, 100 * S);
});

section('内容:内容段上 RESET_STAGE 无害且不碰预算', () => {
  const g = fmt([
    fixedStage({ title: '陈词A', mode: 'pool', leadSide: 'aff' }),
    fixedStage({ type: 'text', title: '本场规则' }),
  ], { poolPerSideSec: { aff: 100, neg: 100 } });
  let st = D.create(g, 0);
  st = run(st, act('START'), 0).state;
  st = run(st, act('EVAL'), 10 * S).state;
  st = run(st, act('PAUSE'), 10 * S).state;
  assert.strictEqual(st.budget.aff, 90 * S);
  st = run(st, act('NEXT'), 10 * S).state;
  st = run(st, act('RESET_STAGE'), 10 * S).state;
  assert.strictEqual(st.clocks.aff.status, 'inactive');
  assert.strictEqual(st.clocks.neg.status, 'inactive');
  assert.strictEqual(st.budget.aff, 90 * S);
  assert.strictEqual(st.active, null);
});

section('内容:PREV 从内容环节回计时环节并恢复名义值', () => {
  const g = fmt([
    fixedStage({ title: '陈词A', affSec: 60, leadSide: 'aff' }),
    fixedStage({ type: 'image', title: '图文页' }),
  ]);
  let st = D.create(g, 0);
  st = run(st, act('START'), 0).state;
  st = run(st, act('EVAL'), 5 * S).state;              // aff 55
  st = run(st, act('NEXT'), 5 * S).state;              // 进内容
  assert.strictEqual(st.clocks.aff.status, 'inactive');
  st = run(st, act('PREV'), 5 * S).state;              // 回陈词A
  assert.strictEqual(st.idx, 0);
  assert.strictEqual(st.clocks.aff.remainingMs, 60 * S); // fixed 重进=名义值
  assert.strictEqual(st.clocks.aff.status, 'paused');
});

// 汇总
process.stdout.write('\n—— ' + pass + ' 通过, ' + fail + ' 失败 ——\n');
process.exit(fail ? 1 : 0);
