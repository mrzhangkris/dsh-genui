# dsh-genui 开发文档

> 面向：贡献者 / 新会话。环境、构建、测试、代码地图、协作流程。

## 环境

- Node `^22.19 || >=24`，pnpm `>=11.7 <12`（`packageManager: pnpm@11.7.0`）
- 依赖一个 DSH 宿主（peer deps `@deepseek-ai/dsh-*`）；本地开发默认用工作区的 node_modules 解析宿主 UI 包
- 真机 e2e 需要本地 DSH harness 源码构建：`cd <harness> && pnpm run build`，然后 `DSH_ROOT=<harness路径> node scripts/e2e.mjs --smoke`

## 常用命令

```bash
pnpm test              # vitest 全量（当前 622 passed | 104 条件 skip）
pnpm build             # rm -rf lib && tsc && tsdown（产物必须重建后提交，见下）
pnpm check             # tsc + vitest + tsdown 一条龙（提交前跑这个）
npx tsdown             # 只重建 bundle
```

## 产物约定（重要）

- `lib/` 提交进 git（`.js` bundle + `lib/types/*.d.ts` 全套）——**dsh 宿主以 `file:` 方式安装直接读 `lib/`**，不提交 lib 则宿主跑旧代码
- **源码改动后必须 `rm -rf lib && npx tsc && npx tsdown` 全链重建**——只跑 tsdown 会丢 `lib/types`；先删后建避免陈旧 .d.ts 混入提交（踩过：merge 时 add 了半套 lib 导致 types 全删）
- 提交习惯：源码 commit + 紧随的 `build: lib 与 sources 同步` commit

## 代码地图

```
src/plugin/          node 半面（零运行时宿主 import，类型 only）
  index.ts           系统提示注入段 + tools/webServer 可选服务探测注册（disposer 挂 ctx.effect）
  tool.ts            render_ui（工具行卡片）+ validate_dsh_ui（发出前校验，❌ 带修复 JSON 回传）
src/shared/
  fence-repair.ts    纯文本 JSON 修复（tier-1/2，两端共享；详见 docs/DESIGN.md §3）
src/client/          浏览器半面
  spec.ts            组件词汇类型定义（GenuiNode union + 各接口）
  guard.ts           修复/校验/计数核心（~1900 行；GENUI_LIMITS 常量表；renamed 诊断）
  fence-render.tsx   解析管线 + 两通道渲染入口 + FingerprintedGenuiBlock（持久化身份）
  dom-fence.tsx      DOM 通道（MutationObserver 接管 + 预绘修复）
  GenuiBlock.tsx     交互状态外壳（answers 五件套 + debounce/flush 持久化）
  blocks/            组件族实现（render-node 是递归分发器；forms/advanced/charts/basic/image）
  panel-store.ts     面板操作日志状态机；panel-command.ts /panel 命令
  interaction-store.ts  localStorage 持久化（LRU 200 块；指纹键）
  parse-partial.ts   流式前缀解析（候选 ring buffer ≤32）
  safe-math.ts       plot 表达式沙箱求值器
  mermaid-{safe,core,lazy}.ts / scene3d-{core,lazy}.ts / echarts-lazy / asset-*
                     懒引擎：safe=纯文本修复，core=重引擎（仅入 asset bundle），lazy=加载器
  diagram/           编辑级 SVG 架构图（theme/layout/geometry）
  gallery.ts         全词汇画廊样例（测试与演示复用）
scripts/
  e2e.mjs            真机 e2e（--smoke 不耗模型额度；token 两步认证 + combo URL 解析）
  e2e-visual.mts     可视化 e2e（录屏演示素材）
```

## 修改流程纪律

1. **改 guard 别名/字段**：repairNode、validateNode、`GENUI_NODE_TYPES`、`NODE_KEYS` 已知字段表（guard.ts:307）、SKILL.md、系统提示字段表六处同步——repo 有「四方一致性守卫」测试（tests/genui-guard.spec.ts:889 `GENUI_NODE_TYPES ↔ repair ↔ validator ↔ render`）会抓漂移
2. **改组件行为**：先看 SKILL.md 是否承诺了该行为（文档是给模型的契约）；同步改测试
3. **改 fence-repair**：必须配 tier-1 与 tier-2 的一致性用例（tests/genui-fence-repair.spec.ts 有「同 body 两 tier 结果一致」用例）
4. **安全敏感改动**（safe-math/mermaid/echart/颜色/链接）：白名单思维，收紧而非放宽；给绕过用例
5. 每步可回滚：小 commit，`pnpm check` 全绿再提交

## 版本与发布

- SemVer 手动 bump（package.json + CHANGELOG.md）；git tag `vX.Y.Z`
- **本仓库当前是 fork 主线**：remote `mrzhangkris`（个人 fork，可推）= 日常安装源；remote `origin` = omdsh-dev 上游（只读）。详见 docs/HANDOFF.md「三线历史」
- 安装到 dsh：`~/.dsh/sources/dsh-genui` 是 dsh profiles（web/scratch）的 `file:` 依赖——更新流程见 HANDOFF §安装同步

## 已知结构性待办（有意未做的重构）

- `InputNode` / `TextareaNode` 五件套结构重复（edited/lastSent/ime/mount-effect），可抽 `useTextField` 共享 hook——测试锚定充分（v27/v29），重构低风险但未做
- `countGenuiNodes` / `countDeclaredGenuiNodes` 容器分支相似——语义不同（修复后 vs 声明），合并需参数化，暂保留
- heading-alias 分支的 SKILL.md「references 外置化」重构（低频组件详解拆到 references/ 目录）——半成品在 `~/.dsh/sources/dsh-genui` 的 `references/` 未跟踪文件里，想继续时从那拾起
