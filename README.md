# LLMPageTrans（Chrome 插件）

用大语言模型（LLM）翻译当前网页，并尽量保持原页面布局不变地展示译文。

本插件主要面向技术内容（科学论文、专业博客、计算机科学、大语言模型等），支持：
- 左右分屏对照：左侧原文页面，右侧译文页面（克隆渲染）
- 仅显示译文：全屏显示译文页面，并可一键切回双栏
- Markdown 词库：控制“不翻译术语”和“固定翻译 + 保留原词”
- 超大请求可选分批：当待翻译内容过大时可按规则切分后分批请求（默认关闭）
- 页面批次并发：只对页面批次做限流并发（默认开启，并发数 6）

## 功能特性

- **尽量保持布局不变**：右侧译文通过 `iframe` 的 `srcdoc` 方式渲染克隆页面 HTML，尽量保留原 DOM/CSS 布局。
- **左右分屏对照**：原页面在左、译文在右。
- **仅显示译文**：译文全屏覆盖显示，并提供悬浮按钮在“单栏译文 / 双栏对照”之间切换（无需重新翻译）。
- **滚动同步（分屏模式）**：支持自动识别左右两侧的主滚动容器，再按滚动百分比同步，兼容部分使用内部滚动容器的网页。
- **词库（Markdown）**：
  - `# 无需翻译`：保持原词不变（原样输出）。
  - `# 特定翻译`：固定翻译规则 `Term: 翻译`，输出时需保留原词在括号中，例如 `智能体(Agent)`。
- **专业翻译 Prompt**：针对 CS/LLM/论文语体优化，并避免强行翻译公式/变量/算符/代码片段。

## 工作原理

1. 内容脚本在页面中创建右侧 `iframe`（`srcdoc`），内容为当前页面 HTML（`document.documentElement.outerHTML`）。
2. 为避免 React/Next.js 等框架在克隆页里执行脚本产生崩溃（hydration），该 `iframe` 通过 `sandbox` 禁止脚本执行。
3. 从 `iframe` DOM 中提取可翻译文本节点（排除 `script/style` 等），交由后台 `service worker` 调用 LLM 翻译。
4. 将译文回写到 `iframe` 的对应文本节点中，从而在保持布局的同时完成翻译展示。
5. 在分屏模式下，自动识别左侧原页面和右侧译文页各自的主滚动容器，并做滚动联动。

## 安装（开发者模式）

1. 打开 Chrome，访问 `chrome://extensions/`。
2. 打开右上角 **开发者模式**。
3. 点击 **加载已解压的扩展程序（Load unpacked）**，选择本目录：
   - `translate_webpage/`

## 使用方法

1. 打开任意网页。
2. 点击插件图标。
3. 如果还没有接入点，点击 **Manage Endpoints**。
4. 在接入点管理页中可：
   - 新建一个模型接入点
   - 编辑已有接入点
   - 删除接入点
   - 设为当前使用的接入点
5. 每个接入点保存一套完整配置：
   - **接入点名称**
   - **接入模式**：`ModelHub` 或 `Standard Bearer`
   - **API URL**
   - **API Key**
   - **Model Name**
   - **Target Language**
   - **Input Price / 1M Tokens**
   - **Output Price / 1M Tokens**
   - **Estimated Output Ratio**：译文输出倍率预估，默认 `1.2`
6. 回到弹窗后，选择当前要使用的接入点。
7. 点击 **Save Preferences** 时，会保存：
   - 当前选中的接入点
   - 运行参数和界面开关
8. 可选开关：
   - **显示模式**：双页面对比 / 仅显示译文
   - **大文本分批**：当 `userPrompt` 超过 4096 词时自动切分并分批请求（默认关闭）
   - **页面批次并发**：页面批次翻译并发（默认开启，并发数 6；不对后台切词子分片并发）
   - **测试调试信息**：在页面左下角显示文本节点数、批次数、批处理模式和耗时，便于离线回归
9. 可先点击 **Estimate Current Page** 查看：
   - 文本节点数
   - 预估输入 / 输出 / 总 Tokens
   - 预计页面批次数
   - 预计大 Prompt 分片数
   - 预估成本
