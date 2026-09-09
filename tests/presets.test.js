// 辩论赛计时器 赛制数据/校验测试(零依赖,node 直跑)
// 运行: node tests/presets.test.js   全部通过 exit 0,任一失败 exit 1
'use strict';
const assert = require('node:assert');
const P = require('../presets.js');

let pass = 0, fail = 0;
function section(name, fn) {
  try { fn(); pass++; process.stdout.write('  ok  ' + name + '\n'); }
  catch (e) { fail++; process.stdout.write('FAIL  ' + name + '\n      ' + e.message + '\n'); }
}
const fmtOf = (stages, extra) => Object.assign({
  name: 'test', warningSec: 30, poolPerSideSec: { aff: 600, neg: 600 },
}, extra || {}, { stages });
const timed = (over) => Object.assign({
  title: '陈词', type: 'statement', mode: 'fixed', affSec: 120, negSec: 0, leadSide: 'aff',
}, over || {});

section('校验:内置两赛制(含首末 封面/结束 图文行)通过', () => {
  P.BUILTINS.forEach((b) => {
    const v = P.validate(b);
    assert.strictEqual(v.ok, true, b.name + ': ' + v.errors.join(';'));
  });
  const v = P.validate(fmtOf([
    P.contentSeg('image', '封面'), timed(), P.contentSeg('text', '中场规则', { text: 'hi' }),
    P.contentSeg('image', '结束'),
  ]));
  assert.strictEqual(v.ok, true);
});

section('校验:内容行 mode=pool 被拒', () => {
  const v = P.validate(fmtOf([{ title: '图', type: 'image', mode: 'pool', affSec: 0, negSec: 0, leadSide: 'aff' }]));
  assert.strictEqual(v.ok, false);
  assert.ok(v.errors[0].indexOf('不可设为预算共用') >= 0);
});

section('校验:内容行带非零秒数被拒', () => {
  const v = P.validate(fmtOf([{ title: '文', type: 'text', affSec: 30, negSec: 0 }]));
  assert.strictEqual(v.ok, false);
  assert.ok(v.errors[0].indexOf('不需要时长') >= 0);
});

section('校验:内容负载字段越界被拒(bg/字号)', () => {
  const badBg = P.validate(fmtOf([{ title: '图', type: 'image', bg: 'red' }]));
  assert.strictEqual(badBg.ok, false);
  const badSize = P.validate(fmtOf([{ title: '文', type: 'text', textSize: 9 }]));
  assert.strictEqual(badSize.ok, false);
});

section('校验:未知类型被拒', () => {
  const v = P.validate(fmtOf([{ title: 'x', type: 'meme', affSec: 0, negSec: 0 }]));
  assert.strictEqual(v.ok, false);
});

section('校验:计时行仍需秒数与先手,不因新类型放水', () => {
  const noSec = P.validate(fmtOf([{ title: '陈', type: 'statement', mode: 'fixed', negSec: 0 }]));
  assert.strictEqual(noSec.ok, false);
  const badLead = P.validate(fmtOf([timed({ leadSide: 'aff' }), timed({ leadSide: 'z' })]));
  assert.strictEqual(badLead.ok, false);
});

section('归一化:内容行强制 fixed 0/0 与默认负载', () => {
  const s = P.normalizeStage({ type: 'image', mode: 'pool', affSec: 120, negSec: 30, leadSide: 'aff', bg: 'red' });
  assert.strictEqual(s.mode, 'fixed');
  assert.strictEqual(s.affSec, 0);
  assert.strictEqual(s.negSec, 0);
  assert.strictEqual(s.imageData, null);
  assert.strictEqual(s.bg, null);
  const t = P.normalizeStage({ type: 'text', text: 123, textSize: 9 });
  assert.strictEqual(t.text, '');
  assert.strictEqual(t.textSize, 2);           // 夹到上限
  const t2 = P.normalizeStage({ type: 'text', text: 'abc', textSize: 0.2 });
  assert.strictEqual(t2.text, 'abc');
  assert.strictEqual(t2.textSize, 0.5);        // 夹到下限
});

section('归一化:计时行原样返回', () => {
  const s = { title: '陈', type: 'statement', mode: 'pool', affSec: 0, negSec: 0, leadSide: 'aff' };
  assert.strictEqual(P.normalizeStage(s), s);   // 同引用,不触碰旧数据
});

section('contentSeg:图片/文字默认形态', () => {
  const im = P.contentSeg('image', '封面');
  assert.deepStrictEqual(im, { title: '封面', type: 'image', mode: 'fixed', affSec: 0, negSec: 0, leadSide: 'aff', imageData: null, bg: null });
  const tx = P.contentSeg('text', '规则', { text: 'a\nb', textSize: 3 });
  assert.strictEqual(tx.text, 'a\nb');
  assert.strictEqual(tx.textSize, 2);          // contentSeg 也夹 [0.5,2]
  assert.strictEqual(P.isContent(im), true);
  assert.strictEqual(P.isContent(tx), true);
  assert.strictEqual(P.isContent(timed()), false);
});

section('copyOf:内容行归一化且 builtin 清为 false', () => {
  const src = Object.assign({}, P.BUILTINS[0], { builtin: true });
  const copy = P.copyOf(src);
  assert.strictEqual(copy.builtin, false);
  assert.strictEqual(copy.stages[0].type, 'image');
  assert.strictEqual(copy.stages[0].mode, 'fixed');
  assert.strictEqual(copy.stages[0].imageData, null);
  // 内置原对象不被改动
  assert.strictEqual(P.BUILTINS[0].stages[0].type, 'image');
});

// 汇总
process.stdout.write('\n—— ' + pass + ' 通过, ' + fail + ' 失败 ——\n');
process.exit(fail ? 1 : 0);
