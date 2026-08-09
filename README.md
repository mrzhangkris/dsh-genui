# 🎨 dsh-genui

> 让模型的回答长出界面——文字还在，可交互的 UI 已经能用。

模型不再只回你文字。装上它，你问"这个月订单怎么样"，它一边分析一边在回答里渲染出一张**能点的数据面板**：看趋势、拖滑块、按刷新，模型会真的响应你。

<div align="center">

https://github.com/user-attachments/assets/f5db33ec-7471-4d4a-a85b-79c9962ab4ef

</div>

<p align="center">
  <img src="./assets/showcase-panel.png" width="92%" alt="实际渲染效果：可交互监控面板">
  <br><em>实际效果：模型输出的一块可交互监控面板（点「刷新」它会重新生成数据）</em>
</p>

> 播放器没出来可 [下载 mp4](./assets/demo.mp4)；四幕演示脚本见 [demo-prompts.md](./demo-prompts.md)。

---

## ✨ 装之前 vs 装之后

| 普通回答 | 装了 dsh-genui |
|---|---|
| "本月收入 ¥128,430，环比 +12.4%，建议关注转化率。" | 一行分析 + 旁边直接渲染：收入/订单/转化率三张统计卡、趋势图、进度条 |
| 想再看别的？再打一段字问一遍 | 面板上就有「刷新」「切换视图」按钮，点一下，模型更新数据 |

## 🚀 快速开始

前置：dsh 含 `fence-registry`（`grep -r registerFenceRenderer <dsh源码>/packages/client/ui-primitives/src/` 有输出即可）。

```sh
git clone https://github.com/dsh-external/dsh-genui.git
dsh plugin --profile web add link:/path/to/dsh-genui
```

重启 dsh web + 硬刷新。新会话里说"用 dsh-ui 画个统计看板"验证。

## 🧩 它能做什么

- **回答即界面**：组件嵌在回答里，边生成边出现，不用等整段写完
- **36+ 组件**：卡片、表格、图表、表单、标签页、折叠面板、文件树、时间线、diff……
- **函数图**：`plot` 画曲线，参数滑块拖动实时重绘，支持自动动画

<p align="center">
  <img src="./assets/showcase-plot.png" width="60%" alt="函数绘图：拖动滑块实时重绘">
</p>

- **测验**：`quiz` 点选判题 + 解析 + 重试
- **学习组件**：通用滑块、公式逐步推演、拖拽排序/配对/归类、播放/暂停/逐步推进的过程模拟
- **轻量宿主包**：`lib/standalone.js` 可直接挂进系统 WebView，不自带浏览器内核；支持动作回传和页面状态保存/恢复
- **事件循环**：按钮/开关带 `action`，点击回传模型，模型更新界面；同名 action 300ms 尾沿防抖，连点合并为一次（最后一次的值生效）
- **工具通道**：`render_ui` 工具把同一份 spec 渲染成工具行卡片（交付物型 UI 走工具、回答型 UI 走围栏）
- **自愈与上限**：每个围栏过规格守卫——坏节点静默丢弃、数值钳位、字符串截断，整树 ≤200 节点 / 8 层嵌套，病态 spec 不会拖垮界面
- **可访问性**：tabs/折叠/开关/进度条带完整 ARIA 与键盘导航（方向键切页、Home/End 跳转）
- **零打扰**：不装插件时围栏只是代码块，不报错、不污染会话

组件 JSON 语法见 [SKILL.md](./SKILL.md)（也可复制到 `~/.dsh/skills/genui/` 增强模型使用）。

## 📄 示例

模型输出这段围栏（写给浏览器看的，你不用读懂）：

```dsh-ui
{"title":"订单概览","items":[
  {"type":"stat","label":"总收入","value":"¥128,430","delta":"+12.4%"},
  {"type":"stat","label":"订单数","value":"1,024","delta":"-3.1%"}
]}
```

你看到的是两张统计卡片。

## 🔧 原理

模型把界面描述写成 JSON 放进 `dsh-ui` 围栏，浏览器端渲染器（`src/client`）通过主仓 `fence-registry` 接口认领这门语言并渲染。组件是白名单的，模型塞不进 HTML/脚本；函数表达式走独立解析器，不用 eval。

## ❓ 常见问题

- **显示成代码块？** 查三处：dsh 版本带 fence-registry、`dsh plugin --profile web list` 里有本插件、重启 + 硬刷新。
- **模型不主动输出？** 重启后新会话生效；或直接说"用 dsh-ui 输出"。
- **clone 后没有 lib/？** `pnpm install && pnpm run check` 自己构建。

## 🧑‍💻 开发

```sh
pnpm install
pnpm run check   # 类型检查 + 133 测试 + 构建
```

## 🗺️ Roadmap（已评估项）

| 方向 | 结论 | 理由 |
|---|---|---|
| 增量 patch（模型只发 diff 不重发全量 spec） | 不做 | fence 一次 200–800 token，重发代价极小；patch 协议的教学成本与出错率不值得。若未来出现秒级自动刷新面板再议 |
| action 防抖/去重 | ✅ 已做（300ms 尾沿，按 action 名独立） | 连点刷屏是真实摩擦，收口点一处改动 |
| 宿主状态持久化（回放恢复 tabs/滑块/模拟步骤） | ✅ 独立宿主包已做 | 宿主可把 `snapshot()` 结果保存，在重开时作为 `initialState` 恢复 |
| MCP 适配器 / 独立画廊页 / i18n | 不做 | 无跨工具需求信号；画廊素材已被 `gallery.ts` + demo-prompts + README 截图覆盖；内置文案仅 6 处 |

测试解析 dsh 源码（`vitest.config.ts` 的 `DSH_ROOT`，默认 `~/.dsh/source/current`）。

---

📄 License: BSD-3-Clause
