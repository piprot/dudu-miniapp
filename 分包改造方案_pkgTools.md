# dudu 画面感工具 —— 微信小程序分包改造方案

> 目标：把主包从 **2.268 MB（113.4%，提审必驳回）** 降到 **≤ 2 MB**，且不牺牲任何现有功能。
> 状态：**方案待审核，尚未改动产品代码**。所有数字均来自「复制原仓库到临时目录 + 完整执行改造 + 跑闸门与测试」的干跑实测。
> 文档版本：2026-10-24

---

## 0. 结论速览

| 项 | 方案 |
|---|---|
| 分包数 | **1 个**（`pkgTools`，别名 `tools`） |
| 主包页面 | `pages/index/index`、`pages/points/points`、`pages/order/order` |
| 分包页面 | `gen` `card` `poster` `comic` `quotes` `spark` `weather` `solar` `line`（9 个） |
| 主包体积 | **1.13 MB / 2.00 MB（56.6%）✓ 余 889 KB**（189 → 104 文件） |
| 分包体积 | **0.93 MB / 2.00 MB（46.3%）✓ 余 1.10 MB**（69 文件） |
| 合计 | 2.06 MB / 20 MB ✓ |
| 预下载 | `pages/index/index → tools`（wifi），合计 0.93 MB ≤ 2 MB ✓ |
| `images/bg`（973 KB） | **留主包**（与 `utils/bg_pack.js` 同处），60 条路径零改动 |
| 需要改的 app 代码 | **12 个文件**（9 工具页 + 3 个分包 utils） |
| 需要改的 test 断言 | **17 个文件 / 70 处**（人工改，脚本不可全包） |
| 干跑验证 | 三道守卫全绿；测试失败数 **21 → 21**，与基线完全一致（零新增） |

---

## 1. 分包切分怎么划

### 1.1 目标目录结构

```
dudu-miniapp/
├── app.json                      ← 改：加 subPackages + preloadRule
├── app.js                        ← 不改
├── app.wxss                      ← 不改
├── project.config.json           ← 改：packOptions.ignore 加 7 条
│
├── pages/                        ← 主包页面（只剩 3 个）
│   ├── index/   {index.js,.json,.wxml,.wxss}
│   ├── points/  {points.js,.json,.wxml,.wxss}
│   └── order/   {order.js,.json,.wxml,.wxss}
│
├── components/                   ← 主包组件（全部留主包，见 1.5）
│   ├── add-mine/     （仅 pages/index 用）
│   ├── card-config/  （4 个工具页用，渲染 /images/bg 缩略图）
│   └── privacy-panel/（主包 index + 9 个工具页都用）
│
├── images/
│   ├── bg/               ← 留主包，60 张，973 KB（零改动）
│   ├── qrcode_miniapp.png
│   └── reward_qr.png
│
├── utils/                       ← 主包 utils（只剩 11 个）
│   ├── config.js          15.6 KB  ← 主包与分包共用，必留主包
│   ├── login.js           7.6 KB
│   ├── points.js
│   ├── pay.js             → require('./config.js') './store.js' './ios.js'（全主包）
│   ├── store.js
│   ├── ios.js
│   ├── diag.js
│   ├── privacy_panel.js
│   ├── fav.js
│   ├── bg_pack.js         15.3 KB  ← 与 images/bg 同处
│   └── templates.js                  ← 孤儿文件，不搬、用 ignore 排除
│
└── pkgTools/                   ← ★ 新增分包（root = "pkgTools"）
    ├── pages/
    │   ├── gen/    {gen.js,.json,.wxml,.wxss}
    │   ├── card/   {card.js,.json,.wxml,.wxss}
    │   ├── poster/ {poster.js,.json,.wxml,.wxss}
    │   ├── comic/  {comic.js,.json,.wxml,.wxss}
    │   ├── quotes/ {quotes.js,.json,.wxml,.wxss}
    │   ├── spark/  {spark.js,.json,.wxml,.wxss}
    │   ├── weather/{weather.js,.json,.wxml,.wxss}
    │   ├── solar/  {solar.js,.json,.wxml,.wxss}
    │   └── line/   {line.js,.json,.wxml,.wxss}
    └── utils/                  ← 34 个工具侧 utils
        ├── album.js            brand_line.js      calendar_mix.js
        ├── card_render.js      card_style_mixin.js  cat_picker_mixin.js
        ├── charge.js           comic_markup.js    comic_render.js
        ├── content_daily.js    content_quotes.js 150 KB
        ├── content_weather.js 104 KB
        ├── daily_rotate.js     font_kit.js        history.js
        ├── knowledge.js        lines_lunar.js     lines_terms.js
        ├── lines_western.js    profile.js         quote_card_render.js
        ├── quotes_store.js     region_data.js     region_store.js
        ├── share.js            solar_browse.js    solar_terms.js
        ├── text_tools.js
        ├── core/render_engine.js      16.6 KB
        ├── templates/daily.js         113 KB
        ├── templates/index.js         44.4 KB
        ├── templates/poster.js
        └── themes/index.js            4.9 KB
```

### 1.2 `app.json` 目标内容

在现有 `app.json` 上做**增量修改**（`__usePrivacyCheck__`、`window`、`style`、`sitemapLocation` 原样不动）：

```json
{
  "__usePrivacyCheck__": true,
  "pages": [
    "pages/index/index",
    "pages/points/points",
    "pages/order/order"
  ],
  "window": {
    "navigationBarBackgroundColor": "#1a1a1a",
    "navigationBarTextStyle": "white",
    "navigationBarTitleText": "dudu 图文制作工具",
    "backgroundColor": "#f5f0e8",
    "backgroundTextStyle": "dark"
  },
  "style": "v2",
  "sitemapLocation": "sitemap.json",
  "subPackages": [
    {
      "root": "pkgTools",
      "name": "tools",
      "pages": [
        "pages/gen/gen",
        "pages/card/card",
        "pages/poster/poster",
        "pages/comic/comic",
        "pages/quotes/quotes",
        "pages/spark/spark",
        "pages/weather/weather",
        "pages/solar/solar",
        "pages/line/line"
      ]
    }
  ],
  "preloadRule": {
    "pages/index/index": {
      "packages": ["tools"],
      "network": "wifi"
    }
  }
}
```

要点：
- `subPackages[].pages` 里的路径**相对于分包根**（`pkgTools`），所以写 `pages/gen/gen` 而不是 `pkgTools/pages/gen/gen`。
- `name: "tools"` 是**分包别名**，`preloadRule` 用别名引用（用 root 也可以，但别名更清晰）。
- `preloadRule` 必须在**主包**配置（顶层字段），不能在分包内配置。

