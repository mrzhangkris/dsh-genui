---
name: genui
description: |
  Render interactive UI inline in your reply via the dsh-ui fence (callouts/lists/tables/charts/mermaid/steps...). Use whenever structured presentation beats prose: 要点、对比、流程、状态、数据、演示. Emit a ```dsh-ui fence with a JSON spec.
---

# GenUI — 生成式 UI 输出规范

你可以**在回答正文中间**输出可交互 UI 组件：写一个 `dsh-ui` 围栏（fenced block with language tag `dsh-ui`），内含 JSON 规格，渲染器会把这一整块画成真实组件，文字照常穿插在前后。组件**就是回答的一部分**，不是工具调用。

**必填字段规则**：`?` 结尾的字段为可选，无 `?` 的字段为必填。缺失必填字段的节点会被渲染器丢弃并显示警告——必须补全才能正常渲染。

**发出前自检（JSON 必须严格合法）**：渲染器的**自动修复只兜底标点级与部分结构级错误，且在渲染路径上不可见**——标点级：字符串内半角引号、尾随逗号、`=` 误当键值分隔符（`"a"="1"`→`"a":"1"`）；结构级（仅已完结消息）：补缺的闭合引号/括号、`"type"` 掉在根对象外挪回对象内；**字段名与结构错误唯一可靠的发现途径是 `validate_dsh_ui`**。修不出来的结构错误会红横幅退化成代码块，写错就重发。**最容易犯的错：字符串值里用了半角引号 `"`**——中文引语一律写 `“”` 或 `「」`。发出围栏前自检：① 键值分隔符必须是 `:`（`=` 是错的）② 括号配对：`{` 与 `}`、`[` 与 `]` 数量相等，**收尾序列逐个核对**（长表格最易在最后几行错位：把 `]]}]}` 写成 `]}]}]}`；`"type"` 必须写在对象**内部**，不要补在闭合 `}` 之后）③ 无尾随逗号 ④ 值内引号用中文引号 ⑤ 最后一个字符必须是 `}`。不要在 JSON 字符串里放 markdown；超长表格/列表拆成多个组件分开发，宁短勿长

**四类实测最高频错误（黑名单）**：
1. 给 `callout`/`badge` 写 `type_` 而不是 `tone`（语气/配色字段只能叫 `tone`）
2. 给 `code`/`mermaid` 写 `value` 而不是 `code`（代码内容的字段名是 `code`）
3. 给 `table` 写 `headers` 而不是 `columns`（表头字段的名字是 `columns`）
4. `table` 的 `rows` ≥5 行（含 5 行）必须先 validate，否则极易在最后几行括号错位（自回归生成没有全局括号账本）；小表格（rows <5）可不验证

```dsh-ui
{"title":"可选标题","gap":14,"items":[...]}
```

## 组件词汇（只允许这些 type）

**不要发明类型**：只有下列白名单 type 会被渲染；白名单外（如 `summary`）会报 `unknown type` 并被丢弃——用 `callout`/`badge`/`table` 等替代。
**容器/叶子三分法**：
1. **嵌套容器**（`items` 里装的是子组件，可继续嵌套）：`row`/`col`/`grid`/`card`，以及三种自带嵌套字段的组件——`tabs`（`tabs[].items`）、`accordion`（`items[].items`）、`file-tree`（`children`）
2. **数据数组叶子**（数组字段只装数据对象，不再嵌子组件）：`list` `table` `steps` `timeline` `keyvalue` `breadcrumb` `radio` `select` `quiz` `scene3d` `diff`
3. **纯叶子**（单对象、没有任何子数组字段）：`text` `stat` `callout` `badge` `progress` `divider` `spacer` `code` `json` `copy` `mermaid` `plot` `chart` `echart` `diagram` `avatar` `link` `audio` `video`

**给第三类（纯叶子）写 `items` 会被整体丢弃**；想并排放多个 `stat` 用 `grid` 包。

布局：`text` `row` `col` `grid` `card` `divider` `spacer`
展示：`stat` `badge` `progress` `list` `table` `keyvalue` `avatar` `timeline` `file-tree` `breadcrumb` `diff` `json` `code` `callout` `steps`
图表：`chart`（bars/line/donut，可多序列）`plot`（数学函数图）`echart`（preset 快捷图或原生 option）
交互：`button` `input` `select` `checkbox` `radio` `link` `switch` `slider` `textarea` `tabs` `accordion` `copy`
高级：`mermaid`（流程图/时序/甘特等）`scene3d`（3D WebGL）`quiz`（点选判题 + 解析 + 重试）`diagram`（编辑级架构/流程图，27 种 kind）

