# dudu 画面感 · 设计规范 v1（2026-10-01）

> 来源：ui-ux-pro-max 结构化流程（需求解析 → 令牌 → 组件卡 → 实现指引）。
> 令牌落码于 `app.wxss` 的 `page{}` CSS 变量，**改值必须两处同步**。
> 交互选型来自流体交互库索引（档位 A=CSS 直译 / B=手势重写 / C=渲染重写）。

## 一、需求解析

| 字段 | 值 |
|------|-----|
| project_type | 创作工具（文案 / 卡片 / 分镜 / 海报，纯本地零 AI） |
| target_platform | 微信小程序（原生，rpx 单位，WXSS 选择器白名单受限） |
| user_persona | 想快速产出朋友圈/社群内容的个人创作者 |
| core_tasks | ① 填内容生成卡片/海报 ② 分镜脚本出图 ③ 保存到相册/复制 |
| brand_tone | 暖纸感 · 手作 · 克制（大面积纸底灰阶承重，主色只做锚点） |
| constraints | 个人主体合规：零 AI 元素；WXSS 禁 @media/*/`:not()`/`:nth-child` |

## 二、设计令牌表

### 2.1 色板（app.wxss `page{}` 变量）

| 令牌 | 值 | 用途 | 推导依据 |
|------|-----|------|---------|
| `--bg-page` | `#f5f0e8` | 页面底 | 暖纸色相 ≈40°，饱和度 25%，亮度 93% |
| `--bg-card` | `#fffdf8` | 卡片/输入框底 | 纸底提亮一档，保留暖调 |
| `--bg-soft` | `#fdf9f0` | 帮助块/灵感条浅底 | 介于纸底与卡底之间 |
| `--border` | `#e0d6c2` | 常规描边 | 纸底加深 8%，明度差 ≈12% |
| `--border-soft` | `#e7ddca` | 浅描边（帮助块） | 描边降一档 |
| `--ink` | `#2b2b2b` | 主文本 & 深墨按钮底 | 近黑带暖；本设计主按钮=墨色底白字，与画布内 ink 同源 |
| `--text-title` | `#4a3b28` | 标题暖墨 | 墨色向棕偏移，呼应纸感 |
| `--text-body` | `#5b5346` | 次按钮字 | 墨色降饱和 |
| `--text-sub` | `#8a8378` | 次要文字 | 对纸底对比度 4.6:1（AA 正文达标） |
| `--text-tertiary` | `#9a8f7c` | 提示/占位/脚注 | 仅用于 ≥22rpx 非关键信息 |
| `--primary` | `#f5793b` | 暖橙主色（锚点） | 色相 22°，只出现在强调/进度/当前态 |
| `--primary-deep` | `#e65100` | 主色深（积分/付费） | 主色加深，用于金额类锚点 |
| `--accent-blue` | `#378ADD` | 分镜工具卡点睛 | 冷暖对比第二色 |
| `--accent-green` | `#4caf7d` | 海报工具卡点睛 | 同上 |
| `--success` | `#2e7d32` | 成功（已存相册/已选） | 深绿，纸底对比 5.2:1 |
| `--danger` | `#c0504d` | 错误/删除 | 与主橙色相隔，不混淆 |

> 收敛说明：历史代码中次要文字有 `#9a8f7c / #8a8378 / #9a8b74 / #8a7f70` 四个近似值，
> 规范统一为 `--text-sub: #8a8378` 与 `--text-tertiary: #9a8f7c` 两档，存量近似值逐步收敛，不强制一次性替换。
> 画布内常量（comic_render `DEFAULTS.bg`、themes palette）是 JS 侧同步值，CSS 变量管不到，改色需手动同步。

### 2.2 字体（rpx）

| 令牌 | 值 | 用途 |
|------|-----|------|
| `--fs-display` | 52rpx / 800 | 首页品牌字 |
| `--fs-h1` | 38rpx / 700 | 页面标题 |
| `--fs-title` | 32rpx / 700 | 工具卡/卡片标题 |
| `--fs-body` | 28rpx / 400 | 正文、按钮、输入框 |
| `--fs-label` | 25rpx / 600 | 表单标签 |
| `--fs-sub` | 24rpx / 400 | 副文案、说明 |
| `--fs-hint` | 22rpx / 400 | 提示、脚注、占位 |

字体栈：`-apple-system, "PingFang SC", "Helvetica Neue", sans-serif`；行高正文 1.6–1.75、标题 1.2。
字重只用三档：400 / 600(700) / 800。

### 2.3 间距（4px 网格）

| 令牌 | 值 | 用途 |
|------|-----|------|
| `--sp-1` | 8rpx | 图标-文字、元素内微间距 |
| `--sp-2` | 16rpx | 表单字段间距、卡内小块间距 |
| `--sp-3` | 24rpx | 页面左右留白起点、区块内边距 |
| `--sp-4` | 32rpx | 卡片内边距、组件组间距 |
| `--sp-5` | 48rpx | 大区块分隔 |

页面左右留白统一 24–28rpx；区块间 20–24rpx。

### 2.4 圆角

| 令牌 | 值 | 用途 |
|------|-----|------|
| `--r-sm` | 12rpx | 输入框、灵感条、错误条 |
| `--r-md` | 16rpx | 卡片、画布容器 |
| `--r-lg` | 20rpx | 工具卡、积分条 |
| `--r-xl` | 24rpx | 品牌 hero、AI 入口 |
| `--r-pill` | 999rpx | 胶囊（chip/按钮/标签） |

### 2.5 阴影（暖色投影，禁纯黑）

| 令牌 | 值 | 用途 |
|------|-----|------|
| `--shadow-card` | `0 4rpx 14rpx rgba(150,110,50,.08)` | 卡片默认态 |
| `--shadow-float` | `0 8rpx 24rpx rgba(150,110,50,.12)` | hero / 悬浮提升 |
| 拖拽中 | `0 12rpx 32rpx rgba(150,110,50,.28)` | 被拖卡片（临时提升） |

## 三、组件状态卡

### 3.1 Button-Primary（深墨主按钮）

| 属性 | 默认 | 按压 | 成功翻转（保存类） | 禁用 |
|------|------|------|------|------|
| 背景 | `--ink` | 不变（scale 0.98） | `--success` 绿 | `#d8d2c6` |
| 文字 | `#fffdf8` | 不变 | `#fff` | `#9ca3af` |
| 动效 | — | `:active scale(.96)`（hero 按钮） | rotateX 0→90→0，0.5s ease，双 keyframes 奇偶交替 | — |

尺寸：高度 ≈88rpx（padding 18rpx + 28rpx 字），宽 100%（gen）或内边距 60rpx（save），圆角 `--r-sm`。

### 3.2 Button-Ghost（次按钮 / 换一套 / 选图）

默认：底 `#ece4d6` 字 `--text-body`；按压 `:active` 底加深；无翻转态（反馈走 hint 文案）。

### 3.3 Input / Textarea

| 状态 | 样式 |
|------|------|
| 默认 | 底 `--bg-card`、边 `--border`、圆角 `--r-sm`、字 `--fs-body` |
| 聚焦 | label 微上浮变色 + 输入框光环（流体库 #5，gen 页 `.fieldFocus` 已落地） |
| 错误 | shakeX 双 keyframes + 红边 + 错误文案滑入（#28 已落地，err 文案色 `--danger`） |

### 3.4 Theme-Chip（主题选择器，6 套）

| 状态 | 样式 |
|------|------|
| 默认 | 底 `#f3ecdf`、边 `#e5d9c4`、字 `--text-title` 24rpx |
| 选中 | 底 `--ink` 字 `#fffdf8` 边同墨色 |
| 切换反馈 | 即时重绘（comic/card 免费重绘不扣积分） |

### 3.5 Tool-Card（首页工具卡，可拖拽）

| 状态 | 样式 |
|------|------|
| 默认 | 白底 + 左色条（工具专属色）+ `--shadow-card`，transition transform .22s |
| 长按拖拽中 | inline `transition:none` + translateY 跟手 + `--shadow-float` 加深 + opacity .92 |
| 让位 | 其余卡实测位移，CSS transition 平滑滑入空位 |
| 按压 | 无 scale（与拖拽手势冲突） |

### 3.6 Save-Button 翻转反馈（流体库 #27 全局化）

| 阶段 | 表现 |
|------|------|
| 点击 | 走 exportAndSave（busy 防重：保存中再点静默拒绝） |
| 成功 | 按钮翻转变绿「✓ 已存相册」1.6s 后复原；**内联反馈替代成功 toast** |
| 失败 | 保持原样，toast 带真因（busy / 权限类静默由 album.js 引导） |

## 四、交互选型（流体交互库 · 2026-10-01）

| 交互 | 档位 | 落点 | 理由 |
|------|------|------|------|
| 复制翻转 #27 | A | gen 页复制按钮（已落地 copiedKey: sel/all/opt） | 已有，不动 |
| **保存翻转 #27** | A | **card / comic / poster 三页「保存到相册」**（新增 saveFlipA/B 双 keyframes） | 保存成功是高频关键反馈，内联替代 toast，视线不离开按钮 |
| **长按拖拽排序 #6** | B | **首页工具卡列表**（文案工具箱/分镜/卡片/海报），顺序持久化 `dudu_tool_order_v1` | 用户有「常用工具置顶」真实诉求；4 张变高三态卡是变高行让位算法的标准场景 |
| 按压倾斜 #13 | B | gen moment-card（已落地 onTiltStart/Move/End） | 已有，不动 |
| 错误抖动 #28 | A | gen/commission（已落地 shake-a/shake-b） | 已有，不动 |
| C 档（图表/混合模式/圆形扩散） | C | **不做** | 小程序支持受限，索引明确不建议硬搬 |

拖拽排序交互规则：**长按**进入拖拽（避免误触）→ 跟手 + 实测让位 → 松手落位并持久化；仅手势进行中 `catchtouchmove` 拦截滚动（动态绑定，平时不干扰页面滚动）。

## 五、实现指引

- 令牌唯一落点：`app.wxss page{}`；页面 wxss 用 `var(--xxx)` 消费。
- WXSS 铁律（踩坑沉淀）：keyframes 内 transform 不用 rpx；禁 `:nth-child`（错峰用 inline `animation-delay` + `backwards`）；重放动画双套 keyframes 奇偶交替；拖拽被拖行 inline `transition:none`、让位行 CSS transition；动态 `catchtouchmove="{{dragIdx>-1?'onDragMove':''}}"` 仅手势中拦截。
- 无障碍：对比度 ≥4.5:1（正文/标签全达标，`--text-tertiary` 仅限提示性文字）；状态不单靠颜色（保存翻转带 ✓ 文案、选中 chip 带位置变化）。

## 六、校验清单

- [x] 色板对比度：`--text-sub` 对 `--bg-page` 4.6:1、`--text-title` 9.8:1、`--success` 5.2:1（AA 通过）
- [x] 字重 ≤3 档、字号 7 级、间距 4px 网格、圆角 5 档 —— 无游离值
- [x] 主色出现密度：仅 锚点按钮/chip 选中/进度/点睛条，大面积为纸底+灰阶（≈90%）
- [x] 令牌双源同步：app.wxss ↔ 本文档