### 1.3 「最棘手问题」的逐条裁决

用户点名的 5 个共用模块，逐一给结论（含实测依赖依据）：

| 模块 | 体积 | 裁决 | 依据 |
|---|---|---|---|
| `utils/themes/index.js` | 4.9 KB | **进分包** `pkgTools/utils/themes/index.js` | 零自身依赖；消费方 = card/poster/comic/quotes/spark/weather/solar/line 8 个工具页 + `templates/index.js` + `templates/poster.js`，**全部在工具侧**。主包不再引用。 |
| `utils/templates/index.js` | 44.4 KB | **进分包** `pkgTools/utils/templates/index.js` | 消费方 = card/gen + `quote_card_render.js` + `card_style_mixin.js`，全在工具侧。同包目录 `templates/daily.js`（113 KB）`templates/poster.js` 一并进分包 → 分包内仍是 `../../utils/templates/index.js`，**路径不变**。 |
| `utils/core/render_engine.js` | 16.6 KB | **进分包** `pkgTools/utils/core/render_engine.js` | 消费方 = card/poster + `templates/index.js` + `templates/poster.js` + `quote_card_render.js`，全在工具侧。 |
| `utils/card_style_mixin.js` | 16.9 KB | **进分包** `pkgTools/utils/card_style_mixin.js` | 消费方 = 6 个工具页（card/line/quotes/spark/weather/solar），全在工具侧。它 `require('./bg_pack')` → 改为 `require('../../utils/bg_pack')` 跨包引用主包（官方允许，见 §2.1）。 |
| `utils/bg_pack.js` | 15.3 KB | **留主包** `utils/bg_pack.js` | 见 §1.4 专项论证。 |

**跨包引用链核查结论（回答「主包是否还有引用」）**：

- `utils/config.js`（15.6 KB）被 `app.js` + `pages/index` + `pages/points` + `utils/charge.js` + 6 个工具页引用 → **必须留主包**（主包 `app.js`/首页/积分页要用），分包页以 `../../../utils/config.js` 引用它。
- `utils/themes/index.js` **主包零引用**，可安全整体进分包。
- `utils/templates/index.js` **主包零引用**，可安全整体进分包。
- `utils/core/render_engine.js` **主包零引用**，可安全整体进分包。
- `utils/card_style_mixin.js` **主包零引用**，可安全整体进分包。
- `utils/bg_pack.js` 主包零引用，但**与图片同处更优**（见下）。

### 1.4 `images/bg`（973 KB）放哪 —— 专项论证

**裁决：留主包**，与 `utils/bg_pack.js` 同处，`bg_pack.js` 的 60 条 `path` **一字不改**。

理由（三条，按重要性）：

1. **跨包资源有真机风险**。`bg_pack.js` 每条形如 `{ id:'bg01', path:'/images/bg/bg01.jpg', ... }`。这个 `path` 有两个消费点：
   - `components/card-config/index.wxml:51`：`<image class="bg-thumb" src="{{item.url}}" mode="aspectFill" />`
   - `utils/card_style_mixin.js` → `canvas.createImage().src`（绘制背景图）
   
   若 `images/bg` 进分包而 `bg_pack.js` 留主包（或反之），就会出现「主包 JS 引用分包图片」或「分包 JS 引用主包图片」。官方引用原则写的是「packageA 无法使用 packageB 的资源，但可以使用主包、packageA 内的资源」——**方向上允许分包用主包资源**，但 `<image src>` 与 canvas `createImage` 的绝对路径在分包上下文中属于「未被官方明确举例的边界」，真机行为存在不确定性。
   
   同处则彻底规避：`card-config` 留主包、`images/bg` 留主包、`bg_pack.js` 留主包 → 三者同包，`<image>` 与 canvas 的 `/images/bg/xxx.jpg` 绝对路径与**当前线上行为完全一致**，零回归面。

2. **体积上不需要为了它冒险**。留主包后主包 1.13 MB（56.6%），余量 889 KB，足够健康。若强行把 `images/bg` 也塞进分包，主包降到约 200 KB，但分包升到约 1.9 MB（95%+），逼近 2 MB 红线且预下载合计也逼近 2 MB —— **用巨大的余量换零收益**。

3. **`card-config` 组件必须与 `images/bg` 同包**。`card-config` 被 card/line/quotes/solar/spark/weather 6 个工具页使用，且它的唯一图片消费就是 `item.url` → `/images/bg/xxx.jpg`。组件与它渲染的图片同包，最稳。

**备选方案（不推荐，但记录口径）**：若坚持 `images/bg` 进分包，则
- `utils/bg_pack.js` 一并搬进 `pkgTools/utils/bg_pack.js`，
- 60 条 `path` 全部改前缀为 `/pkgTools/images/bg/`，
- `images/bg/` 目录搬到 `pkgTools/images/bg/`，
- `components/card-config/` 必须一并搬进 `pkgTools/components/card-config/`（否则主包组件渲染分包图片），
- `card-config` 的 6 个引用方 json 路径改为 `"../../components/card-config/index"`（同包，深度不变）。
代价：主包降至约 200 KB，但分包逼近 95%，且跨包 `<image>` + canvas 风险要真机验证。

### 1.5 `components/` 三个组件的归属

| 组件 | 体积 | 消费方 | 裁决 |
|---|---|---|---|
| `components/add-mine/` | — | 仅 `pages/index/index.json` | **留主包**（主包页面用） |
| `components/privacy-panel/` | — | `pages/index/index.json` + **9 个工具页** | **留主包**（主包 index 要用；分包页引用主包组件是官方允许的） |
| `components/card-config/` | 11.5 KB | card/line/quotes/solar/spark/weather（**全在分包**） | **留主包**（与 `images/bg` 同处，见 §1.4 第 3 条） |

### 1.6 `project.config.json` —— `packOptions.ignore` 新增 7 条

在现有 `packOptions.ignore` 数组末尾追加：

```json
{ "value": "images/props",       "type": "folder" },
{ "value": "images/samples",     "type": "folder" },
{ "value": "comic_props",        "type": "folder" },
{ "value": "test_card.js",       "type": "file" },
{ "value": "test_comic.js",      "type": "file" },
{ "value": "test_b1_tools.js",   "type": "file" },
{ "value": "utils/templates.js", "type": "file" }
```

逐条依据（全仓 grep 核查运行期零引用）：