10. 点击 **Translate Current Page** 时，插件会先自动做一次预估，再由你确认是否继续翻译。

其中：

- `ModelHub`：适用于 `ak` 通过 URL 查询参数传递的接口
- `Standard Bearer`：适用于类似 `Authorization: Bearer <API_KEY>` 的标准模式，可手动填写如 `https://api.deepseek.com/chat/completions`

## 本地存储说明

- 模型接入点保存在插件自己的 `chrome.storage.local` 中，不会写入仓库工作区文件。
- 普通网站无法直接读取你插件的本地存储内容，也无法直接拿到其中的 API Key。
- 这并不等于绝对安全：如果本机中毒、浏览器资料目录被拷走、安装了恶意扩展，仍然可能泄露。
- 因此更安全的实践是：
  - 不把接入点配置导出并上传到公共位置
  - 不把包含 API Key 的配置文件提交到 GitHub
  - 尽量使用权限收敛、额度可控的 API Key

## 词库编辑（Markdown）

在插件弹窗中点击 **Edit Glossary 词库配置** 可打开词库编辑页面。

默认示例：

```markdown
# 无需翻译
- token

# 特定翻译
- Agent: 智能体
```

## 注意事项 / 局限

- 译文页面所在的 `iframe` 内 **不执行脚本**：布局更稳定，但右侧译文页上的交互（按钮、导航、动态加载等）可能不可用。
- 某些网站内容是动态渲染/懒加载的：克隆页反映的是你点击翻译时刻的 DOM 状态。
- 滚动同步已经支持“自动识别主滚动容器”，但对于使用 `transform` 做假滚动、强依赖脚本驱动滚动、无限滚动或高度持续变化非常大的页面，仍可能不够稳定。
- 大页面可能触发 API 限流或超时：
  - 可关闭 **页面批次并发**，回退到串行请求以降低限流风险。
  - 对超大输入可选择开启 **大文本分批**（后台切分后的子分片仍串行，以减少术语漂移）。

## 排障

- **点击翻译无反应**
  - 可能是当前标签页在安装/更新插件之前打开，内容脚本尚未注入。插件已支持点击翻译时动态注入，但如仍异常，可在 `chrome://extensions/` 里重新加载插件并刷新页面重试。

- **右侧出现 “Application error: a client-side exception...”**
  - 常见于 Next.js/React 等在克隆页里执行 hydration 失败。插件通过 `iframe sandbox` 禁止脚本执行来规避此问题。

- **限流 / API 错误**
  - 先尝试关闭 **页面批次并发**。
  - 查看后台日志：`chrome://extensions/` -> 本插件 -> **Service worker** -> Console。

- **有些网站能同步滚动，有些不能**
  - 当前版本会自动识别主滚动容器，已经比单纯监听 `window` 更稳。
  - 如果目标网站使用了自定义滚动库、`transform` 假滚动、无限加载或高度变化过大，滚动同步仍可能失效或不够精准，这是当前网页结构本身带来的限制。

## 离线测试页

项目内置了一组固定测试页面，便于做手工回归。

1. 在项目根目录执行：

```bash
python3 -m http.server 8123
```

2. 在浏览器打开：
   - `http://127.0.0.1:8123/fixtures/index.html`
3. 使用插件分别测试：
   - `article-basic.html`
   - `tech-doc.html`
   - `internal-scroll.html`
   - `dynamic-content.html`
4. 结合 `fixtures/regression-checklist.md` 记录结果。

建议在测试时开启 **测试调试信息**，便于观察本次翻译的文本节点数、批次数和总耗时。

## 文件结构

- `manifest.json`：插件清单（MV3）
- `provider-config.js`：供应商定义与配置迁移逻辑
- `endpoint-storage.js`：模型接入点存储与迁移逻辑
- `endpoints.html|css|js`：接入点管理页面
- `providers.js`：provider adapter 与统一请求封装
- `popup.html|css|js`：弹窗配置页
- `glossary.html|js`：词库编辑页
- `content.js|css`：页面克隆、UI、翻译回写
- `background.js`：模型调用、Prompt、可选分批切分逻辑
- `fixtures/`：离线测试页面、说明和回归清单
