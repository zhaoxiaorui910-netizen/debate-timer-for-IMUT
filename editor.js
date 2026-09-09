// 辩论赛计时器 · 配置/编辑层
// 职责:localStorage 数据层、赛制列表与"可编辑副本"、逐环节表格编辑、
//      比赛信息字段、三页背景图上传压缩、导入导出 JSON。
// 暴露 window.DT:编辑器数据与当前工作赛制 cur;由 app.js 消费发起计时。
(function (root) {
  'use strict';
  const P = root.Presets;
  const V = root.Versions;   // 版本库纯逻辑(versions.js 定义)
  const $ = (id) => document.getElementById(id);
  const toast = (msg) => {
    const t = $('toast');
    t.textContent = msg; t.classList.remove('hidden');
    clearTimeout(toast._h); toast._h = setTimeout(() => t.classList.add('hidden'), 2600);
  };

  // ---------- 数据层(localStorage) ----------
  const K_CUSTOMS = 'dt.customs';
  const K_SESSION = 'dt.session';
  const K_VERSIONS = 'dt.versions';   // 版本库:每份完整配置一个版本
  const K_DRAFT = 'dt.draft';         // 自动草稿:关页/切换不丢工作
  const read = (k, d) => { try { const v = JSON.parse(localStorage.getItem(k)); return v == null ? d : v; } catch (e) { return d; } };
  const write = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { toast('保存失败:浏览器存储空间不足'); } };

  const DEF_SESSION = () => ({
    eventTitle: '', topic: '',
    teamName: { aff: '', neg: '' },
    art: { timer: null },
    bgPreset: { timer: null },  // 'blue'|'purple'|null(null=默认深绿)
  });
  // 读时向后兼容:旧记录可能仍带 art.cover/end 等键,保留但不再渲染;
  // 它们可在卡3用「封面/结束 置首·追加」一次性迁进图文行(见 ensureCover/ensureEnd)。

  const store = {
    customs() { return read(K_CUSTOMS, []); },
    saveCustoms(a) { write(K_CUSTOMS, a); },
    session() { return Object.assign(DEF_SESSION(), read(K_SESSION, {})); },
    saveSession(s) { write(K_SESSION, s); },
    versions() { return read(K_VERSIONS, []); },
    saveVersions(a) { write(K_VERSIONS, a); },
    draft() { return read(K_DRAFT, null); },
    saveDraft(d) { write(K_DRAFT, d); },
  };

  // ---------- 当前工作赛制 cur ----------
  // cur = { id: string|null(内置/新建时为 null), fmt: Format(可变副本),
  //         srcLabel: string, pristine: string(载入时 JSON,判脏) }
  const C = {
    cur: null,
    selKey: null,        // {kind:'builtin',i}|{kind:'custom',id}|{kind:'blank'}
    dirty: false,
    draftVid: null,      // 当前工作区挂在哪个版本上(null=尚未作为版本保存)
    draftName: '',       // 当前工作区显示名(版本名 / 草稿名)
    snapSess: null,      // 载入/保存版本瞬间的 session JSON,判"改了没存"
    snapApp: null,       // 同上,appearance JSON
  };
  const curFmt = () => C.cur.fmt;
  const blankFormat = () => {
    const mk = (st) => Object.assign({ id: '' }, st);
    return {
      name: '我的赛制', builtin: false,
      poolPerSideSec: { aff: 18 * 60, neg: 18 * 60 },
      warningSec: 30,
      stages: [
        P.contentSeg('image', '封面'),
        mk({ title: '正方一辩立论', type: 'statement', mode: 'fixed', affSec: 180, negSec: 0, leadSide: 'aff' }),
        mk({ title: '反方一辩立论', type: 'statement', mode: 'fixed', affSec: 0, negSec: 180, leadSide: 'neg' }),
        mk({ title: '自由辩论', type: 'free-debate', mode: 'fixed', affSec: 180, negSec: 180, leadSide: 'aff' }),
        P.contentSeg('image', '结束'),
      ].map((st, i) => Object.assign(st, { id: String(i) })),
    };
  };

  function setCur(fmt, id, srcLabel) {
    C.cur = { fmt: P.copyOf(fmt), id: id || null, srcLabel: srcLabel || fmt.name, pristine: JSON.stringify(fmt) };
    C.dirty = false;
  }
  const markDirty = () => {
    C.dirty = (JSON.stringify(C.cur.fmt) !== C.cur.pristine);
    if (C.dirty) noteWorkChanged();   // 改动即自动存草稿 + 刷版本区状态
  };

  // ---------- 列表渲染 ----------
  function renderList() {
    const el = $('format-list');
    const customs = store.customs();
    el.innerHTML = '';
    const mk = (label, tag, key, name) => {
      const d = document.createElement('button');
      d.className = 'fmt-chip' + (keyEq(C.selKey, key) ? ' sel' : '');
      d.innerHTML = '<span>' + esc(label) + '</span>' + (tag ? '<span class="tag">' + esc(tag) + '</span>' : '');
      d.title = name;
      d.onclick = () => loadKey(key);
      el.appendChild(d);
    };
    P.BUILTINS.forEach((b, i) => mk(b.name, '内置', { kind: 'builtin', i }, b.name));
    customs.forEach((c) => mk(c.name, '我的', { kind: 'custom', id: c.id }, c.name));
    mk('＋ 新建空白', '', { kind: 'blank' }, '');
    updateSrcLabel();
  }
  const keyEq = (a, b) => !!a && !!b && a.kind === b.kind && a.kind === 'builtin' ? a.i === b.i
    : a.kind === 'custom' ? a.id === b.id : a.kind === 'blank' && b.kind === 'blank';

  function updateSrcLabel() {
    const el = $('working-source');
    if (!C.cur) { el.textContent = ''; return; }
    const mark = C.dirty ? '· 已修改(未保存)' : '';
    el.textContent = '当前:' + C.cur.srcLabel + mark;
  }

  function loadKey(key) {
    if (C.dirty && C.cur && !confirm('当前赛制有未保存的修改,放弃并载入其他?')) return;
    C.selKey = key;
    if (key.kind === 'builtin') {
      setCur(P.BUILTINS[key.i], null, '内置·' + P.BUILTINS[key.i].name);
    } else if (key.kind === 'custom') {
      const c = store.customs().find((x) => x.id === key.id);
      if (!c) { C.selKey = { kind: 'builtin', i: 0 }; loadKey(C.selKey); return; }
      setCur(c, c.id, '自定义·' + c.name);
    } else {
      setCur(blankFormat(), null, '新建空白');
    }
    syncMetaUI();
    renderList();
    renderRows();
    updatePoolLine();
    updateSrcLabel();
    msg('');
    noteWorkChanged();
  }

  // 从值同步回输入框
  function syncMetaUI() {
    const f = curFmt();
    $('fmt-name').value = f.name;
    $('fmt-warning').value = String(f.warningSec == null ? 30 : f.warningSec);
    $('pool-aff').value = P.fmtSec(f.poolPerSideSec.aff);
    $('pool-neg').value = P.fmtSec(f.poolPerSideSec.neg);
  }
  // 环节类型分两组:计时(statement/cross-exam/free-debate) 与 内容(image/text)
  const TYPE_LABEL = { statement: '陈词', 'cross-exam': '质询', 'free-debate': '对辩', image: '图片', text: '文字' };
  const TYPE_GROUP = [['计时环节', P.TIMED_TYPES], ['内容环节', P.CONTENT_TYPES]];
  const MODE_OPTS = [['fixed', '固定'], ['pool', '预算']];

  // ---------- 环节表格 ----------
  function renderRows() {
    const tb = $('stage-rows');
    tb.innerHTML = '';
    curFmt().stages.forEach((st, i) => tb.appendChild(rowEl(st, i)));
  }

  function rowEl(st, i) {
    const content = P.isContent(st);
    const tr = document.createElement('tr');
    if (st.mode === 'pool') tr.className = 'row-pool';
    if (content) tr.classList.add('row-content');

    const tdNum = document.createElement('td'); tdNum.className = 'c-num'; tdNum.textContent = String(i + 1);

    // 环节名(+ 计时行的 固定/预算 切换)
    const name = document.createElement('input');
    name.type = 'text'; name.value = st.title; name.maxLength = 30;
    name.addEventListener('input', () => { st.title = name.value; markDirty(); });
    const nameBox = document.createElement('span'); nameBox.className = 'cell-name';
    nameBox.appendChild(name);
    if (!content) {
      const modeSel = document.createElement('select');
      MODE_OPTS.forEach(([v, l]) => { const o = document.createElement('option'); o.value = v; o.textContent = l; if (v === st.mode) o.selected = true; modeSel.appendChild(o); });
      modeSel.addEventListener('change', () => { st.mode = modeSel.value; markDirty(); renderRows(); updatePoolLine(); updateSrcLabel(); });
      nameBox.appendChild(modeSel);
    }
    const tdName = document.createElement('td'); tdName.appendChild(nameBox);

    // 类型(计时/内容 两组下拉)
    const typeSel = document.createElement('select');
    typeSel.className = 'type-sel ' + st.type;
    fillTypeSel(typeSel, st.type);
    typeSel.addEventListener('change', () => { st.type = typeSel.value; applyRowType(i); markDirty(); renderRows(); updatePoolLine(); updateSrcLabel(); });
    const tdType = document.createElement('td'); tdType.appendChild(typeSel);

    // 操作
    const ops = document.createElement('td');
    ops.className = 'c-ops';
    const up = opBtn('上', () => move(i, -1)), dn = opBtn('下', () => move(i, 1)), del = opBtn('删', () => removeRow(i));
    del.classList.add('op-del');
    ops.append(up, dn, del);

    if (content) { tr.append(tdNum, tdName, tdType, contentEditCell(st), ops); return tr; }

    // ---- 计时行:正方/反方时长 + 先手 ----
    const secInput = (side) => {
      const inp = document.createElement('input');
      inp.type = 'text'; inp.inputMode = 'numeric';
      inp.value = st.mode === 'pool' ? '' : P.fmtSec(st[side === 'aff' ? 'affSec' : 'negSec']);
      inp.placeholder = st.mode === 'pool' ? '共用预算' : '0:00';
      inp.disabled = st.mode === 'pool';
      inp.addEventListener('change', () => {
        const v = P.parseSec(inp.value);
        if (Number.isNaN(v)) { toast('时长格式无效,示例 3:30 或 210'); inp.value = P.fmtSec(st[side === 'aff' ? 'affSec' : 'negSec']); return; }
        st[side === 'aff' ? 'affSec' : 'negSec'] = Math.max(0, v);
        inp.value = P.fmtSec(st[side === 'aff' ? 'affSec' : 'negSec']);
        markDirty(); updateSrcLabel();
      });
      return inp;
    };
    const tdAff = document.createElement('td'); tdAff.appendChild(secInput('aff'));
    const tdNeg = document.createElement('td'); tdNeg.appendChild(secInput('neg'));

    const leadSel = document.createElement('select');
    [['aff', '正方'], ['neg', '反方']].forEach(([v, l]) => { const o = document.createElement('option'); o.value = v; o.textContent = l + '先'; if (v === st.leadSide) o.selected = true; leadSel.appendChild(o); });
    leadSel.addEventListener('change', () => { st.leadSide = leadSel.value; markDirty(); });
    const tdLead = document.createElement('td'); tdLead.appendChild(leadSel);

    tr.append(tdNum, tdName, tdType, tdAff, tdNeg, tdLead, ops);
    return tr;
  }

  function fillTypeSel(sel, cur) {
    sel.innerHTML = '';
    TYPE_GROUP.forEach(([gLabel, vals]) => {
      const og = document.createElement('optgroup'); og.label = gLabel;
      vals.forEach((v) => { const o = document.createElement('option'); o.value = v; o.textContent = TYPE_LABEL[v]; if (v === cur) o.selected = true; og.appendChild(o); });
      sel.appendChild(og);
    });
  }

  // 类型切换后把行整形成该类型的骨架:内容→fixed+0/0+负载;计时→补齐秒数/先手并去掉内容负载
  function applyRowType(i) {
    const a = curFmt().stages; const st = a[i];
    if (P.CONTENT_TYPES.indexOf(st.type) >= 0) { a[i] = P.normalizeStage(st); return; }
    const n = Object.assign({}, st);
    if (n.mode !== 'fixed' && n.mode !== 'pool') n.mode = 'fixed';
    if (!Number.isFinite(n.affSec) || n.affSec < 0) n.affSec = 120;
    if (!Number.isFinite(n.negSec) || n.negSec < 0) n.negSec = 120;
    if (n.leadSide !== 'aff' && n.leadSide !== 'neg') n.leadSide = 'aff';
    delete n.imageData; delete n.bg; delete n.text; delete n.textSize;
    a[i] = n;
  }

  // ---- 内容环节的编辑单元格(colspan 吃掉 时长×2+先手 三列) ----
  function contentEditCell(st) {
    const td = document.createElement('td'); td.colSpan = 3;
    const wrap = document.createElement('div'); wrap.className = 'c-edit';
    if (st.type === 'image') {
      imageEditor(st, wrap);
      wrap.title = '图片环节:全屏一整幅图(封面/结束),无文字、无计时';
    } else {
      textEditor(st, wrap);
      wrap.title = '文字环节:计时页背景 + 居中文字,顶部保留辩题/队名,无计时';
    }
    td.appendChild(wrap); return td;
  }
  function stageThumb(st) {
    const th = document.createElement('div'); th.className = 'art-thumb stage-thumb';
    paintStageThumb(th, st); return th;
  }
  function paintStageThumb(th, st) {
    th.classList.toggle('has', !!st.imageData);
    th.classList.toggle('th-blue', !st.imageData && st.bg === 'blue');
    th.classList.toggle('th-purple', !st.imageData && st.bg === 'purple');
    th.style.backgroundImage = st.imageData ? 'url("' + st.imageData + '")' : '';
  }
  function imageEditor(st, wrap) {
    const th = stageThumb(st);
    const file = document.createElement('input'); file.type = 'file'; file.accept = 'image/*'; file.hidden = true;
    const up = document.createElement('button'); up.type = 'button'; up.className = 'btn btn-small'; up.textContent = '上传图片';
    up.addEventListener('click', () => file.click());
    file.addEventListener('change', (ev) => {
      const f = ev.target.files && ev.target.files[0]; if (!f) return;
      compressImage(f, (url) => { st.imageData = url; st.bg = null; paintStageThumb(th, st); markDirty(); updateSrcLabel(); });
      ev.target.value = '';
    });
    const clear = document.createElement('button'); clear.type = 'button'; clear.className = 'btn btn-small'; clear.textContent = '清除图';
    clear.addEventListener('click', () => { st.imageData = null; paintStageThumb(th, st); markDirty(); updateSrcLabel(); });
    const chips = document.createElement('span'); chips.className = 'ap-chips row-chips';
    const curBg = () => (st.imageData ? '__img' : (st.bg || ''));
    [['', '默认底'], ['blue', '夜色'], ['purple', '烟紫']].forEach(([val, label]) => {
      const b = document.createElement('button'); b.type = 'button'; b.className = 'ap-chip'; b.textContent = label;
      const paint = () => b.classList.toggle('sel', curBg() === val);
      paint();
      b.addEventListener('click', () => { st.imageData = null; st.bg = val === '' ? null : val; paintStageThumb(th, st); paint(); markDirty(); updateSrcLabel(); });
      chips.appendChild(b);
    });
    wrap.append(th, file, up, clear, chips);
  }
  function textEditor(st, wrap) {
    const ta = document.createElement('textarea'); ta.className = 'c-text'; ta.maxLength = 1000; ta.rows = 3;
    ta.placeholder = '输入本环节要显示的文字,可换行';
    ta.value = typeof st.text === 'string' ? st.text : '';
    ta.addEventListener('input', () => { st.text = ta.value; markDirty(); });
    const sizeSel = document.createElement('select');
    [['0.75', '小'], ['1', '中'], ['1.3', '大']].forEach(([v, l]) => { const o = document.createElement('option'); o.value = v; o.textContent = l; o.selected = String(st.textSize) === v; sizeSel.appendChild(o); });
    sizeSel.addEventListener('change', () => { st.textSize = Number(sizeSel.value); markDirty(); updateSrcLabel(); });
    const meta = document.createElement('span'); meta.className = 'muted'; meta.textContent = '字号 ';
    const hint = document.createElement('span'); hint.className = 'muted'; hint.textContent = '背景 = 计时页全局背景(卡4)';
    wrap.append(ta, meta, sizeSel, hint);
  }
  function opBtn(label, fn) {
    const b = document.createElement('button');
    b.className = 'op-btn'; b.textContent = label; b.type = 'button'; b.onclick = fn; return b;
  }
  function move(i, d) {
    const a = curFmt().stages; const j = i + d;
    if (j < 0 || j >= a.length) return;
    const t = a[i]; a[i] = a[j]; a[j] = t;
    markDirty(); renderRows(); updateSrcLabel();
  }
  function removeRow(i) {
    curFmt().stages.splice(i, 1); markDirty(); renderRows(); updateSrcLabel();
  }
  // 新增环节:type 决定骨架——statement 计时段 / image / text 内容段(经 contentSeg,恒 fixed 0/0)
  function addRow(type) {
    type = type || 'statement';
    let st;
    if (type === 'image' || type === 'text') {
      st = P.contentSeg(type, type === 'image' ? '新图片页' : '新文字页');
    } else {
      st = { title: '新环节', type: 'statement', mode: 'fixed', affSec: 120, negSec: 120, leadSide: 'aff' };
    }
    st.id = String(Date.now());
    curFmt().stages.push(st);
    markDirty(); renderRows(); updatePoolLine(); updateSrcLabel();
    const rows = $('stage-rows').children;
    if (rows.length) {
      const el = rows[rows.length - 1];
      const inp = el.querySelector('input, textarea');
      if (inp) inp.focus();
    }
  }
  // 「全部改为预算共用」:内容环节(图文/文字)恒为 fixed,不可改预算,须跳过
  function poolAll() {
    curFmt().stages.forEach((st) => { if (!P.isContent(st)) st.mode = 'pool'; });
    markDirty(); renderRows(); updatePoolLine(); updateSrcLabel();
  }
  function updatePoolLine() {
    const has = curFmt() && curFmt().stages.some((s) => s.mode === 'pool');
    $('budget-line').classList.toggle('hidden', !has);
  }
  function msg(text) { $('edit-msg').textContent = text || ''; }

  // ---- 封面/结束 图文行:首行/末行已是 image 则复用(把旧「卡4 封面/结束图」迁入,仅迁则清旧),
  //      否则插入一个新的 image 行。只有实际迁移时才会清空 session.art[key],避免静默删数据。 ----
  function ensureCover() {
    const a = curFmt().stages;
    const s = store.session();
    const legacy = (s.art && s.art.cover) || null;
    let row = (a.length && a[0].type === 'image') ? a[0] : null;
    let inserted = false;
    if (!row) { row = Object.assign(P.contentSeg('image', '封面'), { id: String(Date.now()) }); a.unshift(row); inserted = true; }
    let migrated = false;
    if (legacy && !row.imageData) { row.imageData = legacy; migrated = true; }
    if (migrated) { s.art.cover = null; store.saveSession(s); }
    if (!inserted && !migrated) { toast('首行已是图文封面页,无需再插'); return; }
    markDirty(); renderRows(); updatePoolLine(); updateSrcLabel();
    msg(migrated ? '封面行已就位,并把旧「卡4 封面图」迁入该行' : '已在首行插入图文封面页');
  }
  function ensureEnd() {
    const a = curFmt().stages;
    const s = store.session();
    const legacy = (s.art && s.art.end) || null;
    let row = (a.length && a[a.length - 1].type === 'image') ? a[a.length - 1] : null;
    let inserted = false;
    if (!row) { row = Object.assign(P.contentSeg('image', '结束'), { id: String(Date.now()) }); a.push(row); inserted = true; }
    let migrated = false;
    if (legacy && !row.imageData) { row.imageData = legacy; migrated = true; }
    if (migrated) { s.art.end = null; store.saveSession(s); }
    if (!inserted && !migrated) { toast('末行已是图文结束页,无需再插'); return; }
    markDirty(); renderRows(); updatePoolLine(); updateSrcLabel();
    msg(migrated ? '结束行已就位,并把旧「卡4 结束页图」迁入该行' : '已在末行插入图文结束页');
  }

  // ---------- 保存/导入/导出 ----------
  function saveCustom() {
    const f = curFmt();
    let name = (f.name || '').trim();
    if (!name) { toast('请先给赛制起个名字'); return; }
    const isBuiltinName = P.BUILTINS.some((b) => b.name === name);
    if (isBuiltinName) name = name + '(我的)';           // 避免与内置混淆
    f.name = name;
    const customs = store.customs();
    const clash = customs.find((c) => c.name === name && (!C.cur.id || c.id !== C.cur.id));
    if (clash) {
      if (!confirm('已存在同名赛制「' + name + '」,覆盖它?')) return;
    }
    const rec = { id: clash ? clash.id : C.cur.id || ('c' + Date.now() + Math.floor(Math.random() * 1e4)) };
    delete f.builtin;
    const body = Object.assign({ builtin: false }, f);
    const merged = Object.assign(rec, body);
    let saved = false;
    const next = customs.map((c) => { if (c.id === merged.id) { saved = true; return merged; } return c; });
    store.saveCustoms(saved ? next : next.concat([merged]));
    C.cur.id = merged.id;
    C.cur.pristine = JSON.stringify(merged);
    C.cur.srcLabel = '自定义·' + name;
    C.selKey = { kind: 'custom', id: merged.id };
    C.dirty = false;
    renderList(); syncMetaUI(); updateSrcLabel();
    noteWorkChanged();
    toast('已保存「' + name + '」');
  }

  function doExport() {
    const f = P.copyOf(curFmt());
    const blob = new Blob([JSON.stringify(f, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = (f.name || '赛制').replace(/[\\/:*?"<>|]/g, '_') + '.json';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 800);
  }
  function doImport(file) {
    if (!file) return;
    const r = new FileReader();
    r.onload = () => {
      let data; try { data = JSON.parse(r.result); } catch (e) { toast('文件不是合法 JSON'); return; }
      if (V.isVersionExport(data)) { addVersionJson(data.version); return; }
      const v = P.validate(data);
      if (!v.ok) { toast('校验未通过:' + (v.errors[0] || '')); return; }
      data = P.copyOf(data);
      if (!data.name || !(data.name.trim())) data.name = file.name.replace(/\.json$/i, '');
      if (C.dirty && C.cur && !confirm('覆盖当前编辑内容?')) return;
      setCur(data, null, '导入·' + data.name);
      C.selKey = { kind: 'blank' };
      syncMetaUI(); renderList(); renderRows(); updatePoolLine(); updateSrcLabel();
      noteWorkChanged();
      toast('已导入「' + data.name + '」');
    };
    r.onerror = () => toast('读取文件失败');
    r.readAsText(file);
  }
  function deleteCustom() {
    if (!C.selKey || C.selKey.kind !== 'custom') { toast('当前不是我的赛制,无需删除'); return; }
    if (!confirm('删除自定义赛制?')) return;
    const customs = store.customs().filter((c) => c.id !== C.selKey.id);
    store.saveCustoms(customs);
    C.selKey = { kind: 'builtin', i: 0 };
    loadKey(C.selKey);
    toast('已删除');
  }

  // ---------- 比赛信息 & 图片 ----------
  function bindSessionFields() {
    const s = store.session();
    $('set-event').value = s.eventTitle; $('set-topic').value = s.topic;
    $('set-aff').value = s.teamName.aff; $('set-neg').value = s.teamName.neg;
    const save = () => { const s2 = store.session(); s2.eventTitle = $('set-event').value; s2.topic = $('set-topic').value; s2.teamName.aff = $('set-aff').value; s2.teamName.neg = $('set-neg').value; store.saveSession(s2); noteWorkChanged(); };
    ['set-event', 'set-topic', 'set-aff', 'set-neg'].forEach((id) => $(id).addEventListener('change', save));
  }
  const TH_CLASSES = ['th-blue', 'th-purple'];
  const BGB_OPT = [['green', '墨绿'], ['blue', '夜色'], ['purple', '烟紫']];
  function syncBgChips(key) {
    const box = $('bgp-' + key); if (!box) return;
    const s = store.session();
    const cur = (s.art && s.art[key]) ? 'none' : ((s.bgPreset && s.bgPreset[key]) || 'green');
    Array.prototype.forEach.call(box.querySelectorAll('.ap-chip'), (b, i) => {
      b.classList.toggle('sel', BGB_OPT[i][0] === cur);
    });
  }
  function thumbOf(key) {
    const s = store.session();
    const thumb = $('art-' + key + '-thumb');
    if (!thumb) return;
    const url = s.art[key];
    const preset = s.bgPreset && s.bgPreset[key];
    TH_CLASSES.forEach((c) => thumb.classList.remove(c));
    thumb.classList.toggle('has', !!url);
    if (url) { thumb.style.backgroundImage = 'url("' + url + '")'; }
    else { thumb.style.backgroundImage = ''; if (preset) thumb.classList.add('th-' + preset); }
    syncBgChips(key);
  }
  function buildBgPresets() {
    ['timer'].forEach((key) => {
      const box = $('bgp-' + key); if (!box) return;
      box.innerHTML = '';
      BGB_OPT.forEach(([id, label]) => {
        const b = document.createElement('button');
        b.type = 'button'; b.className = 'ap-chip'; b.textContent = label;
        b.addEventListener('click', () => {
          const s = store.session();
          s.art[key] = null;
          s.bgPreset[key] = id === 'green' ? null : id;
          store.saveSession(s); thumbOf(key);
          if (window.AppAPI && AppAPI.onArtChange) AppAPI.onArtChange(key, id);
          toast('已用内置「' + label + '」背景');
        });
        box.appendChild(b);
      });
      syncBgChips(key);
    });
  }
  function bindArt() {
    const files = { timer: 'file-timer' };
    Object.keys(files).forEach((key) => {
      $(files[key]).addEventListener('change', (ev) => {
        const file = ev.target.files && ev.target.files[0];
        if (!file) return;
        compressImage(file, (url) => {
          const s = store.session(); s.art[key] = url; s.bgPreset[key] = null; store.saveSession(s); thumbOf(key);
          if (window.AppAPI && AppAPI.onArtChange) AppAPI.onArtChange(key, url);
          toast('已更新' + (key === 'timer' ? '计时' : key) + '背景');
        });
        ev.target.value = '';
      });
      thumbOf(key);
    });
    document.querySelectorAll('[data-art-reset]').forEach((b) => {
      b.addEventListener('click', () => {
        const key = b.getAttribute('data-art-reset');
        const s = store.session(); s.art[key] = null; s.bgPreset[key] = null; store.saveSession(s); thumbOf(key);
        if (window.AppAPI && AppAPI.onArtChange) AppAPI.onArtChange(key, null);
        toast('已清除背景,用回默认');
      });
    });
    buildBgPresets();
  }
  function compressImage(file, cb) {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const MAX = 1920;
      let { width: w, height: h } = img;
      if (Math.max(w, h) > MAX) { const k = MAX / Math.max(w, h); w = Math.round(w * k); h = Math.round(h * k); }
      const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
      cv.getContext('2d').drawImage(img, 0, 0, w, h);
      URL.revokeObjectURL(url);
      cb(cv.toDataURL('image/jpeg', 0.82));
    };
    img.onerror = () => { URL.revokeObjectURL(url); toast('图片无法读取'); };
    img.src = url;
  }

  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // ---------- 投屏外观(卡4):存储 + 假屏拖拽 + 控件 ----------
  const K_APPEAR = 'dt.appearance';
  const AP_GROUPS = [
    ['time', '计时数字'], ['stage', '环节名'], ['topic', '辩题'],
    ['teams', '队伍名'], ['state', '时间到提示'],
  ];
  const AP_TOPIC_PRESETS = [
    { l: '顶部·左', y: 7, a: 'left' }, { l: '顶部·中', y: 7, a: 'center' }, { l: '顶部·右', y: 7, a: 'right' },
    { l: '底部·左', y: 90, a: 'left' }, { l: '底部·中', y: 90, a: 'center' }, { l: '底部·右', y: 90, a: 'right' },
    { l: '默认', y: null, a: null },
  ];
  const AP_TEAMS_PRESETS = [
    { l: '顶部', y: 16 }, { l: '底部', y: 92 }, { l: '默认', y: null },
  ];
  const APPEAR = {
    state() { return Appearance.normalize(read(K_APPEAR, null)); },
    get() { return this.state(); },
    save(a) { write(K_APPEAR, a); afterWorkingChange(); },
    clear() { try { localStorage.removeItem(K_APPEAR); } catch (e) { /* ignore */ } afterWorkingChange(); },
  };
  const ap = $;
  const clampN = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const apXOf = (align) => (align === 'left' ? 12 : align === 'right' ? 88 : 50);

  function apPaint() {
    const a = APPEAR.state();
    const topic = a.pos.topic || { y: 8, align: 'center' };
    const teams = a.pos.teams || { y: 20 };
    const tEl = ap('ap-drag-topic'), gEl = ap('ap-drag-teams');
    if (!tEl || !gEl) return;
    tEl.style.left = apXOf(topic.align) + '%'; tEl.style.top = topic.y + '%';
    gEl.style.left = '50%'; gEl.style.top = teams.y + '%';
    tEl.style.color = a.style.topic.color;
    gEl.style.color = a.style.teams.color;
    tEl.style.fontSize = Appearance.fontCss('topic', a.style.topic.size) || '';
    gEl.style.fontSize = Appearance.fontCss('teams', a.style.teams.size) || '';
  }
  function apChipEq(p, cur, kind) {
    if (p.y == null) return cur == null;
    if (cur == null) return false;
    return p.y === cur.y && (kind === 'topic' ? p.a === cur.align : true);
  }
  function apSyncChips() {
    const a = APPEAR.state();
    const mark = (containerId, presets, cur, kind) => {
      const box = ap(containerId); if (!box) return;
      Array.prototype.forEach.call(box.querySelectorAll('.ap-chip'), (b, i) => {
        b.classList.toggle('sel', apChipEq(presets[i], cur, kind));
      });
    };
    mark('ap-preset-topic', AP_TOPIC_PRESETS, a.pos.topic, 'topic');
    mark('ap-preset-teams', AP_TEAMS_PRESETS, a.pos.teams, 'teams');
  }
  function apBuildChipGroup(containerId, presets, kind) {
    const box = ap(containerId); if (!box) return;
    box.innerHTML = '';
    const label = document.createElement('span');
    label.className = 'ap-chips-label';
    label.textContent = kind === 'topic' ? '辩题位置:' : '队伍名位置:';
    box.appendChild(label);
    presets.forEach((p) => {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'ap-chip'; b.textContent = p.l;
      b.addEventListener('click', () => {
        const a = APPEAR.state();
        if (p.y == null) a.pos[kind] = null;
        else if (kind === 'topic') a.pos[kind] = { y: p.y, align: p.a };
        else a.pos[kind] = { y: p.y };
        APPEAR.save(a); apSyncChips(); apPaint();
        apMsg(p.l === '默认' ? '已恢复该元素默认位置' : '已设为「' + p.l + '」,开始比赛后生效');
      });
      box.appendChild(b);
    });
  }
  function apBuildStyles() {
    const box = ap('ap-style-rows'); if (!box) return;
    box.innerHTML = '';
    AP_GROUPS.forEach(([key, name]) => {
      const row = document.createElement('div'); row.className = 'ap-srow';
      const nm = document.createElement('span'); nm.className = 'ap-sname'; nm.textContent = name;
      const color = document.createElement('input'); color.type = 'color'; color.dataset.key = key;
      const rng = document.createElement('input'); rng.type = 'range'; rng.min = '50'; rng.max = '200'; rng.step = '5'; rng.dataset.key = key;
      const val = document.createElement('span'); val.className = 'ap-sval';
      const reset = document.createElement('button'); reset.type = 'button'; reset.className = 'ap-restore'; reset.textContent = '还原';
      row.append(nm, color, rng, val, reset);
      color.addEventListener('change', () => {
        const a = APPEAR.state(); a.style[key].color = color.value; APPEAR.save(a); apPaint();
        apMsg('已更新「' + name + '」颜色');
      });
      rng.addEventListener('input', () => { val.textContent = rng.value + '%'; });
      rng.addEventListener('change', () => {
        const a = APPEAR.state(); a.style[key].size = Number(rng.value) / 100; APPEAR.save(a); apPaint();
        apMsg('已更新「' + name + '」字号');
      });
      reset.addEventListener('click', () => {
        const a = APPEAR.state();
        a.style[key] = { color: Appearance.DEFAULT_COLOR, size: 1 };
        APPEAR.save(a); apSyncControls(); apMsg('已还原「' + name + '」样式');
      });
      box.appendChild(row);
    });
  }
  function apSyncStyles() {
    const a = APPEAR.state();
    document.querySelectorAll('#ap-style-rows .ap-srow').forEach((row) => {
      const colorIn = row.querySelector('input[type=color]');
      const key = colorIn.dataset.key;
      const s = a.style[key];
      colorIn.value = s.color;
      const rng = row.querySelector('input[type=range]');
      rng.value = String(Math.round(s.size * 100));
      row.querySelector('.ap-sval').textContent = Math.round(s.size * 100) + '%';
    });
  }
  function apSyncControls() {
    const a = APPEAR.state();
    const sh = ap('ap-shadow'); if (sh) sh.checked = a.shadow;
    apSyncStyles(); apSyncChips(); apPaint();
  }
  function apMsg(text) {
    const m = ap('ap-msg'); if (!m) return;
    m.textContent = text;
    clearTimeout(apMsg._t); apMsg._t = setTimeout(() => { m.textContent = ''; }, 2200);
  }
  function apBindDrag() {
    const canvas = ap('ap-preview'); if (!canvas) return;
    [['ap-drag-topic', 'topic'], ['ap-drag-teams', 'teams']].forEach(([id, kind]) => {
      const el = document.getElementById(id); if (!el) return;
      el.addEventListener('pointerdown', (ev) => {
        ev.preventDefault();
        el.dataset.drag = '1'; el.classList.add('dragging');
        try { el.setPointerCapture(ev.pointerId); } catch (e) { /* ignore */ }
      });
      el.addEventListener('pointermove', (ev) => {
        if (el.dataset.drag !== '1') return;
        const r = canvas.getBoundingClientRect();
        const x = clampN((ev.clientX - r.left) / r.width * 100, 0, 100);
        const y = Math.round(Appearance.clampY((ev.clientY - r.top) / r.height * 100, 34, 56) * 10) / 10;
        const a = APPEAR.state();
        if (kind === 'topic') {
          a.pos.topic = { y, align: x < 30 ? 'left' : x > 70 ? 'right' : 'center' };
        } else { a.pos.teams = { y }; }
        APPEAR.save(a); apSyncChips(); apPaint();
      });
      const endDrag = (ev) => {
        if (el.dataset.drag !== '1') return;
        el.dataset.drag = ''; el.classList.remove('dragging');
        try { el.releasePointerCapture(ev.pointerId); } catch (e) { /* ignore */ }
      };
      el.addEventListener('pointerup', endDrag);
      el.addEventListener('pointercancel', endDrag);
    });
  }

  // ---------- 版本 / 自动草稿 ----------
  const deep = V.clone;
  const isBlankNew = () => (C.draftVid == null && !C.draftName);

  function sessionHasContent() {
    const s = store.session();
    const art = s.art || {}, bgp = s.bgPreset || {};
    return !!(s.eventTitle || s.topic || (s.teamName && (s.teamName.aff || s.teamName.neg)) ||
      art.timer || bgp.timer);
  }

  // 是否有还没存进版本库的修改
  function versionDirty() {
    if (C.dirty) return true;                       // fmt 与载入基线不同
    if (C.snapSess != null && JSON.stringify(store.session()) !== C.snapSess) return true;
    if (C.snapApp != null && JSON.stringify(APPEAR.state()) !== C.snapApp) return true;
    if (isBlankNew()) return sessionHasContent() || !Appearance.isDefault(APPEAR.state());
    return false;
  }

  function persistDraft() {
    if (!C.cur) return;
    clearTimeout(persistDraft._t);
    persistDraft._t = setTimeout(() => {
      store.saveDraft({ vid: C.draftVid, name: C.draftName || '', fmt: curFmt() });
    }, 350);
  }

  function refreshWorkingUI() {
    const open = $('ver-open');
    const saveB = $('btn-ver-save');
    const dirty = versionDirty();
    if (open) {
      let t;
      if (isBlankNew()) t = dirty ? '当前:空白草稿(有新内容,未保存为版本)' : '当前:空白草稿(尚未保存为版本)';
      else t = '当前版本:' + (C.draftName || '') + (dirty ? ' · 有未保存修改' : ' · 已保存');
      open.textContent = t;
    }
    if (saveB) saveB.textContent = isBlankNew() ? '保存为新版本' : '保存/覆盖当前版本';
  }
  function afterWorkingChange() { persistDraft(); refreshWorkingUI(); }
  function noteWorkChanged() { afterWorkingChange(); }

  // 把 session 输入框与背景缩略图刷成当前工作 session(版本载入/空白新建用)
  function repaintSessionUI() {
    const s = store.session();
    $('set-event').value = s.eventTitle || '';
    $('set-topic').value = s.topic || '';
    $('set-aff').value = (s.teamName && s.teamName.aff) || '';
    $('set-neg').value = (s.teamName && s.teamName.neg) || '';
    thumbOf('timer');
  }

  // 把版本 V 完整载入工作区:fmt + session + appearance 全部落到现行键并重绘编辑 UI
  function applyVersion(v) {
    if (!v) return;
    setCur(v.fmt, null, '版本·' + v.name);
    C.draftVid = v.id;
    C.draftName = v.name;
    C.snapSess = JSON.stringify(v.session || {});
    C.snapApp = JSON.stringify(v.appearance || {});
    store.saveSession(Object.assign(DEF_SESSION(), deep(v.session || {})));
    APPEAR.save(v.appearance == null ? null : deep(v.appearance));  // 会触发 noteWorkChanged
    syncMetaUI(); renderList(); renderRows(); updatePoolLine(); updateSrcLabel(); msg('');
    repaintSessionUI(); apSyncControls(); renderVersionList(); refreshWorkingUI();
  }

  function saveVersion() {
    const existing = C.draftVid != null ? V.find(store.versions(), C.draftVid) : null;
    let name;
    if (existing) {
      if (!confirm('覆盖版本「' + existing.name + '」? (赛制/比赛信息/背景/外观整份替换)')) return;
      name = existing.name;
    } else {
      const fallback = (store.session().eventTitle || '').trim() || '未命名比赛';
      name = (prompt('给这份版本起个名字(主页显示,常写第几场/哪场):', fallback) || '').trim();
      if (!name) { toast('已取消保存'); return; }
    }
    const rec = existing ? V.clone(existing) : V.wrap(name, curFmt(), store.session(), APPEAR.state());
    rec.name = name; rec.updated = Date.now();
    rec.fmt = P.copyOf(curFmt());
    rec.session = Object.assign(DEF_SESSION(), store.session());
    rec.appearance = APPEAR.state();
    store.saveVersions(V.upsert(store.versions(), rec));
    C.draftVid = rec.id; C.draftName = name;
    C.snapSess = JSON.stringify(rec.session);
    C.snapApp = JSON.stringify(rec.appearance);
    C.cur.pristine = JSON.stringify(rec.fmt);
    C.cur.srcLabel = '版本·' + name;
    C.dirty = false;
    renderList(); renderVersionList(); syncMetaUI(); updateSrcLabel();
    noteWorkChanged();
    toast(existing ? '已覆盖版本「' + name + '」' : '已保存新版本「' + name + '」');
  }

  function confirmDiscard(why) {
    if (!C.cur || !versionDirty()) return true;
    return confirm((why || '此操作') + '会丢失当前未保存到版本的修改,继续?');
  }

  function startVersion(v) {
    if (C.draftVid !== v.id) {
      if (!confirmDiscard('切到版本「' + v.name + '」')) return;
      applyVersion(v);
    }
    const b = $('btn-start'); if (b) b.click();
  }
  function editVersion(v) {
    if (C.draftVid === v.id) {
      if (versionDirty() && !confirm('「' + v.name + '」有未保存修改,放弃改动并重新载入?')) return;
    } else if (!confirmDiscard('切到版本「' + v.name + '」')) return;
    applyVersion(v);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function dlJson(name, obj) {
    const blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = (name || '下载').replace(/[\\/:*?"<>|]/g, '_') + '.json';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 800);
  }
  function exportVersion(v) { dlJson(v.name, { kind: V.KIND, version: V.clone(v) }); }
  function renameVersion(v) {
    const n = (prompt('新版本名(主页显示):', v.name) || '').trim();
    if (!n) { toast('名字不能为空'); return; }
    if (n === v.name) return;
    store.saveVersions(V.rename(store.versions(), v.id, n));
    if (C.draftVid === v.id) { C.draftName = n; }
    renderVersionList(); noteWorkChanged(); toast('已改名「' + n + '」');
  }
  function dupVersion(v) {
    store.saveVersions(V.duplicate(store.versions(), v));
    renderVersionList(); toast('已复制「' + v.name + ' 副本」');
  }
  function delVersion(v) {
    if (!confirm('删除版本「' + v.name + '」? 该份完整配置将从本机移除(自定义赛制模板不受影响)。')) return;
    store.saveVersions(V.remove(store.versions(), v.id));
    if (C.draftVid === v.id) {
      C.draftVid = null; C.draftName = '';
      C.dirty = false;
      C.snapSess = JSON.stringify(store.session());
      C.snapApp = JSON.stringify(APPEAR.state());
    }
    renderVersionList(); noteWorkChanged(); toast('已删除');
  }

  function addVersionJson(raw) {
    const cv = V.validate(raw);
    if (!cv.ok) { toast('版本文件不完整:' + (cv.errors[0] || '')); return; }
    const fv = P.validate(raw.fmt);
    if (!fv.ok) { toast('版本内赛制无效:' + (fv.errors[0] || '')); return; }
    const rec = V.clone(raw);
    rec.id = V.newId(); rec.updated = Date.now();
    rec.name = (rec.name || '').trim() || '未命名比赛';
    rec.fmt = P.copyOf(rec.fmt);
    rec.session = Object.assign(DEF_SESSION(), rec.session || {});
    rec.appearance = Appearance.normalize(rec.appearance == null ? null : rec.appearance);
    store.saveVersions(V.upsert(store.versions(), rec));
    renderVersionList(); toast('已导入版本「' + rec.name + '」');
  }
  function importVersionFile(file) {
    if (!file) return;
    const r = new FileReader();
    r.onload = () => {
      let d; try { d = JSON.parse(r.result); } catch (e) { toast('文件不是合法 JSON'); return; }
      if (!V.isVersionExport(d)) { toast('该文件不是完整版本。只含赛制的文件请用「卡2 导入赛制 JSON」。'); return; }
      addVersionJson(d.version);
    };
    r.onerror = () => toast('读取文件失败');
    r.readAsText(file);
  }

  function rowBtn(label, cls, fn) {
    const b = document.createElement('button');
    b.type = 'button'; b.textContent = label;
    b.className = cls ? ('btn ' + cls) : 'btn btn-small';
    b.onclick = fn;
    return b;
  }
  function renderVersionList() {
    const box = $('version-list'); if (!box) return;
    const list = store.versions();
    box.innerHTML = '';
    if (!list.length) {
      const em = document.createElement('div');
      em.className = 'ver-empty';
      em.textContent = '还没有已保存的版本。配置好后点下方「保存为新版本」即在此列出。';
      box.appendChild(em);
      return;
    }
    list.forEach((v) => {
      const row = document.createElement('div');
      row.className = 'ver-item' + (C.draftVid === v.id ? ' sel' : '');
      const main = document.createElement('div'); main.className = 'ver-main';
      const nm = document.createElement('span'); nm.className = 'ver-name'; nm.textContent = v.name;
      const dt = new Date(v.updated || Date.now());
      const p2 = (n) => String(n).padStart(2, '0');
      const upd = document.createElement('span'); upd.className = 'ver-upd';
      upd.textContent = (dt.getMonth() + 1) + '-' + p2(dt.getDate()) + ' ' + p2(dt.getHours()) + ':' + p2(dt.getMinutes());
      main.append(nm, upd);
      const act = document.createElement('div'); act.className = 'ver-actions';
      act.appendChild(rowBtn('▶ 开始', 'ver-go', () => startVersion(v)));
      act.appendChild(rowBtn('修改', 'btn-small', () => editVersion(v)));
      act.appendChild(rowBtn('改名', 'btn-small', () => renameVersion(v)));
      act.appendChild(rowBtn('复制', 'btn-small', () => dupVersion(v)));
      act.appendChild(rowBtn('导出', 'btn-small', () => exportVersion(v)));
      act.appendChild(rowBtn('删除', 'btn-small btn-danger', () => delVersion(v)));
      row.append(main, act);
      box.appendChild(row);
    });
  }

  function blankNew() {
    if (!confirmDiscard('新建空白版本')) return;
    const s = DEF_SESSION();
    store.saveSession(s);
    APPEAR.clear();
    const fb = P.BUILTINS[0];
    setCur(fb, null, '内置·' + fb.name);
    C.draftVid = null; C.draftName = '';
    C.dirty = false;
    C.snapSess = JSON.stringify(s);
    C.snapApp = JSON.stringify(Appearance.normalize(null));
    syncMetaUI(); renderList(); renderRows(); updatePoolLine(); updateSrcLabel();
    repaintSessionUI(); apSyncControls(); renderVersionList(); refreshWorkingUI();
    persistDraft();
    window.scrollTo({ top: 0, behavior: 'smooth' });
    toast('已清空为空白草稿,可开始配置新的一场');
  }

  // 打开页面时决定工作区:老数据迁移种子 → 或恢复上次草稿 → 或全新默认
  function bootstrapWorking() {
    const versions = store.versions();
    const draft = store.draft();
    if (!draft && !versions.length) {
      const liveHas = sessionHasContent() || !Appearance.isDefault(APPEAR.state());
      if (liveHas) {
        setCur(P.BUILTINS[0], null, '内置·' + P.BUILTINS[0].name);
        C.selKey = { kind: 'builtin', i: 0 };
        const s = store.session(), ap = APPEAR.state();
        const rec = V.wrap((s.eventTitle || '').trim() || '未命名比赛', curFmt(), s, ap);
        store.saveVersions(V.upsert(versions, rec));
        C.draftVid = rec.id; C.draftName = rec.name;
        C.snapSess = JSON.stringify(rec.session); C.snapApp = JSON.stringify(rec.appearance);
        C.cur.pristine = JSON.stringify(rec.fmt);
        store.saveDraft({ vid: rec.id, name: rec.name, fmt: curFmt() });   // 立刻落草稿,下次打开可恢复
        return;
      }
    }
    if (draft && draft.fmt && draft.fmt.stages && draft.fmt.name) {
      const version = draft.vid ? V.find(versions, draft.vid) : null;
      setCur(draft.fmt, null, version ? '版本·' + version.name : (draft.fmt.name || '草稿'));
      C.selKey = { kind: 'blank' };
      C.draftVid = version ? draft.vid : null;
      C.draftName = version ? version.name : (draft.name || '');
      if (version) {
        C.cur.pristine = JSON.stringify(version.fmt);          // 基线=版本里存的,才能判"改过没"
        C.snapSess = JSON.stringify(version.session || {});
        C.snapApp = JSON.stringify(version.appearance || {});
      } else {
        C.snapSess = JSON.stringify(store.session());
        C.snapApp = JSON.stringify(APPEAR.state());
      }
      C.dirty = JSON.stringify(curFmt()) !== C.cur.pristine;
      return;
    }
    setCur(P.BUILTINS[0], null, '内置·' + P.BUILTINS[0].name);
    C.selKey = { kind: 'builtin', i: 0 };
    C.draftVid = null; C.draftName = '';
    C.snapSess = JSON.stringify(store.session());
    C.snapApp = JSON.stringify(APPEAR.state());
  }

  // ---------- 对外:供 app 使用 ----------
  const API = {
    store, curFmt, markDirty,
    sessionCopy() { return store.session(); },
    currentCopy() { return P.copyOf(curFmt()); },
    validateCurrent() { return P.validate(curFmt()); },
    appearanceStore: APPEAR,
    init() {
      if (C.cur) return;
      bootstrapWorking();          // 迁移种子/恢复草稿/全新默认 → 定 C.cur + 挂载版本 + 快照
      bindSessionFields(); bindArt();
      apBuildChipGroup('ap-preset-topic', AP_TOPIC_PRESETS, 'topic');
      apBuildChipGroup('ap-preset-teams', AP_TEAMS_PRESETS, 'teams');
      apBuildStyles(); apBindDrag();
      const shadowBox = $('ap-shadow');
      if (shadowBox) shadowBox.addEventListener('change', () => {
        const a = APPEAR.state(); a.shadow = shadowBox.checked; APPEAR.save(a);
        apMsg(shadowBox.checked ? '已开启文字投影' : '已关闭文字投影(浅背景时更干净)');
      });
      const resetBtn = $('btn-ap-reset');
      if (resetBtn) resetBtn.addEventListener('click', () => {
        APPEAR.clear(); apSyncControls(); apMsg('已恢复默认外观');
      });
      apSyncControls();
      $('btn-add').onclick = () => addRow('statement');
      $('btn-add-img').onclick = () => addRow('image');
      $('btn-add-text').onclick = () => addRow('text');
      $('btn-ins-cover').onclick = ensureCover;
      $('btn-append-end').onclick = ensureEnd;
      $('btn-allpool').onclick = poolAll;
      $('btn-save').onclick = saveCustom;
      $('btn-export').onclick = doExport;
      $('btn-del-custom').onclick = deleteCustom;
      $('file-import').addEventListener('change', (e) => { doImport(e.target.files && e.target.files[0]); e.target.value = ''; });
      $('fmt-name').addEventListener('change', () => { curFmt().name = $('fmt-name').value; markDirty(); updateSrcLabel(); });
      $('fmt-warning').addEventListener('change', () => { curFmt().warningSec = Number($('fmt-warning').value); markDirty(); updateSrcLabel(); });
      $('pool-aff').addEventListener('change', () => applyBudget('aff'));
      $('pool-neg').addEventListener('change', () => applyBudget('neg'));
      const vNew = $('btn-ver-new'); if (vNew) vNew.onclick = blankNew;
      const vSave = $('btn-ver-save'); if (vSave) vSave.onclick = saveVersion;
      const vImp = $('file-ver-import'); if (vImp) vImp.addEventListener('change', (e) => { importVersionFile(e.target.files && e.target.files[0]); e.target.value = ''; });
      renderList(); syncMetaUI(); renderRows(); updatePoolLine(); updateSrcLabel();
      renderVersionList(); refreshWorkingUI();
    },
  };
  function applyBudget(side) {
    const v = P.parseSec($('pool-' + side).value);
    if (Number.isNaN(v) || v <= 0) { toast('总预算需 > 0,如 18:00'); $('pool-' + side).value = P.fmtSec(curFmt().poolPerSideSec[side]); return; }
    curFmt().poolPerSideSec[side] = v;
    $('pool-' + side).value = P.fmtSec(v);
    markDirty(); updateSrcLabel();
  }

  root.DT = API;
})(typeof self !== 'undefined' ? self : this);

// DOM 就绪即初始化(脚本位于 body 末尾)
document.addEventListener('DOMContentLoaded', () => window.DT.init());