| 排除项 | 体积 | 依据 |
|---|---|---|
| `images/props` | 96 KB | MP 后台「道具图」上传源（`MP_BACKEND_3ITEMS.md` 记录已上传），小程序运行期无任何引用 |
| `images/samples` | 90 KB | 原供已下线的 `pages/commission` 页面使用，该页已删除 |
| `comic_props` | — | 与 `tools/gen_prop_images.py` 产物重复 |
| `test_card.js` `test_comic.js` `test_b1_tools.js` | — | 根目录 Node 单测脚本，误入包；已由 `test/` 目录同名单测替代 |
| `utils/templates.js` | — | **真孤儿**：全仓无任何 `require`，且与 `utils/templates/` 目录同名易混淆 |

干跑验证：7 条全部命中（`folder:images/props 6 个`、`folder:images/samples 4 个`、`folder:comic_props 2 个`、`file:test_card.js 1 个`、`file:test_comic.js 1 个`、`file:test_b1_tools.js 1 个`、`file:utils/templates.js 1 个`），打包文件数从 189 → **173**。

---

## 2. require 路径如何改

### 2.1 官方机制判定：分包可以 require 主包

微信官方文档《基础能力 / 分包加载 / 引用原则》原文：

> - `packageA` 无法 require `packageB` JS 文件，但**可以 require 主包、`packageA` 内的 JS 文件**；使用分包异步化时不受此条限制
> - `packageA` 无法 import `packageB` 的 template，但**可以 require 主包、`packageA` 内的 template**
> - `packageA` 无法使用 `packageB` 的资源，但**可以使用主包、`packageA` 内的资源**

**结论：分包内 require 主包 utils 完全合法，不需要复制文件，也不需要抽公共包。**

三条补充依据：
1. 本项目已有上线先例：分包 `packageReader/pages/reader/reader.js` 用 `require('../../../utils/config.js')` 引用主包 utils（多退一级），已随线上版本发布。
2. 运行时顺序保证：主包总是先加载完，分包 JS 执行时主包模块已在 `require` 缓存中。
3. **反向禁止**：主包**不得** require 分包 JS —— 这是 R5 守卫的判定基础。

因此本方案**不复制任何文件**，只调整相对路径深度。

### 2.2 路径深度规则

```
主包 utils  ←→  分包页面      : ../../../utils/xxx.js   （多退一级：pages/xxx/ → pkgTools/pages/xxx/）
主包 utils  ←→  分包 utils    : ../../utils/xxx.js       （多退一级：utils/ → pkgTools/utils/）
主包组件    ←→  分包页面      : ../../../components/xxx/index
分包内同包引用                 : 路径完全不变
```

### 2.3 需要改 require 的 **12 个文件**（app 代码，实测精确清单）

#### A. 9 个工具页 —— 只改「跨包引用主包 utils」的那几行

同包引用（`../../utils/xxx` 指向分包内 utils）**一律不动**，只改指向主包的：

| 文件 | 行 | 现状 | 改为 |
|---|---|---|---|
| `pkgTools/pages/card/card.js` | 19 | `require('../../utils/diag.js')` | `require('../../../utils/diag.js')` |
| `pkgTools/pages/card/card.js` | 20 | `require('../../utils/privacy_panel.js')` | `require('../../../utils/privacy_panel.js')` |
| `pkgTools/pages/comic/comic.js` | 13 | `require('../../utils/diag.js')` | `require('../../../utils/diag.js')` |
| `pkgTools/pages/comic/comic.js` | 14 | `require('../../utils/privacy_panel.js')` | `require('../../../utils/privacy_panel.js')` |
| `pkgTools/pages/gen/gen.js` | 7 | `require('../../utils/points')` | `require('../../../utils/points')` |
| `pkgTools/pages/gen/gen.js` | 12 | `require('../../utils/config')` | `require('../../../utils/config')` |
| `pkgTools/pages/gen/gen.js` | 15 | `require('../../utils/privacy_panel.js')` | `require('../../../utils/privacy_panel.js')` |
| `pkgTools/pages/line/line.js` | 10 | `require('../../utils/privacy_panel.js')` | `require('../../../utils/privacy_panel.js')` |
| `pkgTools/pages/poster/poster.js` | 12 | `require('../../utils/diag.js')` | `require('../../../utils/diag.js')` |
| `pkgTools/pages/poster/poster.js` | 13 | `require('../../utils/privacy_panel.js')` | `require('../../../utils/privacy_panel.js')` |
| `pkgTools/pages/quotes/quotes.js` | 13 | `require('../../utils/privacy_panel.js')` | `require('../../../utils/privacy_panel.js')` |
| `pkgTools/pages/quotes/quotes.js` | 15 | `require('../../utils/points.js')` | `require('../../../utils/points.js')` |
| `pkgTools/pages/quotes/quotes.js` | 16 | `require('../../utils/config.js')` | `require('../../../utils/config.js')` |
| `pkgTools/pages/solar/solar.js` | 16 | `require('../../utils/privacy_panel.js')` | `require('../../../utils/privacy_panel.js')` |
| `pkgTools/pages/solar/solar.js` | 18 | `require('../../utils/points.js')` | `require('../../../utils/points.js')` |
| `pkgTools/pages/solar/solar.js` | 19 | `require('../../utils/config.js')` | `require('../../../utils/config.js')` |
| `pkgTools/pages/spark/spark.js` | 11 | `require('../../utils/privacy_panel.js')` | `require('../../../utils/privacy_panel.js')` |
| `pkgTools/pages/spark/spark.js` | 13 | `require('../../utils/points.js')` | `require('../../../utils/points.js')` |
| `pkgTools/pages/spark/spark.js` | 14 | `require('../../utils/config.js')` | `require('../../../utils/config.js')` |
| `pkgTools/pages/weather/weather.js` | 16 | `require('../../utils/diag.js')` | `require('../../../utils/diag.js')` |
| `pkgTools/pages/weather/weather.js` | 23 | `require('../../utils/privacy_panel.js')` | `require('../../../utils/privacy_panel.js')` |
| `pkgTools/pages/weather/weather.js` | 25 | `require('../../utils/points.js')` | `require('../../../utils/points.js')` |
| `pkgTools/pages/weather/weather.js` | 26 | `require('../../utils/config.js')` | `require('../../../utils/config.js')` |

#### B. 3 个分包 utils

| 文件 | 行 | 现状 | 改为 |
|---|---|---|---|
| `pkgTools/utils/card_style_mixin.js` | 33 | `require('./bg_pack')` | `require('../../utils/bg_pack')` |
| `pkgTools/utils/charge.js` | — | `require('./config.js')` | `require('../../utils/config.js')` |
| `pkgTools/utils/album.js` | — | `require('./config.js')` 等主包引用 | `require('../../utils/config.js')` |

> 实测：`pkgTools/utils/` 内部 20 条 `require('./xxx')` **全部是分包内同包引用，一律不动**。
> 实测：主包 `utils/pay.js` 的 3 条 `require('./xxx')` 全在主包，**一律不动**。

