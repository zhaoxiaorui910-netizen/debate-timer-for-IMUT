// 单文件打包:把 style.css 内联进 <style>,把各 JS 内联进 <script>,
// 生成一个可单独双击运行/分发的 debate-timer 单文件。
// 用法(在 debate-timer/ 下): node build-single.js
// 产物: release/辩论赛计时器.html
'use strict';
const fs = require('fs');
const path = require('path');

const root = __dirname;
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

let html = read('index.html');

const css = read('style.css');
html = html.replace(
  /<link rel="stylesheet" href="style\.css"\s*\/?>/,
  (m) => '<style>\n' + css + '\n</style>'
);

for (const f of ['engine.js', 'presets.js', 'appearance.js', 'versions.js', 'editor.js', 'app.js']) {
  // 防御:JS 字符串若含 </script> 会提前闭合标签,做转义
  const js = read(f).replace(/<\/script/gi, '<\\/script');
  const re = new RegExp('<script src="' + f.replace(/[.]/g, '\\.') + '"></script>');
  if (!re.test(html)) throw new Error('在 index.html 中找不到脚本引用: ' + f);
  html = html.replace(re, (m) => '<script>\n' + js + '\n</' + 'script>');
}

const leftovers = html.match(/<script\s+src=|<link\s+rel="stylesheet"/);
if (leftovers) throw new Error('内联后仍有未处理的资源引用: ' + leftovers[0]);

const outDir = path.join(root, 'release');
fs.mkdirSync(outDir, { recursive: true });
const out = path.join(outDir, '辩论赛计时器.html');
fs.writeFileSync(out, html);
console.log('已生成: ' + out + ' (' + (fs.statSync(out).size / 1024).toFixed(1) + ' KB)');