**名字对照警告（写错静默失效）**：`tone` 的取值集合**因组件而异**——`callout` 的 tone 是 `info|success|warning|error`，`badge` 的 tone 是 `success|warn|danger|accent`。`warn` ≠ `warning`、`danger` ≠ `error`：给 callout 写 `warn`、给 badge 写 `warning`/`error` 都**不会报错**，只会静默失效（tone 不生效）——写前对照下方各组件的字段定义。

### 布局
- text: `{"type":"text","size":"h1|h2|h3|body|muted|caption","content":"...","center":true?}`
- row / col: `{"type":"row"|"col","items":[...],"wrap":true?,"spacer":true?,"gap":n?}`
- grid: `{"type":"grid","cols":n,"items":[...]}`
- card: `{"type":"card","title":"...","items":[...]}`
- divider: `{"type":"divider"}`; spacer: `{"type":"spacer"}`

### 展示
- stat: `{"type":"stat","label":"...","value":"...","delta":"+12.4%|-3%","unit":"ms"}`（`-` 开头自动红、`+` 绿）— 只有 `label`/`value`/`delta`/`unit` 四个字段；单位也可直接写进 value 字符串（如 `"value":"72%"`），不必拆 unit
- badge: `{"type":"badge","label":"...","tone":"success|warn|danger|accent","icon":"emoji?"}`
- progress: `{"type":"progress","label":"...","value":0-100,"valueLabel":"70%"}`
- list: `{"type":"list","items":["..."] 或 [{"title":"...","desc":"..."}]}`
- table: `{"type":"table","columns":["..."],"rows":[["...","..."]]}` — 表头点击本地排序（升/降/还原，数值感知，零往返）；rows ≥5 行（含 5 行）先 validate 再发，并优先拆小表（最后几行括号错位高发）
- keyvalue: `{"type":"keyvalue","pairs":[{"key":"...","value":"..."}]}`（pairs 必填）
- avatar: `{"type":"avatar","name":"...","color":"#hex?"}` — 名字首字符渲染成头像圆点；`color` 缺省时按名字哈希自动配色
- timeline: `{"type":"timeline","items":[{"title":"...","desc":"...","time":"..."}]}`
- file-tree: `{"type":"file-tree","items":[{"name":"...","type":"file|dir","children":[...]?}]}` — 目录行可点击折叠/展开（本地，零往返）
- breadcrumb: `{"type":"breadcrumb","items":["首页","设置","账户"]}`
- diff: `{"type":"diff","diffs":[{"path":"...","oldText":"..."|null,"newText":"..."}]}`
- json: `{"type":"json","value":...}`（JSON 树查看器）
- code: `{"type":"code","lang":"ts","code":"..."}`
- callout: `{"type":"callout","tone":"info|success|warning|error","title":"..."?,"content":"..."}`（content 必填）
- steps: `{"type":"steps","current":n,"steps":[{"title":"...","desc":"..."}]}`
- image: `{"type":"image","src":"/mmx-files/result.png","alt":"结果图片"?}` — 展示浏览器可访问的 http(s) 或同源相对图片地址；懒加载；不支持 `file:`/`data:` 等本地或主动协议
- audio: `{"type":"audio","src":"https://.../a.mp3","alt":"..."?,"loop":true?}` — 音频播放器（原生控件）；`src` 仅接受 http(s) 或同源相对路径
- video: `{"type":"video","src":"https://.../a.mp4","poster":"..."?,"loop":true?,"muted":true?,"aspectRatio":"16:9|4:3|1:1|9:16"?}` — 视频播放器（原生控件，不自动播放）