### 2.4 `usingComponents` 相对路径必须多退一级

这是**极易漏掉**的一处。分包页面的 json 位于 `pkgTools/pages/xxx/xxx.json`，比主包页面深一级：

```json
// 改前（pages/xxx/xxx.json）
"usingComponents": {
  "privacy-panel": "../../components/privacy-panel/index",
  "card-config":  "../../components/card-config/index"
}

// 改后（pkgTools/pages/xxx/xxx.json）—— 15 处，全部要改
"usingComponents": {
  "privacy-panel": "../../../components/privacy-panel/index",
  "card-config":  "../../../components/card-config/index"
}
```

清单（9 个 json，共 15 处引用）：

| 文件 | 需改的组件 |
|---|---|
| `pkgTools/pages/gen/gen.json` | privacy-panel |
| `pkgTools/pages/poster/poster.json` | privacy-panel |
| `pkgTools/pages/comic/comic.json` | privacy-panel |
| `pkgTools/pages/card/card.json` | privacy-panel, card-config |
| `pkgTools/pages/quotes/quotes.json` | privacy-panel, card-config |
| `pkgTools/pages/spark/spark.json` | privacy-panel, card-config |
| `pkgTools/pages/weather/weather.json` | privacy-panel, card-config |
| `pkgTools/pages/solar/solar.json` | privacy-panel, card-config |
| `pkgTools/pages/line/line.json` | privacy-panel, card-config |

主包 `pages/index/index.json` 的 `../../components/...` **不变**（深度未变）。

### 2.5 各 utils 模块被哪些页面引用（Grep 统计，用于核对搬家边界）

| utils 模块 | 主包消费方 | 分包消费方 | 归属 |
|---|---|---|---|
| `config.js` | app.js, index, points | gen, quotes, solar, spark, weather + `utils/charge.js` | **主包** |
| `points.js` | index, points, order | gen, quotes, solar, spark, weather | **主包** |
| `diag.js` | index | card, comic, poster, weather | **主包** |
| `privacy_panel.js` | index | gen, card, poster, comic, quotes, spark, weather, solar, line | **主包** |
| `pay.js` | points, order | — | **主包** |
| `login.js` | index, points | — | **主包** |
| `store.js` | pay.js, points.js | — | **主包** |
| `ios.js` | pay.js | — | **主包** |
| `fav.js` | `components/add-mine` | — | **主包** |
| `bg_pack.js` | — | `pkgTools/utils/card_style_mixin.js` | **主包** |
| `themes/index.js` | — | card, poster, comic, quotes, spark, weather, solar, line, templates/index, templates/poster | **分包** |
| `templates/index.js` | — | card, gen, quote_card_render, card_style_mixin | **分包** |
| `templates/daily.js` | — | gen, card, poster, spark | **分包** |
| `templates/poster.js` | — | poster | **分包** |
| `core/render_engine.js` | — | card, poster, comic_render, templates/index, templates/poster, quote_card_render | **分包** |
| `card_style_mixin.js` | — | card, line, quotes, spark, weather, solar | **分包** |
| `charge.js` | — | gen, card, poster, comic, quotes, spark, weather, solar, line | **分包** |
| `content_quotes.js` | — | quotes, quotes_store | **分包** |
| `content_weather.js` | — | weather | **分包** |
| `quote_card_render.js` | — | quotes, spark, weather, solar, line | **分包** |
| `quotes_store.js` | — | quotes, spark, solar, line | **分包** |
| `cat_picker_mixin.js` | — | quotes, weather | **分包** |
| `share.js` | — | card, poster, comic | **分包** |
| `solar_terms.js` | — | solar, spark | **分包** |
| `solar_browse.js` | — | solar | **分包** |
| `calendar_mix.js` | — | spark, solar | **分包** |
| `daily_rotate.js` | — | quotes, spark, weather, solar | **分包** |
| `text_tools.js` | — | gen | **分包** |
| `knowledge.js` / `profile.js` | — | gen | **分包** |
| `region_data.js` / `region_store.js` | — | weather | **分包** |
| `lines_*.js` / `comic_*.js` / `font_kit.js` / `album.js` / `history.js` / `brand_line.js` / `card_render.js` / `content_daily.js` | — | 工具页内部 | **分包** |

---

## 3. 预下载与跳转

### 3.1 `preloadRule`

已在 §1.2 给出。要点：
- 顶层字段，配在主包 `app.json`，不在分包内。
- `packages` 用**分包别名** `tools`（即 `subPackages[0].name`）；也可以写 root `"pkgTools"`。
- `network: "wifi"` —— 分包 0.93 MB，wifi 预下载避免消耗用户流量；若希望首启即用可改 `"all"`（体积不变，只是流量口径）。
- 平台约束：**同一 preloadRule 下各分包体积之和 ≤ 2 MB**（超出报 code 20058）。本方案 0.93 MB，安全。
- 预下载在用户进入 `pages/index/index` 后触发，而首页 9 个入口全在分包 → 预下载时机与跳转时机吻合。

### 3.2 跳转路径是否需要改 —— 需要，且有一个 R5 陷阱

#### 陷阱：首页 `routes` 不能只改路径

`test/check_audit_redlines.js` 的 R5 判定逻辑（逐字复刻验证）：

```js
// 先剥掉 url: '...' / url: "..." 字面量（跳转目标不算资源引用）
live = live.replace(/url\s*:\s*'(?:[^'\\]|\\.)*'/g, "url:''");
live = live.replace(/url\s*:\s*"(?:[^"\\]|\\.)*"/g, 'url:""');
// 再扫：前置字符必须是 引号 或 左括号
const re = new RegExp('[\'"(]\\/?' + root + '\\/', 'g');
```

关键：R5 的前置字符集是 `['"(]`，**不含 `:`**。

当前首页写法（`pages/index/index.js:152-156`）：

```js
const routes = {
  gen: '/pages/gen/gen', card: '/pages/card/card', poster: '/pages/poster/poster',
  comic: '/pages/comic/comic',
  quotes: '/pages/quotes/quotes', spark: '/pages/spark/spark',
  weather: '/pages/weather/weather', solar: '/pages/solar/solar', line: '/pages/line/line'
};
```

若**只把路径改成 `/pkgTools/...` 而保持扁平 map 写法**：
- `'gen: '/pkgTools/pages/gen/gen'` 中 `pkgTools/` 的前置字符是 `:` → **不在 `['"(]` 内 → 不被剥掉 → R5 判定「主包字符串引用了分包路径」→ 违规**。

