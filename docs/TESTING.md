# dsh-genui 测试文档

> 面向：维护者 / 新会话。测试矩阵、分层策略、如何跑、如何加。

## 总览

| 指标 | 数值 |
|---|---|
| 测试文件 | 49（`tests/*.spec.{ts,tsx}`） |
| 用例 | **622 passed + 104 条件 skipped**（skipped 见 §3） |
| 环境 | vitest 3 + jsdom（`.tsx` 文件头 `// @vitest-environment jsdom`） |
| 一条龙 | `pnpm check` = tsc → vitest → tsdown |

## 1. 分层

**白盒（单元/组件，绝大多数）**——按域分文件：

| 域 | 文件 | 锚定的不变式 |
|---|---|---|
| 文本修复 | genui-fence-repair.spec.ts | tier-1/2 各缺陷类 + 两 tier 同 body 一致性 + `redactJsonErrorSnippet` |
| guard 核心 | genui-guard.spec.ts（~120 用例） | 别名 repair↔validator↔NODE_TYPES↔render 四方一致、资源预算、诊断计数、颜色/URL 白名单 |
| 专项 guard | genui-echart-guard / genui-diagram-guard / genui-quiz-guard / skill-md | XSS 过滤/深度预算、27 kind 坐标/规则布局、字符串选项+answer 映射、SKILL.md frontmatter 可解析（防技能静默消失） |
| 渲染组件 | genui.spec / genui-v11/25/26/27/28/29 / table-smart-sort / table-scroll / image / gallery / file-tree / media | 各代组件行为回归；画廊断言全组件族出现 |
| 交互状态 | genui-durable-state（迁移+flush）/ genui-debounce / panel-append | 持久化往返、流式→settle fallback 迁移、unmount flush、append 门控（complete 判据 + tier-2 保守拒绝） |
| 渲染管线 | genui-partial / genui-fence-fallback / dom-fence（35 用例） / genui-boundaries / genui-hardening | 前缀解析、红横幅诊断、DOM 通道接管/回退（issue #13/#19）、surface 误判 |
| 引擎 | genui-mermaid-safe / safe-math / scene3d-events | kind 白名单+SVG 复检+源码修复、求值器正确性、事件驱动渲染不泄漏 rAF |
| 插件端 | plugin-genui / plugin-tool / panel-command / install-script / host-registry | 系统提示段、工具 execute/presentationMeta、/panel 命令、install.sh 技能同步安全（symlink 防护 11 用例） |

**黑盒（真机 e2e）**——`scripts/e2e.mjs`，消耗真实 dsh：

```
DSH_ROOT=<harness构建路径> node scripts/e2e.mjs --smoke
  安装(link 当前工作区) → dsh web 启动 → 首页/client.js 200 → 无页面异常 → 插件 boot
node scripts/e2e.mjs          # 全链路：含模型输出 fence → 渲染 → 点击 action → 模型响应更新
  前提：~/.dsh/settings.yaml 有可用模型 Key
```

e2e 关键实现（防假通过）：token 两步认证（`?token` → Set-Cookie，fetch 不跨重定向存 cookie）；client bundle 从**页面注入的真实 combo URL**（内容哈希 rev）校验 200——手工拼的单包 URL 恒 404；「响应」只认新 assistant-step key，不认本地 chip 文案。失败留截图 + dsh-web.log 尾部。

## 2. 关键回归用例（改对应模块必须保持绿）

- **字符串内容不可篡改**：`"甲,]乙"` 类 body 经修复后逗号保留（tier-1 inString 守卫）
- **append 门控三态**：尾逗号/自由引号 append 放行；流式截断与缺闭合括号拒绝（保守）
- **流式作答迁移**：主键无存储时读 fallbackStateKey 并回写；有主键存储时主键赢
- **unmount flush**：debounce 窗口内卸载不丢最后一次作答
- **quiz answer 别名**：`{options:["A","B"],answer:1}` 映射 correct；无可救选项整体丢弃
- **copy 失败不播报**：mock writeText reject → `✓ 已复制` 不出现
- **echart 空数组保留**：`data: []` 字段不丢；深度超限空对象级联剥离仍生效

## 3. 104 个条件 skip 是什么

`skipIf(!hasFenceRegistry)`：当前 node_modules 的宿主包版本**没有** `registerFenceRenderer` 扩展点 API 时自动跳过（v25/v26/boundaries/debounce/hardening/plot-redraw/teach）。宿主升级提供该 API 后自动激活——**不是死测试，不要删**。

## 4. 加测试的约定

- 文件头环境注释；复用 `tests/setup.ts`（rAF stub、宿主 fence registry 探测、react alias）
- 时间相关用 `vi.useFakeTimers()` + `advanceTimersByTimeAsync`（durable-state 的 300ms debounce 用例）
- 断言 CSS 时读 `GenuiBlock.module.css` 源文本正则（hash 类名不可选择器化）
- 修复 bug 必须带「修复前红、修复后绿」的锁定用例，commit message 引用 issue 编号（如有）

## 5. flaky 已知

dom-fence「React root mount 失败保持原块可见」在全量高负载下偶发（异步时序敏感）；单跑稳定。复现时重跑确认，不要单次失败就改断言。