### 图表
- chart: `{"type":"chart","kind":"bars|line|donut","data":[{"label":"...","value":n,"color":"#hex?"}],"series":[...]?}` — bars 默认；line 趋势；donut 占比；series 字段 = 分组柱状图；负值数据：柱高为 0 但数值标注照显、donut 负值记 0 弧长（line 正常画负区间）
- plot: `{"type":"plot","series":[{"expr":"a*sin(b*x)","label":"...","color":"#hex?","params":[{"name":"a","value":1,"min":0,"max":5,"animateTo":3,"durationMs":4000,"loop":true},{"name":"b","value":1,"min":0.5,"max":5}]}],"xMin":-6.28,"xMax":6.28,"title":"..."}` — SVG 函数图；**series 可带 `"kind":"line|area|scatter"`**（缺省 line；area 填色到基线；scatter 散点）；**params 渲染成实时滑块**（拖动即时重绘，**y 轴锁定**=只变曲线不变数轴）；**animateTo 参数会显示播放按钮**（自动动画演示）；SVG 可拖拽平移、滚轮缩放；表达式支持 sin/cos/tan/asin/acos/atan/sqrt/cbrt/exp/log/ln/abs/floor/ceil/round/min/max/pow，常量 pi/e/tau，变量 x（其他字母=参数）
- echart: `{"type":"echart","preset":"bar|line|area|pie|scatter","data":[...],"series":[...]?}` — ECharts 主题化图表，`data`/`series` 格式同 `chart`（简写模式）；需要 dataZoom/visualMap/堆叠/仪表盘等高级能力时改用 `"option":{标准 ECharts option}`（全功能模式，option/data/series 至少给一个）。`title`、`height`(100–800) 可选。option 内的字符串值不得含 HTML 标签、`on*=` 事件属性或 `url()`（会被安全过滤剔除该字段）

### 交互
**本地优先（v2.6）**：UI 自己能做的状态变化——判卷、判题、重置、展开、折叠、切换、选中、排序——一律本地即时完成，**零模型往返**。action 只用于必须模型参与的事（生成新内容、执行工具、下一步建议）。

**action 分工（关键）**：
- **不需要 action 的交互**：radio 勾选（group 模式）、checkbox、switch、tabs 切换、accordion 折叠、table 排序、file-tree 展开、slider 拖动、quiz 判题、submit 判卷（带 answer）——全部本地完成，**不带 action、不发往返**。
- **必须带 action 的**：button 执行动作（刷新/生成/操作）、input/textarea/select/slider 需要模型响应的提交、submit 汇总未判卷表单——带 action 才会回传。
- **不带 action 的 button 渲染为禁用态**（用户点不了，仅作展示）；带 action 的 button 点击后有「已触发」本地反馈。
- button: `{"type":"button","label":"...","tone":"primary|danger|success|ghost","full":true?,"small":true?,"icon":"emoji?","action":"refresh"?}`
- **秘密禁令**：不得索取或生成密码、API Key、访问令牌、恢复码等秘密输入；遇到此类需求直接拒绝并解释
- input: `{"type":"input","label":"..."?,"placeholder":"..."?,"inputType":"text|email"?,"value":"..."?,"action":"name"?,"id":"field-id"?}` — 全部字段可选；action 在失焦**和回车**时触发（回车带 `submit:true`）；**blur 仅值有变化才发送**（聚焦又离开不产生空往返）；payload 带 `id` 帮模型定位字段；带 `id` 的值刷新后保留、并被 submit 收集进 `fields`
- select: `{"type":"select","label":"..."?,"options":["...","..."],"selected":下标?,"action":"pick"?,"id":"field-id"?}` — 只有 `options` 必填；`selected` 预选某选项（缺省显示「请选择…」占位，不静默预选第一项）；带 `id` 的选择跨刷新保留并进 submit 的 `fields`
- checkbox: `{"type":"checkbox","label":"...","checked":true?,"action":"toggle"?}`
- slider: `{"type":"slider","label":"..."?,"min":0?,"max":100?,"step":1?,"value":n?,"action":"name"?,"id":"field-id"?}` — 数值表单滑块（全字段可选，`min`/`max`/`value` 缺省 0/100/取下限）：实时显示数值；带 `id` 跨刷新保留并进 submit 的 `fields`（拖拽经防抖合并成一次 action）
- radio: `{"type":"radio","label":"...","options":["...","..."],"selected":n?,"action":"pick"?}` — 单选；**加 `"group":"题目名"` 进入聚合模式**：选择只本地记录、不发往返；**加 `"answer":正确下标或标签` + `"explanation":"解析"` 后，交卷在本地判卷**
- link: `{"type":"link","label":"...","href":"https://..."?}` — 仅 http(s)/mailto 协议被接受；无 `href` 时渲染为纯文本样式（不会假装可点）
- submit: `{"type":"submit","label":"交卷","action":"grade"?,"groups":["q1","q2","q3"],"resetAction":"redo"?}` — 交卷按钮：**题目带 answer 时点击本地立即判卷**（得分 + 每题 ✓/✗ + 解析，零往返），并锁定题目，点「重新作答」本地重置（`resetAction` 可选通知你）；**只有题目都没带 answer 时才**汇总成一次 `[genui-action]`（payload: `{answers:{q1:选项A,...},fields:{id:值},total,answered}`，`fields` 收集所有带 `id` 的输入）；`groups` 列出的题全部答完才可点
- switch: `{"type":"switch","label":"...","checked":true?,"action":"toggle"?}`
- textarea: `{"type":"textarea","label":"..."?,"placeholder":"..."?,"rows":n?,"value":"..."?,"action":"save"?,"id":"field-id"?}` — 全部字段可选；action 在失焦和 **Ctrl/Cmd+Enter** 时触发；blur 仅值有变化才发送；带 `id` 的值刷新后保留
- tabs: `{"type":"tabs","tabs":[{"label":"...","items":[...]}]}`
- accordion: `{"type":"accordion","items":[{"title":"...","items":[...]}]}`
- copy: `{"type":"copy","label":"复制","text":"..."}`

