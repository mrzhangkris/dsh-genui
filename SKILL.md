---
name: genui
description: Render interactive UI components inline in your reply via the dsh-ui fence (plot/mermaid/scene3d/charts/tables/forms/3D). Use when the user asks you to 画/展示/可视化/生成界面/做图表/演示数据, or when a structured dashboard, chart, diagram, table, form, or 3D scene would answer better than prose. Emit a ```dsh-ui fence with a JSON spec; the GUI renders it as real components where the fence sits.
---

# GenUI — 生成式 UI 输出规范

你可以**在回答正文中间**输出可交互 UI 组件：写一个 `dsh-ui` 围栏（fenced block with language tag `dsh-ui`），内含 JSON 规格，渲染器会把这一整块画成真实组件，文字照常穿插在前后。组件**就是回答的一部分**，不是工具调用。

```dsh-ui
{"title":"可选标题","gap":14,"items":[...]}
```

## 组件词汇（只允许这些 type）

布局：`text` `row` `col` `grid` `card` `divider` `spacer`
展示：`stat` `badge` `progress` `list` `table` `keyvalue` `avatar` `timeline` `file-tree` `breadcrumb` `diff` `json` `code` `callout` `steps`
图表：`chart`（bars/line/donut，可多序列）`plot`（数学函数图）
交互：`button` `input` `select` `checkbox` `radio` `switch` `textarea` `tabs` `accordion` `copy`
高级：`mermaid`（流程图/时序/甘特等）`scene3d`（3D WebGL）`quiz`（点选判题 + 解析 + 重试）
学习：`slider`（通用滑块）`formula`（公式推演）`sort`（拖拽排序）`match`（配对）`classify`（归类）`simulation`（过程模拟）

### 布局
- text: `{"type":"text","size":"h1|h2|h3|body|muted|caption","content":"...","center":true?}`
- row / col: `{"type":"row"|"col","items":[...],"wrap":true?,"spacer":true?,"gap":n?}`
- grid: `{"type":"grid","cols":n,"items":[...]}`
- card: `{"type":"card","title":"...","items":[...]}`
- divider: `{"type":"divider"}`; spacer: `{"type":"spacer"}`

### 展示
- stat: `{"type":"stat","label":"...","value":"...","delta":"+12.4%|-3%"}`（`-` 开头自动红、`+` 绿）
- badge: `{"type":"badge","label":"...","tone":"success|warn|danger|accent","icon":"emoji?"}`
- progress: `{"type":"progress","label":"...","value":0-100,"valueLabel":"70%"}`
- list: `{"type":"list","items":["..."] 或 [{"title":"...","desc":"..."}]}`
- table: `{"type":"table","columns":["..."],"rows":[["...","..."]]}`
- keyvalue: `{"type":"keyvalue","pairs":[{"key":"...","value":"..."}]}`
- timeline: `{"type":"timeline","items":[{"title":"...","desc":"...","time":"..."}]}`
- file-tree: `{"type":"file-tree","items":[{"name":"...","type":"file|dir","children":[...]?}]}`
- breadcrumb: `{"type":"breadcrumb","items":["首页","设置","账户"]}`
- diff: `{"type":"diff","diffs":[{"path":"...","oldText":"..."|null,"newText":"..."}]}`
- json: `{"type":"json","value":...}`（JSON 树查看器）
- code: `{"type":"code","lang":"ts","code":"..."}`
- callout: `{"type":"callout","tone":"info|success|warning|error","title":"...","content":"..."}`
- steps: `{"type":"steps","current":n,"steps":[{"title":"...","desc":"..."}]}`

### 图表
- chart: `{"type":"chart","kind":"bars|line|donut","data":[{"label":"...","value":n,"color":"#hex?"}],"series":[...]?}` — bars 默认；line 趋势；donut 占比；series 字段 = 分组柱状图
- plot: `{"type":"plot","series":[{"expr":"a*sin(b*x)","label":"...","color":"#hex?","params":[{"name":"a","value":1,"min":0,"max":5,"animateTo":3,"durationMs":4000,"loop":true},{"name":"b","value":1,"min":0.5,"max":5}]}],"xMin":-6.28,"xMax":6.28,"title":"..."}` — SVG 函数图；**params 渲染成实时滑块**（拖动即时重绘，**y 轴锁定**=只变曲线不变数轴）；**animateTo 参数会显示播放按钮**（自动动画演示）；SVG 可拖拽平移、滚轮缩放；表达式支持 sin/cos/tan/asin/acos/atan/sqrt/cbrt/exp/log/ln/abs/floor/ceil/round/min/max/pow，常量 pi/e/tau，变量 x（其他字母=参数）

### 交互
**action 字段（v2）**：button/input/select/checkbox/radio/switch 可带 `"action":"名字"` —— 用户点击/切换时会把 `[genui-action] 名字` 发回给你（模型），你可以据此响应（如"点击了刷新 → 重新生成数据"）。
- button: `{"type":"button","label":"...","tone":"primary|danger|success|ghost","full":true?,"small":true?,"icon":"emoji?","action":"refresh"?}`
- input: `{"type":"input","label":"...","placeholder":"...","inputType":"text|email|password","value":"..."}`
- select: `{"type":"select","label":"...","options":["...","..."]}`
- checkbox: `{"type":"checkbox","label":"...","checked":true?}`
- radio: `{"type":"radio","label":"...","options":["...","..."],"selected":n?}`
- switch: `{"type":"switch","label":"...","checked":true?}`
- textarea: `{"type":"textarea","label":"...","placeholder":"...","rows":n?,"value":"..."}`
- tabs: `{"type":"tabs","tabs":[{"label":"...","items":[...]}]}`
- accordion: `{"type":"accordion","items":[{"title":"...","items":[...]}]}`
- copy: `{"type":"copy","label":"复制","text":"..."}`

### 高级
- mermaid: `{"type":"mermaid","code":"graph TD\\nA-->B"}` — flowchart/sequence/class/gantt/pie/er/state/journey
- scene3d: `{"type":"scene3d","title":"...","meshes":[{"shape":"box|sphere|cone|cylinder|torus","color":"#hex?","size":n|[w,h,d]?,"position":[x,y,z]?,"rotation":[rx,ry,rz]?,"scale":n?|[...]?}],"ambient":0-2?,"background":"#hex?"}` — 3D WebGL，可拖拽旋转、滚轮缩放；mesh 数量 1–5 个
- quiz: `{"type":"quiz","question":"...","options":[{"label":"...","correct":true?,"feedback":"..."?}],"explanation":"...","id":"..."?}` — 教学问答：点选即判题、可重试；`id` 变化时重置

### 学习
- slider: `{"type":"slider","label":"速度","value":2,"min":0,"max":5,"step":0.5,"unit":"m/s","action":"speed"?}`
- formula: `{"type":"formula","label":"推导","expression":"a^2+b^2=c^2","steps":[{"expression":"c=\\sqrt{a^2+b^2}","explanation":"开方"}]}`
- sort: `{"type":"sort","prompt":"按顺序排列","items":["巡航","点火"],"answer":["点火","巡航"],"action":"sorted"?}`
- match: `{"type":"match","prompt":"完成配对","pairs":[{"left":"H_2O","right":"水"}],"action":"matched"?}`
- classify: `{"type":"classify","prompt":"拖入正确分类","groups":[{"label":"哺乳类","items":["鲸"]},{"label":"鱼类","items":["鲫鱼"]}],"action":"classified"?}`
- simulation: `{"type":"simulation","title":"过程演示","steps":[{"label":"点火","content":"消耗令牌"},{"label":"巡航","content":"产生能量"}],"intervalMs":1200,"loop":true?,"action":"step"?}`

## 使用规则

1. **围栏放哪，组件就出现在哪** —— 文字在前后自然流动，不要用工具、不要解释"这是一个围栏"。**围栏一闭合就立即渲染**（不等整条回答结束），所以可以边写文字边出组件
2. **组合优先**：复杂界面用 `grid`+`card`+`stat`+`table` 拼，不要追求单一巨型组件
3. **JSON 必须严格合法**：非法围栏会退化成纯代码块。不要在 JSON 字符串里放 markdown
4. **不要嵌套围栏**：dsh-ui 里不要再包 ``` 代码围栏
5. **深色主题友好**：配色选深底亮色；UI 主题跟随应用
6. **场景判断**：用户要"画/展示/可视化/看数据/演示"时用；纯文字问答不需要
7. **图表范围**：`plot` 给合理 xMin/xMax（如 -3.14 到 3.14）；3D 场景 mesh 少而精
8. **规格要紧凑**：整棵组件树 ≤200 节点、≤8 层嵌套（超出部分会被渲染器裁掉），避免巨型 spec
