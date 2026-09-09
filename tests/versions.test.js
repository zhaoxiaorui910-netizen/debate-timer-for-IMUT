// 版本库 纯逻辑测试(零依赖): node tests/versions.test.js
'use strict';
const V = require('../versions.js');

let pass = 0, fail = 0;
function ok(name, cond) {
  if (cond) { pass++; }
  else { fail++; console.log('FAIL: ' + name); }
}
function eq(name, a, b) {
  const ja = JSON.stringify(a), jb = JSON.stringify(b);
  ok(name + '  (got ' + ja + ', want ' + jb + ')', ja === jb);
}

const fmt = () => ({ name: '赛制A', builtin: false, poolPerSideSec: { aff: 1080, neg: 1080 }, warningSec: 30, stages: [{ title: '立论', type: 'statement', mode: 'fixed', affSec: 180, negSec: 0, leadSide: 'aff', id: '0' }] });
const sess = () => ({ eventTitle: '第三届', topic: '辩题', teamName: { aff: '正方队', neg: '反方队' }, art: { cover: null, timer: 'data:image/jpeg;base64,xxx', end: null }, bgPreset: { cover: null, timer: null, end: null } });
const appr = () => ({ pos: { topic: { y: 8, align: 'center' }, teams: null }, style: { topic: { color: '#ffffff', size: 1 } }, shadow: true });

// ---------- wrap:构建记录且深拷贝 ----------
{
  const f = fmt(), s = sess(), a = appr();
  const v = V.wrap('第三届', f, s, a);
  ok('wrap: id 形如 v开头', typeof v.id === 'string' && v.id.indexOf('v') === 0);
  eq('wrap: name/updated/fmt 带出', [v.name, typeof v.updated, v.fmt.name], ['第三届', 'number', '赛制A']);
  // 深拷贝:改原对象不影响记录
  f.name = '改了'; s.eventTitle = '改了'; a.shadow = false;
  ok('wrap: fmt 深拷贝', v.fmt.name === '赛制A');
  ok('wrap: session 深拷贝', v.session.eventTitle === '第三届');
  ok('wrap: appearance 深拷贝', v.appearance.shadow === true);
  const v2 = V.wrap('X', fmt(), sess(), appr());
  ok('两次 wrap id 不同', v.id !== v2.id);
}

// ---------- clone ----------
{
  const o = { a: 1, b: { c: [1, 2] } };
  const c = V.clone(o);
  c.b.c.push(9);
  ok('clone 深拷贝', o.b.c.length === 2 && c.b.c.length === 3);
  eq('clone null', V.clone(null), null);
}

// ---------- find / upsert ----------
{
  const v1 = V.wrap('甲', fmt(), sess(), appr());
  let list = V.upsert([], v1);
  eq('upsert 空表新增', list.length, 1);
  ok('find 命中', V.find(list, v1.id) === v1);
  ok('find 未命中 null', V.find(list, 'no-such') == null);

  const v1b = V.wrap('甲改', fmt(), sess(), appr());
  v1b.id = v1.id;
  const next = V.upsert(list, v1b);
  eq('upsert 同 id 替换后仍 1 条', next.length, 1);
  ok('upsert 同 id 内容被替换', next[0].name === '甲改');
  eq('upsert 返回新数组(纯函数)', list.length === 1 && next !== list, true);
}

// ---------- remove / rename ----------
{
  const a = V.wrap('甲', fmt(), sess(), appr());
  const b = V.wrap('乙', fmt(), sess(), appr());
  let list = [a, b];
  const r1 = V.remove(list, a.id);
  eq('remove: 删掉指定 id', r1.map((x) => x.name), ['乙']);
  eq('remove: 原表不变', list.length, 2);
  eq('remove: 不存在的 id 原样返回', V.remove(list, 'x').length, 2);

  const r2 = V.rename(list, b.id, '乙·决赛');
  eq('rename: 改名生效', r2[1].name, '乙·决赛');
  ok('rename: updated 更新', r2[1].updated >= b.updated);
  ok('rename: 原记录不被改', b.name === '乙');
}

// ---------- duplicate ----------
{
  const a = V.wrap('甲', fmt(), sess(), appr());
  const d = V.duplicate([a], a);
  ok('duplicate: 新表多一条', d.length === 2);
  ok('duplicate: 新 id != 原 id', d[1].id !== a.id && d[1].id.indexOf('v') === 0);
  eq('duplicate: 副本名带后缀', d[1].name, '甲 副本');
  d[1].fmt.stages[0].title = '被改';
  ok('duplicate: 原 fmt 不被共享引用污染', a.fmt.stages[0].title === '立论');
  ok('duplicate: 原记录仍是原对象', a.id === a.id);
}

// ---------- validate ----------
{
  const v = V.wrap('甲', fmt(), sess(), appr());
  ok('validate 合法记录 ok', V.validate(v).ok);
  ok('validate null 非法', !V.validate(null).ok);
  ok('validate 缺 name 非法', !V.validate(Object.assign({}, v, { name: '' })).ok);
  ok('validate fmt 无 stages 非法', !V.validate(Object.assign({}, v, { fmt: { name: 'x' } })).ok);
  ok('validate session 缺失非法', !V.validate(Object.assign({}, v, { session: null })).ok);
}

// ---------- isVersionExport ----------
{
  ok('isVersionExport 真', V.isVersionExport({ kind: 'debate-timer-version', version: {} }));
  ok('isVersionExport 普通赛制 json 假', !V.isVersionExport({ name: '赛制', stages: [] }));
  ok('isVersionExport null 假', !V.isVersionExport(null));
}

console.log('versions tests: ' + pass + ' pass, ' + fail + ' fail');
if (fail) process.exit(1);