**状态持久化（v2.7）**：答案、交卷锁定、输入值按「会话 + 内容指纹」自动保存——用户刷新页面/重开会话，同一块 UI 的状态原样恢复；你重渲染**相同内容**会保留用户状态，渲染**新内容**（换题等）自动从头开始。

**卷子模式（多道选择题）**：每题一个 radio（带唯一 `group` + `answer` + `explanation`），最后放一个 submit（`groups` 列出全部题号）——用户全部选完点交卷，**分数和对错当场在 UI 里出现**，不用等你。只有换新题/进阶建议才发 action。不要每题单独发 action（会刷屏）。

### 高级
- mermaid: `{"type":"mermaid","code":"graph TD\nA-->B"}`（示例里的 `\n` 是 JSON 换行转义，解析后即真实换行——用来分隔图语句；**节点标签内**换行才用 `<br/>`）— flowchart/sequence/class/gantt/pie/er/state/journey；主题自动跟随宿主（暗/浅）。**节点文本三戒**：① 含 `()`/`[]`/特殊字符必须加引号 `["text"]`（裸写会被解析成圆柱体等形状语法，整图降级显示源码）② 节点内换行只用 `<br/>`（`\n` 会显示为字面文本）③ style 颜色写六位 hex（`#4a6` 简写部分渲染器不认）
- scene3d: `{"type":"scene3d","title":"...","meshes":[{"shape":"box|sphere|cone|cylinder|torus","color":"#hex?","size":n|[w,h,d]?,"position":[x,y,z]?,"rotation":[rx,ry,rz]?,"scale":n?|[...]?}],"ambient":0-2?,"background":"#hex?"}` — 3D WebGL，可拖拽旋转、滚轮缩放；mesh 数量 1–5 个
- quiz: `{"type":"quiz","question":"...","options":[{"label":"...","correct":true?,"feedback":"..."?}],"explanation":"...","id":"..."?,"action":"answer"?}` — 教学问答：点选即判题、可重试；`id` 变化时重置；带 action 时答案同时回传模型
- diagram: `{"type":"diagram","kind":"...","nodes":[{"id":"a","label":"网关","sub":"API"?,"type":"focal|backend|store|external|input|optional|security"?}],"edges":[{"from":"a","to":"b","label":"调用"?,"kind":"solid|dashed|accent|link"?}]?,"zones":[{"label":"核心区"}]?,"variant":"light|dark|editorial"?,"title":"..."?}` — 编辑级 SVG 架构图（正交连线、直角圆肘、4px 网格）。27 种 kind：**架构类**（`architecture` `it-state` `high-level` `process` `medallion` `data-flow` `dp-integration`）节点带 `x`/`y`/`w`/`h` 显式定位；**其余 kind**（`flowchart` `sequence` `state` `er` `timeline` `swimlane` `quadrant` `radar` `loop` `nested` `tree` `org-chart` `layers` `venn` `pyramid` `bar` `line` `gantt` `scatter` `dp-security-matrix`）只给 `label` 自动布局。预算：节点 ≤9、边 ≤12、区域 ≤3、`focal` 强调节点 ≤2、边标签 ≤14 字符

## 什么时候用：内容类型 → 组件映射

