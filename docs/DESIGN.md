# dsh-genui 设计文档

> 面向：维护者 / 新会话。描述系统的架构、数据流与关键机制的设计取舍。
> 状态基线：v0.11.0（三线合并后），45 个白名单组件，src 46 文件 ~11.3k 行。

## 1. 是什么

DSH（DeepSeek Harness）的 GenUI 插件：模型在回答中输出 ``` `dsh-ui` ``` 围栏（JSON 组件树），客户端把它渲染为真实交互组件（布局/表格/表单/图表/绘图/mermaid/3D/图片）。组件交互可经 `[genui-action]` 回传模型形成闭环。一个包三个半面：

| 半面 | 位置 | 运行环境 |
|---|---|---|
| node 插件半面 | `src/plugin/`（系统提示注入 + render_ui/validate_dsh_ui 工具 + 引擎资产路由） | DSH 宿主 node 进程 |
| 浏览器渲染半面 | `src/client/`（围栏→组件树渲染 + 交互回传 + 面板） | 宿主 web 前端 |
| 共享修复层 | `src/shared/fence-repair.ts`（纯字符串 JSON 修复，两端共用） | 两端 |

## 2. 渲染通道（两条，殊途同归）

```
模型输出 fence JSON
   │
   ├─ Registry 通道（契约宿主）：宿主 MarkdownText 经 fence-registry 扩展点
   │   调 renderGenuiFence(raw, key, context)        [src/client/fence-render.tsx]
   │   不可修复 body → FenceFallback（代码块 + 红横幅诊断 + 可选失败回传模型）
   │
   └─ DOM 通道（纯净宿主）：MutationObserver 扫 DOM 找 dsh-ui 代码块
       [src/client/dom-fence.tsx] 挂插件自己的 React root，先挂载后隐藏原块
       （issue #19 不变量：替换失败绝不隐藏原文）
```

## 3. 解析修复管线（fence-render.resolveGenuiSpecDetailed）

```
raw
 ├─ parsePartialGenuiSpec     流式前缀解析：平衡前缀 + 候选闭合（ring buffer ≤32）
 │                             →「围栏一闭合就渲染」的渐进体验
 ├─ repairGenuiSpec           guard 白名单修复（见 §4）
 ├─ repairFenceJson (tier-1)  文本级：字符串内自由引号/尾逗号/`=`→`:`；整体 parse
 │                             成功才采纳（流式安全）。
 │                             ⚠ inString 守卫：字符串值内的 `,` 绝不当尾逗号删
 ├─ completeFenceJson (tier-2) 结构级（仅 settled）：补缺失闭合/孤儿元素并回
 │   [src/shared/fence-repair.ts] / 跳不匹配闭括号；truncated 降级会以琥珀警告
 │                             提示「部分内容被丢弃」
 └─ 产出 { spec, warnings, complete }
```

- `warnings`：对**原始** body 的 validate 结果，settled 渲染时显示琥珀条（不是对修复后 spec 再验——那会掩盖作者原错）。
- `complete`：全文完整性（raw 完整 ∨ tier-1 修复后完整）。**panel append 门控**专用：区分「截断的半截 append」（拒绝合并）与「带可修复瑕疵的完整 append」（放行）。

## 4. guard：白名单修复器（src/client/guard.ts，~1900 行核心）

单遍 `repairNode` switch：
- 已知 type：必填字段类型不对→丢节点；数字 clamp、字符串截断、数组 slice（`GENUI_LIMITS` 全常量表：≤200 节点、深 ≤8、表格 50×12、plot 8 序列…）
- 别名容错：`children`/`columns`→`items`、`headers`→`columns`、`data`→`rows`、`text`→`content` 等——**消费即记录 `renamed` 诊断**（validate_dsh_ui 回传告诉模型正名，教学「canonical names ONLY」而非无限兼容）
- 安全白名单：颜色 hex/rgb/var()（堵 CSS `url()` exfiltration）、href 仅 http(s)/mailto、media src 拒 `file:`/协议相对、echart option 强制 `tooltip.renderMode:'richText'` + HTML/`on*=`/`url()` 字符串剔除、未知 type 不渲染 DOM（防插件外注入）
- `countGenuiNodes` / `countDeclaredGenuiNodes`：修复后 vs 声明计数——validate_dsh_ui 用两者差值报告「静默丢弃了 N 个组件」（issue #42 防假绿）

## 5. 交互与持久化

```
GenuiBlock（外壳 memo，stringify 相等性跳过流式重复渲染）
 └─ answers/fields/secretFields/meta/locked/round 五件状态
    ├─ 分组 radio 聚合（group+answer+explanation → submit 本地判卷，零往返）
    ├─ 字段 id → fields 注册（submit 收集；password 永不入 localStorage）
    └─ 持久化：saveBlockState 按 `f:{session}:{slot}:{指纹}` 键存 localStorage
       · 300ms debounce + unmount/key-change 同步 flush（persistNow）
       · 流式→settle 迁移：settle remount 换 durable 身份（source.id），
         FingerprintedGenuiBlock 传 docKey → fallbackStateKey 迁移流式作答
```

action 回传：`useDebouncedAction` 按 action 名 300ms 尾去抖（per-action Map，防拖动刷屏；handler 引用过期已修 #73）。LOCAL-FIRST 原则：判卷/排序/折叠/选中全部本地，action 只留给必须模型参与的事。

## 6. 面板（panel-store）

操作日志状态机（非「最后写入赢」）：`{sourceId, order[seq,block,fence], replace|append, spec}` 经确定性 fold——幂等去重（seen 寄存器）、序排序、最新合法 replace 重置、append 按 tabs 标签合并/尾部追加、节点/次数双预算（超限成 overflow 屏障，确定性可重放）。`/panel` 本地覆盖设置 localBarrier 挡历史重放复活。持久化快照 + replayBarrier 支撑刷新恢复。

## 7. 懒加载引擎资产

mermaid/three/echarts 打成独立 IIFE（`lib/assets/*.js`，由插件自己的 `/plugins/@omdsh-dev/dsh-genui/assets` 路由按需服务；`securityLevel:'strict'` + 渲染后 `assertSafeSvg` 复检——`dangerouslySetInnerHTML` 的唯一入口有守卫）。主 bundle 零引擎依赖。asset bundle **不得 import 主 bundle**（隔离）。

## 8. 渲染细节要点

- 表单组件「跟随 spec 直到用户交互」：override/dirty 模式——panel replace 能更新默认值，用户选择优先于后续 spec 变化
- PlotBlock：SVG 手绘 + 拖拽平移 + 非 passive 原生 wheel 缩放（锚定光标数据坐标）；y 轴锁定（参数滑块只变形不改轴）
- dom-fence 的多表面识别（`md-code-block`/`.code-block` + label+pre 结构兜底）与消息容器误判防护（issue #13/#19）
- e2e：宿主全路由 token 鉴权（`?token` → 303+Set-Cookie 两步认证）；`/plugins` 只应答预注册的内容哈希 combo URL——从页面注入解析真实 URL 校验

## 9. 安全模型（不変式清单）

1. 模型只能产出 fence 文本；白名单组件直接映射 DOM，无任意 HTML 路径
2. safe-math 手写递归下降求值器（无 eval；own-property 检查防原型链）
3. 颜色/链接/媒体/echart 字符串四类白名单过滤（exfiltration + XSS）
4. 资源限制双端镜像（guard 修复限 + renderNode 深度守卫兜底）
5. 插件注册的 disposer 全部挂 `ctx.effect`（卸载清理）
