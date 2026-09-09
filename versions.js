// 版本库 纯逻辑(本地 localStorage 多版本管理的数据操作;node 安全可测)
// 每个"版本"= 一份完整配置:{ id,name,updated, fmt, session, appearance }
// 记录体内部的深拷贝、以及把记录落盘,都由调用方(editor.js)负责;
// 本模块只做列表级的纯数组操作,不改入参。
(function (root) {
  'use strict';
  const KIND = 'debate-timer-version';
  const clone = (o) => (o == null ? o : JSON.parse(JSON.stringify(o)));
  const newId = () => 'v' + Date.now() + Math.floor(Math.random() * 1e4);

  // 由"当前工作三件套"构造一条记录(深拷贝,后续改动不污染记录)
  function wrap(name, fmt, session, appearance) {
    return {
      id: newId(),
      name: name || '',
      updated: Date.now(),
      fmt: clone(fmt),
      session: clone(session),
      appearance: clone(appearance),
    };
  }

  const find = (list, id) => (Array.isArray(list) ? list.find((x) => x && x.id === id) : undefined);
  const upsert = (list, rec) => {
    const next = Array.isArray(list) ? list.slice() : [];
    const i = next.findIndex((x) => x && x.id === rec.id);
    if (i >= 0) next[i] = rec; else next.push(rec);
    return next;
  };
  const remove = (list, id) => (Array.isArray(list) ? list.filter((x) => x.id !== id) : []);
  const rename = (list, id, name) => {
    if (!Array.isArray(list)) return [];
    const i = list.findIndex((x) => x && x.id === id);
    if (i < 0) return list.slice();
    const next = list.slice();
    next[i] = Object.assign({}, list[i], { name: name || '', updated: Date.now() });
    return next;
  };
  // 深拷贝副本,name 加" 副本"后缀,追加到表尾
  function duplicate(list, v) {
    const rec = wrap((v.name || '') + ' 副本', v.fmt, v.session, v.appearance);
    return upsert(list, rec);
  }

  // 结构校验(导入文件的门槛);fmt 内部的完整校验仍交给 Presets.validate
  function validate(v) {
    const errs = [];
    if (!v || typeof v !== 'object') errs.push('版本数据不是对象');
    else {
      if (typeof v.id !== 'string' || !v.id) errs.push('缺版本 id');
      if (typeof v.name !== 'string' || !v.name.trim()) errs.push('缺版本名');
      const fmt = v.fmt;
      if (!fmt || typeof fmt !== 'object') errs.push('缺赛制 fmt');
      else {
        if (typeof fmt.name !== 'string' || !fmt.name.trim()) errs.push('赛制缺名称');
        if (!Array.isArray(fmt.stages) || !fmt.stages.length) errs.push('环节不能为空');
      }
      if (!v.session || typeof v.session !== 'object') errs.push('缺比赛信息 session');
      if (!v.appearance || typeof v.appearance !== 'object') errs.push('缺投屏外观 appearance');
    }
    return { ok: errs.length === 0, errors: errs };
  }

  const isVersionExport = (json) => !!(json && json.kind === KIND);

  const API = { KIND, clone, newId, wrap, find, upsert, remove, rename, duplicate, validate, isVersionExport };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  else root.Versions = API;
})(typeof self !== 'undefined' ? self : this);
