# Changelog

## [0.10.0] - 2026-08-30
### 安全
- **ECharts 外链通道封堵**：image:// / data: / blob: 前缀、裸 https:// 图片字段、协议相对 URL //evil 全部拦截（ECHART_EXFIL_RE + image 键校验）——prompt 注入模型无法借浏览器外带数据。
- **file-tree 预算绕过修复**：walkTree 逐节点扣共享 200 节点预算，不再绕过契约。
- **scene3d 色崩溃修复**：mesh 色改 solidColor（拒 var(--dsw-*)），THREE.Color 解析失败不再拖垮整图。
- **guard 默认分支透传消毒**：剔 __proto__/constructor/prototype + 深度上限，防原型污染。

### 新增
- **stat 支持 unit 字段**：{type:'stat',label,value,unit:'%'} 渲染时附加到 value。
- **repair 诊断机制**：别名缝补（renamed）/ 未知键丢弃（dropped-unknown-key）/ 必填缺失（dropped-node）经 validate_dsh_ui 与渲染横幅可见化——静默容错转可见纠错。

### 使用引导（kimi C 级审计 → 10 条全实施）
- 注入段速记行改逐类型规范清单、键名闭集纪律声明、验证门槛降低、高频错误黑名单。
- SKILL.md：容器/叶子三分法、echart/diagram 条目、tone 名字对照警告、avatar/audio/video 字段定义、? 标注修正、自检规则前置。

### 修复
- **repair 层孤儿元素盲区**：数组提前闭合 + 后续孤儿元素自动合并回前数组（修复层 tier-2）。
- **echart 数组位移**：被拒元素改 null 占位，索引对齐（xAxis.data 标签不再错位）。
- **durable-state 重置**：内容原地变更时旧状态不再污染新 key。
- **panel reload append 基底**：持久化操作序列，刷新后追加内容不丢。
- **safeHref 同源路径**：放行 /docs 同源绝对路径，与 safeMediaSrc 对齐。
- **fingerprint 升 cyrb53**：djb2 32 位碰撞概率压到可忽略。
- ErrorBoundary 消息截断、面板 publisher effect 去重、DOM observer 缓存、模块级全局消除、面包屑 cursor、no-cache 等。

## [0.9.2] - 2026-08-24
### 文档
- 在中英文 README 中补充原生 npm install 命令，并明确它只添加 Node 依赖；安装并激活 DSH 插件仍使用 dsh plugin add。
- 修正 npm 包已经公开后仍把 404 解释为尚未发布的过时提示；产品站安装命令同步改为 npm 公开包。

## [0.9.1] - 2026-08-22
### 新增
- **编辑级 diagram 组件（diagram-design 移植，PR #9）**：白名单新增 diagram 节点——27 种 kind、正交连接器、语义 token 主题、dotted-paper 底纹、Zone 分组、64px 节点排版与底部 Legend 色板条。复杂度预算由 guard 强制。

## [0.9.0] - 2026-08-17
### 新增
- **ECharts 集成组件**：新增 echart 节点类型，支持模型输出完整 ECharts 图表。Preset 简写 + Full option 逃生舱。引擎按需懒加载。
### 安全
- **full option XSS 防护**：sanitizeEChartOption 强制 tooltip.renderMode: richText，过滤 HTML/脚本注入与 url() 外带通道。
- **full option 资源预算**：maxEChartArrayLen: 500 与 maxEChartOptionNodes: 2000。
### 修复
- preset scatter 数据映射、懒加载期间 spec 更新丢失、preset tooltip renderMode、preset series[].color 对齐。