实测（独立脚本逐字复刻 R5 逻辑）：
```
✗ 命中 2 处（违规）    当前扁平 map 写法，仅把路径改成 /pkgTools/...
✓ 通过                改成 { url: ... } 键对象形式（推荐）
✓ 通过                真实导航调用内联 url 字面量
✗ 命中 1 处（违规）    主包真引用分包图片（应判违规）
```

**结论：首页 routes 必须改成 `{ url: '...' }` 键对象形式。**

#### 改法 1：首页 `pages/index/index.js`（主包）

现状（第 152-166 行）：

```js
    const routes = {
      gen: '/pages/gen/gen', card: '/pages/card/card', poster: '/pages/poster/poster',
      comic: '/pages/comic/comic',
      quotes: '/pages/quotes/quotes', spark: '/pages/spark/spark',
      weather: '/pages/weather/weather', solar: '/pages/solar/solar', line: '/pages/line/line'
    };
    if (routes[key]) {
      wx.navigateTo({
        url: routes[key],
        fail: (err) => { ... }
      });
    }
```

改为：

```js
    const routes = {
      gen:     { url: '/pkgTools/pages/gen/gen' },
      card:    { url: '/pkgTools/pages/card/card' },
      poster:  { url: '/pkgTools/pages/poster/poster' },
      comic:   { url: '/pkgTools/pages/comic/comic' },
      quotes:  { url: '/pkgTools/pages/quotes/quotes' },
      spark:   { url: '/pkgTools/pages/spark/spark' },
      weather: { url: '/pkgTools/pages/weather/weather' },
      solar:   { url: '/pkgTools/pages/solar/solar' },
      line:    { url: '/pkgTools/pages/line/line' },
    };
    if (routes[key]) {
      wx.navigateTo({
        url: routes[key].url,
        fail: (err) => { ... }
      });
    }
```

> 说明：`{ url: '...' }` 里的 `url:` 会被 R5 的 strip 规则剥掉，所以不触发违规。`wx.navigateTo({ url: routes[key].url, ... })` 中 `routes[key].url` 是变量、不是字面量，也不触发。

#### 改法 2：其余跳转与分享路径（共 8 处）

| 文件 | 行 | 现状 | 改为 |
|---|---|---|---|
| `pkgTools/pages/line/line.js` | 94 | `wx.navigateTo({ url: '/pages/quotes/quotes' })` | `wx.navigateTo({ url: '/pkgTools/pages/quotes/quotes' })` |
| `pkgTools/pages/comic/comic.js` | 243 | `path: '/pages/comic/comic'`（onShareAppMessage） | `path: '/pkgTools/pages/comic/comic'` |
| `pkgTools/pages/line/line.js` | 117 | `path: '/pages/line/line'` | `path: '/pkgTools/pages/line/line'` |
| `pkgTools/pages/quotes/quotes.js` | 451 | `path: '/pages/quotes/quotes'` | `path: '/pkgTools/pages/quotes/quotes'` |
| `pkgTools/pages/solar/solar.js` | 295 | `path: '/pages/solar/solar'` | `path: '/pkgTools/pages/solar/solar'` |
| `pkgTools/pages/spark/spark.js` | 191 | `path: '/pkgTools/pages/spark/spark'` → 现状 `path: '/pages/spark/spark'` | `path: '/pkgTools/pages/spark/spark'` |
| `pkgTools/pages/weather/weather.js` | 391 | `path: '/pages/weather/weather'` | `path: '/pkgTools/pages/weather/weather'` |

**分享路径（`onShareAppMessage` 的 `path`）必须改**，否则分享出去的卡片点开是 404（微信找不到 `/pages/xxx/xxx` 这个页面）。这是干跑中实测发现的遗漏点。

**不改的**（实测确认无需改）：
- `pages/index/index.js:147` `url: '/pages/points/points'` → points 留主包
- `pages/index/index.js:227` `path: '/pages/index/index'` → index 留主包
- `pages/points/points.js:128` `url: '/pages/order/order'`、`pages/points/points.js:329` `path: '/pages/points/points'` → 主包
- `pages/order/order.js:47` `url: '/pages/points/points'`、`pages/order/order.js:57` `path: '/pages/order/order'` → 主包
- `pkgTools/pages/gen/gen.js:157` `url: '/pages/points/points'` → points 留主包
- `pkgTools/pages/quotes/quotes.js:109`、`solar.js:56`、`spark.js:48`、`weather.js:108` 的 `url: '/pages/points/points'` → 主包
- `pkgTools/utils/charge.js:42` `wx.navigateTo({ url: '/pages/points/points' })` → 主包
- `pkgTools/utils/share.js:41` `path || '/pages/index/index'` → 主包

#### 改法 3：`components/card-config` 的图片路径 —— 不改

`components/card-config/index.wxml:51` 的 `src="{{item.url}}"` 来自 `bgPack.listAll()`，`bg_pack.js` 与 `images/bg` 同留主包 → 路径不变。

---

## 4. 验证方法

### 4.1 体积复算脚本（已写入仓库，可直接运行）

文件：`tools_local/pack_volume_split.js`（**本次唯一对原仓库的写入**；`tools_local` 已被 `packOptions.ignore` 排除，不进包）。

```bash
cd C:/Users/Administrator/WorkBuddy/2026-09-11-21-15-54/comic_miniapp/dudu-miniapp
node tools_local/pack_volume_split.js
```

判定口径与 `test/check_audit_redlines.js` 的 R7/R10 **完全一致**（同一套 `packOptions.ignore` 匹配规则 + 同一套分包归属判定），数字可互相印证。

当前（未改造）运行结果：
```
=== 分包包体核算 ===

  主包   189 文件    2.27 MB / 2.00 MB  113.4%  ✗ 超限   余 -274.4 KB
  合计   189 文件    2.27 MB / 20.00 MB  ✓
  预下载  未声明 preloadRule（无预下载体积风险）
```

改造后（干跑实测）：
```
  主包   104 文件    1.13 MB / 2.00 MB   56.6%  ✓   余 889.0 KB
  分包 pkgTools   69 文件    0.93 MB / 2.00 MB   46.3%  ✓   余 1099.9 KB
  合计   173 文件    2.06 MB / 20.00 MB  ✓
  预下载 pages/index/index    → tools  (wifi)  合计 0.93 MB / 2.00 MB  ✓

=== 结论 ===
  ✓ 全部包体合规，可提交审核
```

### 4.2 `test/check_audit_redlines.js` 会检查什么、新方案如何满足

