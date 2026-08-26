# dsh-genui 源码 Bug 审查报告

> 审查对象：`@omdsh-dev/dsh-genui` v0.9.2（git 38b16b4，工作区副本 `开发/dsh-genui/`）
> 范围：`src/` 全部 47 个文件（~9700 行 TS/TSX），逐文件人工走查 + 关键路径实测复现
> 方法：扁鹊六层清单（正确性→安全→性能→错误处理→可读性→测试），基线信号 = vitest 全量跑 + tsc
> 日期：2026-08-26

## 基线

- `tsc --noEmit` ✅ 全绿
- vitest：372 过 / **7 挂**（见 🟠-8 测试债）/ 104 skip
- 安全架构总体扎实：白名单渲染无任意 HTML 路径；URL 协议消毒（`javascript:`/`data:`/协议相对路径全拒）；mermaid 三层防线（strict 模式 + 类型白名单 + 输出 SVG 断言）；echarts option 递归清洗（深度/数组长度/总节点三限 + HTML 危险串丢弃）；资产 HTTP 路由正则防目录遍历；password 字段不落盘不入提交。以下问题均为在这个好底子之上挑出的真 bug。

---

## 🔴 Blocker（会导致错误结果）

### 1. SafeMath 数字扫描吞掉二元 `+`/`-`，常见 plot 表达式静默画不出图
- **位置**：`src/client/safe-math.ts` parseNumber 字符类 `/[0-9.eE+\-]/`
- **问题**：数字扫描把紧随其后的二元加号/减号也当数字字符吞掉，`Number("2+1")=NaN` → ParseError → 整条表达式编译失败 → plot 返回空数据，**用户看到一张空白图，无任何报错**。
- **实测复现**（真实源码端到端）：
  - `"x^2+1"` → **0 个采样点**；`"x^2 + 1"`（加空格）→ 50 点正常
  - `"sin(x)*2+1"` → **0 个采样点**
- **影响**：LLM 写 plot 表达式不带空格是高频形态，核心功能静默失效。
- **修复**：只在 `e/E` 之后接受 `+/-`（科学计数法语义），例如改用单次正则匹配 `/^\d*\.?\d+(?:[eE][+-]?\d+)?/`。

---

## 🟠 Major（边界条件出错 / 功能缺陷）

### 2. 判卷状态持久化不完整：刷新后成绩显示「0 / 0」
- **位置**：`src/client/GenuiBlock.tsx` L85（`meta` 初始 `{}`）、L138-142（只存 answers/locked/fields）；`src/client/blocks/state.ts` `BlockInteractionState` 无 meta 字段
- **问题**：交卷后 `locked:true` 与所选答案持久化，但判分元数据 `meta`（题目/选项/正确答案/解析）不持久化。刷新后进入提交态分支时 `graded=[]`，界面显示 **「0 / 0 得分（N 题无答案未计分）」**，判卷详情列表全空，radio 还保持禁用——用户以为全答错了。
- **修复**：把 `meta` 一并序列化进 localStorage；或恢复时若 meta 缺失则不进入提交态（回退为可重答状态）。

### 3. input/textarea 初始值优先级与 select/slider 相反，刷新丢用户输入
- **位置**：`src/client/blocks/forms.tsx` L402-403（InputNode）、L471-472（TextareaNode）、L421-422（挂载 effect）
- **问题**：初始值取 `node.value ?? fields[id]`——**spec 默认值压过 localStorage 恢复值**；而 RadioNode/SelectNode/SliderNode 都是「恢复的用户选择优先」（radio 注释还明确写了这条哲学）。且挂载 effect 无条件 `setField(id, node.value)`，把用户已保存的输入在注册表里也覆盖掉。
- **后果**：模型给了默认值的输入框，用户改过并刷新后，编辑内容丢失、回到模板文本。
- **修复**：改为 `fields[id] ?? node.value ?? ''`，挂载 effect 仅当 `fields[id] === undefined` 时登记默认值。

### 4. file-tree 折叠 key 冲突：折一个目录连坐折叠另一个
- **位置**：`src/client/blocks/advanced.tsx` L317 `pathKey = (depth, i) => \`${depth}-${i}\``
- **问题**：折叠状态 Set 的 key 只有「深度+同级索引」，不同父目录下各自第 0 个子目录共用 `"1-0"`。折叠 A 目录下的子目录，B 目录同位置的子目录一起被折叠/展开。
- **修复**：key 改为从根到节点的名称路径拼接，或维护自增 id。

