// 投屏外观 纯逻辑测试(零依赖): node tests/appearance.test.js
'use strict';
const A = require('../appearance.js');

let pass = 0, fail = 0;
function ok(name, cond) {
  if (cond) { pass++; }
  else { fail++; console.log('FAIL: ' + name); }
}
function eq(name, a, b) {
  const ja = JSON.stringify(a), jb = JSON.stringify(b);
  ok(name + '  (got ' + ja + ', want ' + jb + ')', ja === jb);
}

// ---------- normalize:缺省/兜底 ----------
{
  const d = A.normalize(null);
  eq('normalize(null) 顶部/队名 pos 均为 null', [d.pos.topic, d.pos.teams], [null, null]);
  eq('normalize(null) 各组颜色默认 #ffffff', d.style.topic.color, '#ffffff');
  eq('normalize(null) size 默认 1', d.style.time.size, 1);
  ok('normalize(null) shadow 默认 true', d.shadow === true);
  ok('normalize(null) isDefault', A.isDefault(d));
  ok('normalize(undefined) isDefault', A.isDefault(A.normalize(undefined)));

  const n1 = A.normalize(null), n2 = A.normalize(null);
  n1.style.time.color = '#112233';
  ok('每次 normalize 返回全新对象(不串改)', n2.style.time.color === '#ffffff' && n2.style.topic.color === '#ffffff');
}

// ---------- normalize:部分输入 ----------
{
  const a = A.normalize({ style: { time: { color: '#00FF88' } }, shadow: false });
  eq('部分输入: 只改 time 颜色', a.style.time.color, '#00ff88');
  eq('部分输入: 其余组保持默认', a.style.topic.color, '#ffffff');
  ok('部分输入: shadow=false 生效', a.shadow === false);
}

// ---------- normalize:越界/脏输入 ----------
{
  eq('颜色非法回退默认', A.normalize({ style: { topic: { color: '#12' } } }).style.topic.color, '#ffffff');
  eq('颜色大小写归一', A.normalize({ style: { topic: { color: '#AABBCC' } } }).style.topic.color, '#aabbcc');
  ok('size 越上限钳到 2', A.normalize({ style: { time: { size: 9 } } }).style.time.size === 2);
  ok('size 越下限钳到 0.5', A.normalize({ style: { time: { size: 0.01 } } }).style.time.size === 0.5);
  ok('非数值 size 回退 1', A.normalize({ style: { time: { size: 'abc' } } }).style.time.size === 1);
}

// ---------- normalize:位置(辩题 x/y 自由;队名 x=正方块心,反方镜像) ----------
{
  const a = A.normalize({ pos: { topic: { x: 30, y: 30 }, teams: { x: 20, y: 88 } } });
  eq('topic 位置保留 x+y', a.pos.topic, { x: 30, y: 30 });
  eq('队名 位置保留 x+y', a.pos.teams, { x: 20, y: 88 });
  eq('x 小数保留一位', A.normalize({ pos: { topic: { x: 12.34, y: 10 } } }).pos.topic.x, 12.3);

  eq('y 越界钳制 150→100', A.normalize({ pos: { topic: { y: 150 } } }).pos.topic.y, 100);
  eq('y 越界钳制 -5→0', A.normalize({ pos: { topic: { y: -5 } } }).pos.topic.y, 0);
  eq('topic x 越界钳制 150→100', A.normalize({ pos: { topic: { x: 150, y: 10 } } }).pos.topic.x, 100);
  eq('topic x 越界钳制 -5→0', A.normalize({ pos: { topic: { x: -5, y: 10 } } }).pos.topic.x, 0);
  eq('topic x 缺省补 50(居中)', A.normalize({ pos: { topic: { y: 10 } } }).pos.topic.x, 50);
  eq('topic x 非数值回退 50', A.normalize({ pos: { topic: { x: 'abc', y: 10 } } }).pos.topic.x, 50);

  // 队名:正方只在左半边,x 缺省/非法 = null(水平回默认贴左右边)
  eq('队名 x 缺省 → null(水平回默认)', A.normalize({ pos: { teams: { y: 88 } } }).pos.teams.x, null);
  eq('队名 x 超右界 150→50', A.normalize({ pos: { teams: { x: 150, y: 88 } } }).pos.teams.x, 50);
  eq('队名 x 越左界 -5→0', A.normalize({ pos: { teams: { x: -5, y: 88 } } }).pos.teams.x, 0);
  eq('队名 x 非数值 → null', A.normalize({ pos: { teams: { x: 'abc', y: 88 } } }).pos.teams.x, null);
  ok('队名 x=0 是有效值(不等于 null)', A.normalize({ pos: { teams: { x: 0, y: 88 } } }).pos.teams.x === 0);

  // 旧数据兼容:无 x 有 align → 映射到 x
  eq('旧 align=left → x 12', A.normalize({ pos: { topic: { y: 30, align: 'left' } } }).pos.topic, { x: 12, y: 30 });
  eq('旧 align=center → x 50', A.normalize({ pos: { topic: { y: 30, align: 'center' } } }).pos.topic.x, 50);
  eq('旧 align=right → x 88', A.normalize({ pos: { topic: { y: 30, align: 'right' } } }).pos.topic.x, 88);
  eq('旧 align 非法 → x 50', A.normalize({ pos: { topic: { y: 30, align: 'top' } } }).pos.topic.x, 50);
  eq('有 x 时忽略旧 align', A.normalize({ pos: { topic: { x: 70, y: 30, align: 'left' } } }).pos.topic.x, 70);
  eq('旧队名 align 被忽略(仍为 null)', A.normalize({ pos: { teams: { y: 88, align: 'left' } } }).pos.teams.x, null);

  ok('topic 位置非对象视为 null', A.normalize({ pos: { topic: 5 } }).pos.topic === null);
  ok('队名 位置非对象视为 null', A.normalize({ pos: { teams: 'x' } }).pos.teams === null);
  ok('y 非数值视为未启用', A.normalize({ pos: { topic: { x: 30, y: 'x' } } }).pos.topic === null);
  ok('位置只剩默认 x 也视为启用', A.normalize({ pos: { topic: { x: 50, y: 10 } } }).pos.topic.y === 10);
  ok('队名只有 y 也算启用', A.normalize({ pos: { teams: { y: 88 } } }).pos.teams.y === 88);
  ok('空 pos 视为未启用', A.normalize({ pos: {} }).pos.topic === null && A.normalize({ pos: {} }).pos.teams === null);
}

