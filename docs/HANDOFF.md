# dsh-genui 项目状态（HANDOFF）

> 给新会话的交接文档。读完即可接手。基线：**v0.11.0 合并主线，2026-09-03**。

## 一句话状态

三线合并完成 + 上游吸收完成：**mrzhangkris/main = 您的修复线 + 今日 11 项审查修复 + 上游 omdsh-dev 14 项吸收**，622 测试全绿，已推送并同步到 dsh 安装副本。**重启 dsh 即加载最新**。

## 三线历史（背景，必读）

三条线都从 `85a25ae`（omdsh-dev PR#49）分叉：

1. **mrzhangkris fork**（`remote mrzhangkris`，可推）——用户自己的修复线：v0.10 安全轮 + v0.11 防错硬门 + guard 诊断重构。**这是主线 = dsh 安装源**
2. **omdsh-dev 上游**（`remote origin`，只读，403）——0.9.7（50 提交：templates/achievements/image/chart-contract + 一批修复）
3. **旧工作区分支**（`fix/review-findings`）——本地功能线 + 今日修复，已全部并入主线

2026-09-03 完成的合并与吸收：
- `e835b47` merge fix/review-findings（11 项审查修复移植到 mrzhangkris 基座）
- `9e9e94d` merge heading-alias-wip（副本工作树抢救的 h1/h2/h3→text 别名）
- `46a8525..fd7d995` 吸收上游 14 项（image 组件 + copy/quiz/table/debounce/rAF/mermaid/tabs 等）
- 有意跳过：plot wheel 与 #6 重复、stateKey #76（本线 #3 迁移方案更优）、skill #93（本线无 bundled skill 功能）、templates/achievements（产品功能未要）

## 今日修复清单（已全绿锚定）

| # | 修复 | 位置 |
|---|---|---|
| 1 | tier-1 字符串内 `,` 误删（静默篡改内容） | shared/fence-repair.ts |
| 2 | panel append 被 isCompleteJson(raw) 误杀 → complete 判据 | client/fence-render.tsx |
| 3 | 流式→settle 作答丢失 → fallbackStateKey 迁移 + unmount flush | GenuiBlock + FingerprintedGenuiBlock(docKey) |
| 4 | table data 别名 validator 误报 | guard.ts |
| 5 | 表单 mount-time 初值不跟 spec → override/dirty 模式 | blocks/forms.tsx + CheckboxNode |
| 6 | plot wheel 滚页面 → 非 passive 原生监听 | PlotBlock.tsx |
| 7 | `parseSortableNumber('¥')===0` → NaN | blocks/charts.tsx |
| 8 | echart 空数组被丢 → 保留 | guard.ts sanitize |
| 10 | 插件 disposer 丢弃 → ctx.effect | plugin/index.ts |
| 11 | memo comparator 漏 warnings → 内容比较 | GenuiBlock.tsx |
| — | SKILL.md 补 echart/diagram/audio/video/slider/image 文档 + e2e 脚本修 4 处失效 + 硬编码清理 5 类 | SKILL.md / scripts/e2e.mjs / 全局 |

## 安装同步（dsh 用上主线的标准流程）

```bash
# 1. 工作区（开发/dsh-genui）改完 → 全链验证 + 重建 + 推送
pnpm check && git add lib/ && git commit -m "build: lib 同步" && git push mrzhangkris HEAD:main
# 2. 副本（dsh 的 file: 依赖源）更新
cd ~/.dsh/sources/dsh-genui && git pull --ff-only origin main
# 3. 重启 dsh（正在跑的进程有模块缓存）
```

⚠ 副本里 `references/`、`test-prompts.json` 是未跟踪的半成品素材（heading-alias 文档外置化重构），checkout/pull 不受影响，勿删。

## 已知限制（有意取舍，不是 bug）

- 表单 fields/answers **注册过的模型默认**优先于后来的默认变更（durable 语义延伸；完整区分需重设计注册机制）——DEVELOPMENT.md 待办同款
- e2e 全链路需模型 Key；smoke 模式不消耗额度（token 鉴权 + combo URL 细节见 TESTING.md §1）
- dsh web 面板「重放屏障拒绝」console 警告在历史重放时是预期行为（消息里写明）
- flaky：dom-fence mount-failure 测试全量高负载偶发（TESTING.md §5）

## 剩余可做（优先级排序）

1. **上游 templates/achievements**：`origin/main` 的 `357f5b0` / `5284b64`，产品级新手引导功能，想要时单独吸收（改动面大）
2. **Input/Textarea 抽 useTextField**：结构重复清理（DEVELOPMENT.md 待办）
3. **SKILL.md references 外置化**：半成品在副本 references/，继续或废弃需决策
4. **向上游 omdsh-dev 提 PR**：主线相对上游有大量修复（含今日 11 项），当前账号无推送权限，需有权限的账号操作
5. **chart-contract**（origin/main `42ed20b`）：chart 语义校验服务化，本线 guard 无 `validateGenuiChartSemantics`，吸收需先移植该函数

## 文档索引

- `docs/DESIGN.md` 架构与机制取舍（渲染通道/修复管线/guard/持久化/面板/懒引擎/安全模型）
- `docs/DEVELOPMENT.md` 环境命令/产物纪律/代码地图/修改流程/版本
- `docs/TESTING.md` 测试矩阵/分层/e2e/加测试约定/已知 flaky
- `SKILL.md` 组件词汇契约（45 type 全字段，给模型的教学文档，与 guard 六处同步）
- `docs/plans/` 历史执行计划（已完成，档案价值）
- `CHANGELOG.md` / `README.md` / `README.zh-CN.md` / `demo-prompts.md`（录屏演示 prompt）