### 5. scene3d 懒加载卸载竞态泄漏 WebGL 上下文
- **位置**：`src/client/blocks/advanced.tsx` Scene3DNode effect（约 L266-276）
- **问题**：`if (!alive || ref.current === null) return` 在 `await m.mountScene(...)` **之前**检查；若懒加载期间组件卸载，cleanup 执行时 `dispose` 还是 undefined，随后 promise resolve 把 dispose 赋上值却无人调用 → three.js renderer/WebGL 上下文永久泄漏（挂在已脱离 DOM 的容器上）。
- **对照**：`EChartNode.tsx` L176-180 正确处理了同一竞态（late-resolve 后补 `inst.dispose()`）。
- **修复**：`dispose = await m.mountScene(...)` 之后补一段 `if (!alive) { dispose(); return }`。

### 6. plot 参数动画 `loop:true` 只播一轮就冻结
- **位置**：`src/client/PlotBlock.tsx` 约 L205-215
- **问题**：动画播完（t≥1 且 loop）后用 `requestAnimationFrame(() => setPlaying(p => p))` 想重启——但设置的是**相同的 state 值**，React Object.is 判等直接 bailout，effect 依赖不变不重跑，rAF 链就此断掉。
- **修复**：在 tick 内部直接续接 rAF 循环，或 bump 一个递增的 round 值进依赖数组。

### 7. tabs 的 `content` 别名 repair 认、validate 不认：validate_dsh_ui 误报
- **位置**：`src/client/guard.ts` repairTabs（L681-684 接受 `items ?? content`）vs validateGenuiSpec tabs case（L1369-1379 只 walk `t.items`）
- **问题**：`tabs:[{label, content:{…}}]` 渲染完全正常，但 validate_dsh_ui 工具报 `tabs[0].items must be an array` 之类的 ❌——模型被误导去"修复"一个没坏的 spec，甚至放弃发出可用的围栏。v0.9.3（38b16b4）刚修过 `children` 别名的同类问题，tabs 的 `content` 别名漏掉了。
- **修复**：validator 的 tabs 分支同样接受 `t.items ?? t.content`（单对象包成数组）。

### 8. 测试债：7 个失败用例让 CI 常红，掩盖真回归
- **位置**：`tests/genui-asset-loader.spec.ts`（4 例）+ `tests/plugin-genui.spec.ts`（1 例）：硬编码旧包名 `@changfenhuang/dsh-genui`，源码已改名 `@omdsh-dev/dsh-genui`（连 rev 缓存参数用例也因此假失败——rev 逻辑本身没问题，已人工核对 asset-loader.ts L39-43）
- `tests/genui-fence-fallback.spec.tsx`（2 例）：期望 v0.9.3 之前「静默修复」，现在按设计会显示校验警告条
- **影响**：红着 CI 上任何新回归都会被淹没在这些已知噪音里。
- **修复**：更新 PLUGIN_ID 常量与 healing 用例预期，恢复全绿基线。

---

## 🟡 Minor

| # | 位置 | 问题 | 建议 |
|---|---|---|---|
| 9 | guard.ts L405-406 | `json` 节点的 `value` 无大小/深度上限直通透传（对比 echart option 有三重限制），超大 payload 的 JSON.stringify 可卡主线程；目前只靠宿主消息长度隐性兜底 | 给 value 加字节上限或节点预算 |
| 10 | mermaid-safe.ts L15 | `SVG_INJECTION` 正则不含 `/` 分隔属性（如 `<svg/onload=x>` 绕过 `[\s"']on...=`），当前靠 mermaid strict 模式兜底 | 正则补 `/` 或改用 DOMPurify 校验 |
| 11 | index.tsx L50 | prefetch 去重把 `assetUrl()` 结果直接插进属性选择器，rev 含引号/反斜杠会抛 DOMException（boot 数据可信度高的防御性问题） | `CSS.escape()` 或 try/catch |
| 12 | dom-fence.tsx L162-165 | rawOf 的 if/else 两分支代码完全相同（死逻辑，疑似漏写某种过滤） | 删分支或补齐意图 |
| 13 | dom-fence.tsx | 每秒 sweep 对每个 block 跑 `querySelectorAll('*')`，长会话近似 O(n²)；后台标签页 interval 仍跑 | 缓存候选集 / visibilitychange 暂停 |
| 14 | charts.tsx bars 标签行 | `key={d.label}`，重复 label 触发 React duplicate key | 改 `key={i}` |
| 15 | charts.tsx grouped bars | 只读第一个 series 的 labels，其余 series 超出部分不渲染、label 集不同时按索引错位 | 按 label 并集对齐 |
| 16 | fence-render.tsx L151/L191 | 流式期间对 prefix spec 跑 validate → 警告条随 chunk 闪烁；stateKey 每渲染两次 JSON.stringify(spec) | settled 后再 validate / memo 化 |
| 17 | panel-store.ts | 每次 op 全量 read+parse+stringify localStorage；重载后 replayBarrier=maxSeenSeq 时同 seq 新 source 被静默 blocked（边缘时序） | 写合并/防抖；barrier 用 `<` 并记日志 |
| 18 | advanced.tsx L225 | CopyNode 的 1.5s setTimeout 无清理（React 18 下无害，属模式遗漏） | useEffect 管理 timer |
| 19 | asset-loader.ts / fence-repair.ts 头注释 | 文档仍引用旧包名 `@changfenhuang`（L8/L18 等） | 随改名清理 |