// ---------- isDefault / userPosActive ----------
{
  ok('改颜色 → 非默认', !A.isDefault(A.normalize({ style: { stage: { color: '#ff0000' } } })));
  ok('改字号 → 非默认', !A.isDefault(A.normalize({ style: { time: { size: 1.3 } } })));
  ok('改位置 → 非默认', !A.isDefault(A.normalize({ pos: { topic: { y: 10 } } })));
  ok('关投影 → 非默认', !A.isDefault(A.normalize({ shadow: false })));
  ok('userPosActive: 只有 topic 也算启用', A.userPosActive(A.normalize({ pos: { topic: { y: 5 } } })));
  ok('userPosActive: 默认不启用', !A.userPosActive(A.normalize(null)));
}

// ---------- fontCss ----------
{
  eq('factor=1 → null(用样式表默认)', A.fontCss('time', 1), null);
  eq('factor 缺省 → null', A.fontCss('topic'), null);
  eq('topic ×1.5 端点同乘', A.fontCss('topic', 1.5), 'clamp(33px,6vw,78px)');
  eq('stage ×0.5 支持小数', A.fontCss('stage', 0.5), 'clamp(10px,1.5vw,23px)');
  eq('time ×1.5', A.fontCss('time', 1.5), 'clamp(96px,22.5vw,315px)');
  ok('未知 key → null', A.fontCss('nope', 2) === null);
  ok('factor 越界钳制', A.fontCss('topic', 9) === 'clamp(44px,8vw,104px)');
}

// ---------- clampY:顶部带/底部带 ----------
{
  ok('顶部带内保持', A.clampY(10, 30, 70) === 10);
  ok('底部带内保持', A.clampY(80, 30, 70) === 80);
  ok('中央区(50)归到较近顶部带边 30', A.clampY(50, 30, 70) === 30);
  ok('中央区(69)归到较近底部带边 70', A.clampY(69, 30, 70) === 70);
  ok('越下界钳 0', A.clampY(-8, 30, 70) === 0);
  ok('越上界钳 100', A.clampY(120, 30, 70) === 100);
  ok('非数值 y 回退 highMin', A.clampY('x', 30, 70) === 70);
}

// ---------- FONTS 表完整性 / 常量 ----------
{
  ok('五组都有字号', A.GROUPS.length === 5 && A.GROUPS.every((g) => A.FONTS[g] && A.FONTS[g].min > 0));
  ok('默认水平位置 x=50', A.DEFAULT_X === 50);
  ok('队名正方块心上界 50', A.TEAMS_X_MAX === 50);
}

console.log('appearance.test: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