**判断口诀**：这段内容换成结构化组件，会不会比纯文字更好扫、更好懂、更好操作？会 → 就用，**不需要等用户开口要 UI**。

| 你要呈现的内容 | 用这些组件 |
|---|---|
| 关键结论 / 要点罗列（≥2 条） | `list`、`keyvalue`、`callout` |
| 重点强调 / 警告 / 注意事项 | `callout`（info/success/warning/error）、`badge`、`stat` |
| 数据对比 / 趋势 / 占比 | `chart`（bars/line/donut）、`table` |
| 关键指标数字 / 进度状态 | `stat`、`progress`、`badge` |
| 流程 / 步骤 / 阶段 / 时间线 | `steps`、`timeline`、`mermaid`（flowchart/sequence/gantt） |
| 目录 / 文件结构 / 层级关系 | `file-tree`、`mermaid`、`accordion` |
| 状态一览 / 检查结果 | `badge` + `table` + `progress` 组合 |
| 代码 / 配置 / 改动对比 | `code`、`diff`、`json` |
| 两个方案 / 选项对比 | `table`、`tabs`、`diff` |
| 教学 / 自测 / 判断题 | `quiz` |
| 数学函数 / 曲线关系 | `plot`（可带参数滑块、动画） |
| 需要用户操作 / 筛选 / 反馈 | `button`、`input`、`select`、`radio`、`switch`、`tabs` |
| 3D 物体 / 空间布局 | `scene3d` |
| 图片 / 截图 / 图表预览 | `image` |
| 音视频素材演示 | `audio`、`video` |
| 高级图表（堆叠/缩放/仪表盘等 ECharts 全功能） | `echart` |
| 架构图 / 系统组成 / 数据流（编辑级） | `diagram` |

**别用的情况**：一句话能说清的事、纯闲聊、用户明确说不要 UI、以及"为了炫技硬塞"——组件服务内容，不是内容服务组件。

## 使用规则

1. **围栏放哪，组件就出现在哪** —— 文字在前后自然流动，不要用工具、不要解释"这是一个围栏"。**围栏一闭合就立即渲染**（不等整条回答结束），所以可以边写文字边出组件
2. **组合优先**：复杂界面用 `grid`+`card`+`stat`+`table` 拼，不要追求单一巨型组件
3. **不要嵌套围栏**：dsh-ui 里不要再包 ``` 代码围栏
4. **深色主题友好**：配色选深底亮色；UI 主题跟随应用
5. **场景判断**：先查上面的映射表 —— 内容类型命中就上对应组件；只有纯文字问答、一句话能说清时才不用
6. **规格要紧凑**：整棵组件树 ≤200 节点、≤8 层嵌套（超出部分会被渲染器裁掉），避免巨型 spec

## 行为纪律（图表 / 主题 / 数量 / 验证）

1. **图表范围**：`plot` 给合理 xMin/xMax（如 -3.14 到 3.14）；3D 场景 mesh 少而精
2. **一个主题选一个主组件**：命中映射表后选**一种**组件承载，同一信息不要用两种组件重复表达（同一批数据又画 bars 又画 donut = 冗余）
3. **数量纪律**：一条回答 3–8 个组件为宜，宁缺毋滥。反例：该用 `table` 对比时写三段 `text`；一个 `stat` 能说清的事套 `card`+`grid`；与内容无关的 `scene3d` 炫技——3D 只在内容本身就是几何/空间时才用
4. **大表拆小**：大表格优先拆成多个小于等于 5 行的小表，或用多个 `keyvalue`/`list` 卡片替代单张大表——减少嵌套数组深度，降低括号错位概率
5. **先验后发（复杂 UI）**：spec 含**图表/嵌套容器（row/col/grid/card/tabs/accordion）任一层级**、**节点数 ≥2**，或 **rows ≥5 的表格** 时，发出 ```dsh-ui 围栏前先调用 `validate_dsh_ui` 工具（参数 `spec` 传围栏内的 JSON 文本）验证；返回 ❌ 就按错误信息（位置、括号计数、常见原因）修正后重新验证，✅ 再发出；**若 ❌ 回复里附了「已自动修复」的 JSON，直接照抄那份发出，无需再验证**。小表格（rows <5）与单个节点的极简 spec 可不验证——但记住：**渲染器的自动修复只兜底标点级与部分结构级错误且不可见，字段名与结构错误唯一可靠的发现途径是 `validate_dsh_ui`**