| 规则 | 检查内容 | 新方案的满足方式 | 干跑结果 |
|---|---|---|---|
| **R1** | AppID 合法 | 不涉及 | ✓ |
| **R2 / R2b** | 禁用能力扫描（`wx.getClipboardData` 等）、虚拟支付入口健在 | 不涉及 | ✓ 173 文件 0 命中 |
| **R3** | `rewardEnabled=false`；`rewardQr` 仍配 `/images/reward_qr.png`（提示项） | 不涉及（该提示**改造前已存在**，非本次引入） | ✓ 提示 |
| **R5** | 主包文件不得字符串引用分包路径（`url:` 字面量先被剥掉；其余前置字符须为 `['"(]`） | ① 首页 routes 改 `{ url: ... }` 键对象形式；② 主包 `utils/`、`components/` 零 `pkgTools/` 字符串引用 | ✓「主包未引用任何分包资源（3 个文件含跳转写法）」 |
| **R6** | `app.json` 声明的页面路径与实际四件套一致；代码内跳转目标全部指向已声明页面 | ① `subPackages[0].pages` 用**相对分包根**的路径；② 所有跳转/分享 path 同步改前缀 | ✓「主包 3 页 + 分包 9 页」「跳转目标全部指向已声明页面」 |
| **R7** | 单包 ≤ 2 MB、合计 ≤ 20 MB | 主包 1.13 MB、分包 0.93 MB | ✓ |
| **R10** | 同一 preloadRule 下各分包体积之和 ≤ 2 MB | `pages/index/index → tools` 合计 0.93 MB | ✓ |
| **R8 / R9** | 云函数完整性、包内无 webp | 不涉及 | ✓ |

**执行顺序**：

```bash
node test/check_audit_redlines.js    # 审核闸门：必须「全部通过」
node test/check_require_resolves.js  # require 解析：必须「全部 require 均可解析到真实文件」
node test/check_structure.js         # 结构体检
node tools_local/pack_volume_split.js# 体积复算
node test/run_all.js                 # 全量测试
```

干跑实测结果：
```
──────── 结果：审核红线 + 分包检查全部通过 ────────
共校验 130 条相对 require（70 个 JS 文件）
✅ 全部 require 均可解析到真实文件（微信真机安全）
✓ 页面四件套 / 跳转路径 / 图片引用 / require 图 全部有效
```

