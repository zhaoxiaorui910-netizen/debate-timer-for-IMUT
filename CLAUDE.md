# debate-timer(辩论赛计时器)

辩论赛现场投屏计时器,浏览器双击 `index.html` 即用(file://),无构建、无外部依赖。

## 目录约定
- `engine.js` 计时引擎(纯函数状态机,无 DOM)——**唯一核心逻辑**,改动要同步更新测试
- `presets.js` 内置赛制数据 + `validate` 校验(类型常量/`contentSeg`/`normalizeStage`/`isContent` 也在其中)
- `app.js` 主控:设置/唯一投屏面 + 音频 + 全屏 + localStorage;按环节类型在计时/图文/文字三形态间切换
- `editor.js` 赛制管理与可视化编辑、计时背景上传(封面/结束等整幅图在环节行内逐行传)
- `style.css` 样式;`index.html` 入口(经典 script 引用,非 ES module)
- `tests/engine.test.js` 引擎测试;`reference/` 参考站产物(只读)
- 内置赛制只在 `presets.js`,编辑页一律以"可编辑副本"方式载入,禁止改内置原对象

## 命令
- 运行(开发):双击 `index.html`,或 `start index.html`(win)
- 测试:`node tests/presets.test.js && node tests/engine.test.js && node tests/appearance.test.js && node tests/versions.test.js`(零依赖;全绿前不算完成)
- 单文件打包:`node build-single.js` → 产物 `release/辩论赛计时器.html`(可单独分发/双击用)
  - 改动源码后需重新运行该命令;产物为只读、勿手改,由脚本生成

## 数据模型(一句话)
一套赛制 = 一串"环节"(编排/增删/上下移都由这串定,像 PPT)。环节分两组:**计时环节**(statement 陈词 / cross-exam 质询 / free-debate 对辩,有钟)与**内容环节**(image 图文 / text 文字,无钟、不倒数)。计时环节计时来源 fixed(环节定秒)或 pool(扣全队预算);内容环节结构恒为 `mode:'fixed'+affSec:0+negSec:0`,引擎对两者"透明"——不产生运行钟、穿过不碰预算,仅靠 `validate` 拒绝 + `copyOf` 的 `normalizeStage` 兜底保证不变量。**引擎不读 stage.type**,只读 mode/affSec/negSec/leadSide。环节内正/反各一钟,0 = 该方无钟;同一时刻仅一个钟在走,操作员换边切换。

## 内容环节携带的负载
- `image` 行:`imageData`(该行自带的 JPEG dataURL)或 `bg`('blue'|'purple'|null),无图时用该底色/默认底;投屏整幅占满,**连顶部辩题/队名都盖掉**
- `text` 行:`text`(多行)+ `textSize`(字号档,夹 [0.5,2]);投屏用计时页背景 + 居中文字,**顶部仍保留辩题/队名且跟随投屏外观的拖位**(文字区下移避让页头)
- 图片存进 stage 对象 → 随赛制/版本 JSON 走(体积增大是已知取舍);内容行可回退为内置底色

## 纪律
- 改 `engine.js` 前先改 `tests/engine.test.js`,全绿才提交
- 不要为了让测试/代码跑通而注释报错或绕过,找根因
- 图片以压缩 JPEG dataURL 存 localStorage;不入 git 的大图不许入库