## 💡 Nit

- guard.ts steps 的 `current` 允许等于 length（越界无高亮，无害）；select 空 options 时 selected 钳到 -1
- mermaid-core 主题仅在首次 init 固定，运行中主题切换不生效
- interaction-store 指纹是 32 位 djb2，理论碰撞（文档已声明非安全用途）
- toolview render_ui 无 seq 时 order=0 排最前，fold 可能被旧内容赢过（仅老日志 replay 场景）
- GenuiBlock 动作去重 Map 以 action 名为键，同名 action 300ms 内互吞 payload（语义选择，建议文档化）

## 测试盲区建议

1. safe-math：补「无空格二元运算」用例（`x^2+1` 类）——正是 🔴-1 漏网的原因
2. GenuiBlock 持久化：补「提交→刷新恢复」往返用例（会抓住 🟠-2）
3. forms：补「spec 默认值 vs 持久化值」优先级矩阵（会抓住 🟠-3）
4. validator/repair 一致性：对 gallery 全词汇分别跑 repair 和 validate 断言零分歧（会抓住 🟠-7）

---

## 修复记录

### 第一批（commit 8a3972e）：🔴×1 + 🟠×7 全部修复，测试债清零
详见分支 `fix/review-findings` 提交信息。vitest 372/7 → 391/0。

### 第二批：🟡×11 处置结果
| # | 状态 | 说明 |
|---|---|---|
| 9 | ✅ 已修 | json value 加 `maxJsonValue: 24_000` 序列化预算，超限丢节点（截断会产出非法 JSON）；不可序列化值安全丢弃 |
| 10 | ✅ 已修 | SVG_INJECTION 字符类补 `/`，封住 `<svg/onload=` 形态；自闭合标签等合法斜杠不受影响（有测试） |
| 11 | ✅ 已修 | prefetch 选择器包 try/catch，rev 异常字符不再能炸掉 boot |
| 12 | ✅ 已修 | rawOf 死分支删除（连同失业的 isTextNode） |
| 13 | ✅ 部分修复 | sweep 在 `document.hidden` 时跳过（后台标签页零开销）；O(n²) 候选扫描属结构性改造，暂留 |
| 14 | ✅ 已修 | 图表标签行 key 改索引，重复 label 不再触发 duplicate key |
| 15 | ✅ 已修 | grouped bars 按「全部 series 的 label 并集（首现顺序，capped）」对齐，逐 label 查数；series[0] 缺的标签不再消失 |
| 16 | ✅ 已修 | 警告校验仅在 settled（context.source 存在）时执行——流式期间每 chunk 的半截 spec 不再闪琥珀条；spec 指纹加单条目 memo，流式期间省去重复 stringify |
| 17 | ✅ 部分修复 | panel-store 写前比对跳过同内容写盘；replayBarrier 同 seq 边缘语义保持原样（改 fold 语义风险大于收益） |
| 18 | ✅ 已修 | CopyNode 定时器改 useRef 管理 + 卸载清理 |
| 19 | ✅ 已修 | src/ 内 29 处 `@changfenhuang` 注释引用全部更新为 `@omdsh-dev` |

💡 nits 未动（steps current==length、空 options select 钳位、mermaid 主题固化、djb2 碰撞、toolview order=0、动作去重键）——均为已文档化的设计取舍或无害边界。

第二批新增回归：json 上限×3、SVG 斜杠注入×2、grouped label 并集×1（免注册表 harness）、流式抑制警告×1。
最终基线：vitest **398 过 / 0 挂** / 104 skip，tsc 干净，build 成功。