> ⚠️ **已知守卫覆盖缺口（本次暴露，建议顺手补）**：`test/check_structure.js` 的 `walk()` 只扫 `ROOT/pages` 和 `ROOT/utils`，**改造后不会扫到 `pkgTools/pages/*` 和 `pkgTools/utils/*`**（实测：结构守卫只扫到 13 个 pages/*.js，分包 9 页完全未被覆盖）。建议把 `walk(path.join(ROOT,'pkgTools','pages'), ...)` 与 `walk(path.join(ROOT,'pkgTools','utils'), ...)` 一并加入，否则分包侧的图片引用/跳转路径问题无人把关。
> `test/check_require_resolves.js` 用 `walk(ROOT, [])` 全仓遍历，**已覆盖分包**（130 条 require 校验通过）。

### 4.3 既有测试会因路径变化而失败 —— 人工改写清单

**基线**：`node test/run_all.js` 当前 **21 项失败**（`test_constants_sync` 8、`test_solar_layers` 5、`test_quotes_page` 3、`test_poster_page` 3、`test_card_page` 1 等）—— 这些是**改造前既有**的失败，与本次无关。

> 📌 **重要**：核查过程中发现本会话早期干跑时有 7 个 `test/*.js` 被误改了 `pkgTools/` 前缀（`test_calendar_mix.js`、`test_card_style_mixin.js`、`test_charge_units.js`、`test_content_library.js`、`test_font_kit.js`、`test_region_data.js`、`test_solar_layers.js`），已用 `git checkout --` 全部回滚。**回滚后基线从 30 项失败降为 21 项**，这 21 项才是真实基线。

**改造后目标**：测试失败数**保持 21**，逐套件 FAIL 集合与基线**完全一致**（零新增）。干跑已验证达成。

需要人工改路径断言的 **17 个文件 / 70 处**：

| 文件 | 处数 | 改法示例 |
|---|---|---|
| `test/test_solar_layers.js` | 20 | `rd(ROOT, 'pages', 'solar', 'solar.js')` → `rd(ROOT, 'pkgTools', 'pages', 'solar', 'solar.js')`；`rd(ROOT, 'pages', 'spark', ...)` 同理 |
| `test/test_quotes_merge.js` | 13 | `rd(ROOT, 'pages', 'quotes', 'quotes.wxml')` → 插入 `'pkgTools'`；`require('../utils/quotes_store.js')` → `require('../pkgTools/utils/quotes_store.js')` |
| `test/test_region_data.js` | 15 | `path.join(__dirname, '..', 'utils', 'region_data.js')` → `path.join(__dirname, '..', 'pkgTools', 'utils', 'region_data.js')`（`region_store.js` 同） |
| `test/test_constants_sync.js` | 7 | `path.join(ROOT, 'pages', 'gen', 'gen.js')` → 插入 `'pkgTools'`；`['pages/gen/gen.wxml', 'pages/points/points.wxml']` → **只改 gen 一项**，points 留主包 |
| `test/test_content_library.js` | 9 | `path.join(__dirname, '..', 'pages', 'weather', 'weather.js')` → 插入 `'pkgTools'`；`path.join(__dirname, '..', 'utils', 'quote_card_render.js')` → 插入 `'pkgTools'` |
| `test/test_picker_wiring.js` | 9 | `read('pages/quotes/quotes.js')` → `read('pkgTools/pages/quotes/quotes.js')`；`require('../utils/content_quotes.js')` → `require('../pkgTools/utils/content_quotes.js')` |
| `test/test_frontend_guards.js` | 4 | `live('pages/gen/gen.js')` → `live('pkgTools/pages/gen/gen.js')`；`live('pages/card/card.js')`、`live('pages/gen/gen.wxss')`、`live('pages/poster/poster.js')` 同理 |
| `test/test_card_config_wiring.js` | 3 | `rd(ROOT, 'utils', 'card_style_mixin.js')` → `rd(ROOT, 'pkgTools', 'utils', 'card_style_mixin.js')` |
| `test/test_card_style_mixin.js` | 2 | `path.join(__dirname, '..', 'utils', 'card_style_mixin.js')` → 插入 `'pkgTools'` |
| `test/test_comic_storyboard.js` | 2 | `require('../utils/comic_markup.js')`、`require('../utils/comic_render.js')` → `../pkgTools/utils/...` |
| `test/test_card_page.js` | 1 | `require('../pages/card/card.js')` → `require('../pkgTools/pages/card/card.js')` |
| `test/test_poster_page.js` | 1 | `require('../pages/poster/poster.js')` → `require('../pkgTools/pages/poster/poster.js')` |
| `test/test_quotes_page.js` | 1 | `require('../pages/quotes/quotes.js')` → `require('../pkgTools/pages/quotes/quotes.js')` |
| `test/test_cat_picker.js` | 1 | `require('../utils/cat_picker_mixin.js')` → `require('../pkgTools/utils/cat_picker_mixin.js')` |
| `test/test_charge_units.js` | 1 | `require(path.join(ROOT, 'utils', 'charge.js'))` → `path.join(ROOT, 'pkgTools', 'utils', 'charge.js')` |
| `test/test_calendar_mix.js` | 1 | `path.join(ROOT, 'utils', 'calendar_mix.js')` → 插入 `'pkgTools'` |
| `test/test_font_kit.js` | 1 | `path.join(__dirname, '..', 'utils', 'font_kit.js')` → 插入 `'pkgTools'` |

**4 种路径写法必须都覆盖**：

```js
// ① path.join(ROOT, 'pages', 'gen', 'gen.js')     → path.join(ROOT, 'pkgTools', 'pages', 'gen', 'gen.js')
// ② path.join(__dirname, '..', 'utils', 'x.js')    → path.join(__dirname, '..', 'pkgTools', 'utils', 'x.js')
// ③ require('../pages/card/card.js')              → require('../pkgTools/pages/card/card.js')
// ④ 纯字面量 'pages/gen/gen.wxml'                 → 'pkgTools/pages/gen/gen.wxml'
```

**5 种必须人工确认的「变量参数」写法**（自动化脚本无法可靠批量处理，务必人工核对）：

| 文件 | 行 | 写法 | 说明 |
|---|---|---|---|
| `test/test_solar_layers.js` | 201 | `require(path.join(ROOT, 'utils', lib + '.js'))` | `lib` 循环变量，`libs = ['lines_terms','lines_lunar','lines_western']` 三者**全在分包** → 改成 `path.join(ROOT, 'pkgTools', 'utils', lib + '.js')` |
| `test/test_constants_sync.js` | 239 | `path.join(ROOT, 'pages', page, page + '.js')` | `page` 循环变量，该循环遍历 gen 系页面 → 加 `'pkgTools'` |
| `test/test_constants_sync.js` | 262 | `path.join(ROOT, 'pages', page, page + '.js')` | `page` 遍历 `['quotes','spark','weather','solar','line']`，**全部在分包** → 加 `'pkgTools'` |
| `test/test_quotes_merge.js` | 235 | `rd(ROOT, 'pages', page, page + '.js')` | `page` 遍历 5 个分包页 → 加 `'pkgTools'` |
| `test/test_frontend_guards.js` | 340 | `read('pages/' + p + '/' + p + '.wxml')` | `p` 遍历 `['index','gen','card','poster']` —— **index 留主包、其余在分包**，这一行必须拆成两处分别处理，**不能整体加前缀** |

> 最后一条是本次实测踩到的坑：曾用「9 个工具页白名单 + 无差别加前缀」的方式批量替换，把 `pages/index/index.js` 也改成 `pkgTools/pages/index/index.js`，导致 `test_add_mine.js` 报 `pkgTools\pages\index\index.json` ENOENT。**凡涉及主包页面的循环，必须拆分处理。**

根目录 3 个测试脚本（`test_card.js` / `test_comic.js` / `test_b1_tools.js`）的 `./utils/X` 也需改 `./pkgTools/utils/X` —— 但本方案已把这 3 个文件加入 `packOptions.ignore`，**推荐直接保留在仓库、不入包**，则无需修改。

---

## 5. 风险清单

| # | 风险 | 概率 | 影响 | 缓解 / 回滚 |
|---|---|---|---|---|
| R1 | **canvas `createImage` 加载 `/images/bg/xxx.jpg` 在分包上下文异常** | 低 | 高（背景图不出来，卡片渲染失败） | 已规避：`images/bg` + `bg_pack.js` + `card-config` **三者同留主包**，路径与线上完全一致。真机验证 1 张图即可确认。 |
| R2 | **`usingComponents` 路径深度漏改**（`../../` → `../../../`） | **高**（最容易漏） | 高（页面白屏，组件不渲染） | 已在 §2.4 给出 15 处逐文件清单；干跑已修正并验证。提测时重点看 `card.json`/`quotes.json` 等 6 个双组件页。 |
| R3 | **首页 routes 沿用扁平 map 写法** → 触发 R5 | **中** | 高（提审被闸门拦下） | 已在 §3.2 给出 R5 正则的逐字分析与实测证据；必须改成 `{ url: ... }` 键对象形式。 |
| R4 | **`onShareAppMessage` 的 `path` 漏改** → 分享卡片 404 | **中** | 中高（分享链路断） | 已在 §3.2 列出 6 处逐条；提测时每个能分享的工具页各分享一次验证。 |
| R5 | **`check_structure.js` 不扫 `pkgTools/`，分包侧问题无人把关** | 确定存在 | 中（防护网缺失） | 已在 §4.2 标注；建议本次顺手补 `walk(pkgTools/pages)` + `walk(pkgTools/utils)`。 |
| R6 | **测试路径批量替换误伤主包页面**（`pages/index`、`pages/points`、`pages/order`） | **高**（无差别替换必踩） | 中（测试假红，掩盖真问题） | 干跑已实测该坑并给出规避法：按 9 个工具页白名单逐页替换，变量循环形式必须人工逐条确认（§4.3 末 5 条）。 |
| R7 | **`utils/templates.js`（孤儿）被误当作 `utils/templates/` 目录搬走** | 中 | 低 | 已加入 `packOptions.ignore` 排除；全仓无 `require` 引用。 |
| R8 | **预下载 0.93 MB 在弱网下仍慢** | 低 | 低 | `network: "wifi"` 已规避；如需首启更快可改 `"all"`。 |
| R9 | **分包页在真机上因路径写错白屏**（如 `pkgTools/pkgTools/...`） | 中 | 高 | `check_require_resolves.js` 干跑已全绿（130 条）；提测必须真机走完 9 个工具页。 |
| R10 | **`packOptions.ignore` 新增项误伤线上依赖**（如 `images/props` 其实还在用） | 低 | 高 | 全仓 grep 已核查运行期零引用；`images/props` 是 MP 后台道具图上传源（MP 后台已上传，运行时不需要）。提测前用开发者工具「上传」再确认一次包体数字。 |

### 回滚方案

改造是**纯目录移动 + 路径改写**，无数据库/服务端变更，回滚成本极低：

**方式一（推荐，秒级）**：`git checkout -- .` + `git clean -fd pkgTools/`
- 前提：改造前先 `git add -A && git commit -m "chore: 分包改造前快照"`（当前仓库已有 17 个未提交的既有改动，建议先单独 commit 一笔，避免与分包改动混在一起）
- 当前 `git status` 中有 17 个会话前既有的产品改动（`pages/card/card.js`、`utils/content_quotes.js` 等「出图设置」特性），**这些不是本次改造产生的**，回滚时不要误删

**方式二（灰度）**：
1. 只改 `app.json` 加 `subPackages` + `preloadRule`，**暂不移动文件** → 微信会把 `pkgTools/` 下不存在的路径当空分包，页面 404 → 不可行，不采用
2. 正确的灰度顺序是：① 先移动文件 + 改 require（此时 app.json 不声明分包 → 编译报错，但 git 分支保留）→ ② 改 app.json → ③ 真机验证 → ④ 提审。若第 ③ 步出问题，`git revert` 单一 commit 即可

**建议**：把本次改造做成**一个独立 commit**，commit message 标注「feat: 主包分包改造（pkgTools）」，回滚时 `git revert <sha>` 一步到位。

---

## 6. 推荐方案与理由

**推荐：单分包 `pkgTools`（name = `tools`）+ 9 个工具页进分包 + 34 个工具侧 utils 进分包 + `images/bg`/`bg_pack`/`card-config` 留主包。**

### 为什么是这一个

**理由 1 —— 体积与风险的最优平衡点。**
四种切分形态的实测对比（均已剔除孤儿资源）：

| 形态 | 主包 | 分包 | 评价 |
|---|---|---|---|
| **A：bg 留主包 + 内容库进分包** | **1.13 MB (56.6%)** | **0.93 MB (46.3%)** | **推荐**：图片路径零改动、canvas 无跨包风险、两包均衡 |
| B：bg 进分包 + 内容库进分包 | 0.14 MB (6.6%) | 1.97 MB (96.2%) | 分包将满；预下载 1.97 MB 逼近 2 MB 红线 |
| C：bg 进分包 + 内容库留主包 | 0.50 MB (24.6%) | 1.60 MB (78.3%) | 主包最小但 `utils/templates` 需拆目录 |
| D：全留主包 | 1.51 MB (73.7%) | 0.60 MB (29.1%) | 收益小，等于没解决 |

形态 A 是唯一同时满足「两包都在 60% 以内」「预下载远低于 2 MB」「图片路径零改动」「canvas 无跨包风险」的方案。形态 B 虽主包最小，但把分包推到 96% —— 后续加任何一个工具页或文案库就会爆 2 MB。

**理由 2 —— `images/bg` 留主包是「零回归面」的选择。**
973 KB 是主包最大单块，也是唯一有「canvas createImage + 跨包绝对路径」不确定性的资源。留在主包意味着：
- `bg_pack.js` 的 60 条 path 一字不改
- `components/card-config` 的 `<image src="{{item.url}}">` 行为与线上完全一致
- `card_style_mixin.js` 的 canvas 绘制路径不变

用一个「理论收益」（主包再小 1 MB）去换「真机 canvas 行为不确定」，不划算 —— 而形态 A 的主包 56.6% 已经远低于 2 MB 红线，**本来就不需要这个收益**。

**理由 3 —— 单一分包，认知与运维成本最低。**
9 个工具页共用 34 个 utils，且互相之间有交叉引用（`templates/index.js` ↔ `core/render_engine.js` ↔ `quote_card_render.js` ↔ `card_style_mixin.js`）。若拆成 2 个分包（例如「内容库包」+「工具页包」），就会出现「A 包 require B 包」的非法引用，被迫启用分包异步化（需基础库 ≥ 2.17.3 + `componentPlaceholder` 占位组件），复杂度与真机风险陡增。**单分包完全规避了这个坑。**

**理由 4 —— 官方机制 + 本项目先例双重背书。**
- 官方：「packageA 无法 require packageB JS 文件，但**可以 require 主包**、packageA 内的 JS 文件」→ 分包页 require 主包 utils 合法，无需复制、无需抽公共包。
- 本项目：`packageReader` 分包（已上线）已在用 `require('../../../utils/config.js')` 引用主包 utils，路径深度规则完全一致。
- 官方：「packageA 无法使用 packageB 的资源，但可以使用主包、packageA 内的资源」→ 主包组件被分包页引用合法（`privacy-panel`/`card-config` 留主包的依据）。

**理由 5 —— 预下载时机与业务流吻合。**
`preloadRule` 挂在 `pages/index/index`，而首页 9 个入口全部指向分包。用户点开首页 → 分包在 wifi 下后台预下载 → 用户点击任一入口时分包已就绪，**用户感知不到分包的存在**（首启点「朋友圈文案」有约 0.93 MB 的下载等待，是唯一可感知点；可后续把 `network` 改 `"all"` 或按需拆分包优化）。

### 落地执行顺序（建议）

1. `git add -A && git commit -m "chore: 分包改造前快照"`（隔离既有的 17 个未提交改动）
2. 移动目录：`pages/{9 个工具页}` → `pkgTools/pages/`；`utils/{34 个}` → `pkgTools/utils/`
3. 改 `app.json`（§1.2）
4. 改 app 代码 require（§2.3，12 个文件）
5. 改 `usingComponents` 路径深度（§2.4，15 处）
6. 改跳转 URL + 分享 path（§3.2，首页 routes + 6 处分享 + 1 处跳转）
7. 改 `project.config.json` 的 `packOptions.ignore`（§1.6，7 条）
8. 改 test 断言（§4.3，17 文件 70 处 + 5 处变量写法人工确认）
9. 跑四道验证（§4.2）
10. 补 `check_structure.js` 对 `pkgTools/` 的扫描（可选但建议）
11. 真机走完 9 个工具页 + 分享链路 + 背景图出卡
12. `git commit -m "feat: 主包分包改造（pkgTools）"`

---

## 附：干跑验证证据摘要

| 验证项 | 命令 | 结果 |
|---|---|---|
| 审核红线 | `node test/check_audit_redlines.js` | ✓ 全部通过（R5/R6/R7/R10 全绿） |
| require 解析 | `node test/check_require_resolves.js` | ✓ 130 条相对 require 全部可解析（70 个 JS 文件） |
| 结构体检 | `node test/check_structure.js` | ✓ 全部有效 |
| 包体核算 | `node tools_local/pack_volume_split.js` | ✓ 主包 1.13 MB (56.6%) / 分包 0.93 MB (46.3%) / 预下载 0.93 MB |
| 测试套件 | `node test/run_all.js` | 21 项失败，与基线 **21** 完全一致（逐套件 FAIL 集合 diff 为空） |
| R5 判定 | 独立脚本逐字复刻 | 扁平 map ✗ 违规 / `{ url: ... }` ✓ 通过 |
