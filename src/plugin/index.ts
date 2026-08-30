/**
 * GenUI plugin: teaches the model the ```dsh-ui fence syntax for emitting
 * declarative UI components inline in its reply. The browser half renders the
 * fence through GenuiBlock (ui-primitives); this host half only tells the
 * model the language exists, so a session without the plugin simply never
 * emits fences and nothing changes.
 *
 * The section is a convention section (order 100-199), placed after the bash
 * guidance so the model sees it among its output-format rules.
 * @module @omdsh-dev/dsh-genui
 */

import { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-system-prompt'
import type {} from '@deepseek-ai/dsh-tools'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRenderUiTool, createValidateDshUiTool } from './tool.ts'

/** Convention: tool guidance uses 100–199; bash's section is 104. */
export const GENUI_SECTION_ORDER = 105

/* ---------------- lazy engine asset route ---------------- */

/**
 * The mermaid/three engines ship as standalone IIFE bundles under
 * `lib/assets/` and are fetched by the client ONLY when a spec needs them.
 * This route serves them from the plugin's own package directory through the
 * host webserver service — the longest-prefix rule lets it win over the
 * generic `/plugins` bundle route, and no host source change is needed. The
 * service is optional at this plugin's start time (same ordering reality as
 * the tools registry), so registration probes immediately AND on the
 * `internal/service` event, exactly like the tools registration below.
 */

/** Route prefix under /plugins; anything under it is this plugin's asset. */
const ASSET_ROUTE_PATH = '/plugins/@omdsh-dev/dsh-genui/assets'

/** Safe flat file names only: no slashes, no traversal, js assets only. */
const ASSET_FILE_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*\.js$/

/** The handler itself (registered via the optional webServer probe). */
async function serveGenuiAsset(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405)
    res.end()
    return
  }
  let pathname: string
  try {
    pathname = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname)
  } catch {
    res.writeHead(400)
    res.end()
    return
  }
  const rel = pathname.startsWith(`${ASSET_ROUTE_PATH}/`) ? pathname.slice(ASSET_ROUTE_PATH.length) : null
  if (rel === null) {
    res.writeHead(404)
    res.end()
    return
  }
  const file = rel.slice(1)
  if (!ASSET_FILE_RE.test(file)) {
    res.writeHead(404)
    res.end()
    return
  }
  try {
    // lib/index.js → ./assets/ = <pkg>/lib/assets/ (the tsdown asset outDir).
    const dir = fileURLToPath(new URL('./assets/', import.meta.url))
    const body = await readFile(join(dir, file))
    res.writeHead(200, {
      'content-type': 'text/javascript; charset=utf-8',
      // Asset URLs carry the bundle rev query (?rev=…), so a rebuild busts
      // the cache — safe to cache for a year and never revalidate.
      'cache-control': 'public, max-age=31536000, immutable',
    })
    res.end(body)
  } catch {
    // Missing asset (old build) — a loud 404; the client shows its fallback.
    res.writeHead(404)
    res.end()
  }
}

/** The fence language description injected into every assembled system prompt.
 *  Deliberately slim: the `genui` skill carries the full component→field
 *  mapping; this section keeps only the contract that must always be
 *  present (fence syntax, type whitelist, and critical behavioral rules). */
export const GENUI_SECTION_TEXT = `You can render interactive UI components INSIDE your reply — between paragraphs — by emitting a fenced block with the language tag \`dsh-ui\` containing a JSON spec:

\`\`\`dsh-ui
{"title":"可选标题","gap":14,"items":[...]}
\`\`\`

The spec is a white-listed component tree rendered inline where the fence sits. Only these \`type\` values; the \`genui\` skill, when available, carries the full content→component mapping and per-component field details:

- 布局: text · row · col · grid · card · divider · spacer
- 展示: badge · stat · progress · list · table · keyvalue · avatar · audio · video · timeline · file-tree · breadcrumb · callout · steps · diff · json · code · copy
- 图表: chart (bars|line|donut) · echart (preset|option) · plot (函数图)
- 交互: button · input · textarea · select · checkbox · switch · slider · radio · submit · quiz · link · tabs · accordion
- 高级: mermaid (flowchart/sequence/class/gantt/pie/er/state/journey) · diagram (编辑级架构/流程图，27 种 kind) · scene3d (3D WebGL)
Field table — one line per type, canonical names ONLY (missing required → node dropped; 可选 = may be omitted):
- text: content(string)必填；size可选(h1|h2|h3|body|muted|caption)；center可选(true)
- row: items(节点数组)必填；wrap可选(true)；spacer可选(true)
- col: items(节点数组)必填；gap可选(数字)
- grid: items(节点数组)必填；cols可选(数字)
- card: items(节点数组)必填；title可选(string)
- divider: 无字段
- spacer: 无字段
- badge: label(string)必填；tone可选(success|warn|danger|accent)；icon可选
- stat: label+value必填；delta可选；unit可选
- progress: value(0–100数字)必填；label/valueLabel可选
- list: items必填
- table: columns(string数组)+rows(二维数组)必填
- keyvalue: pairs({key,value}数组)必填
- avatar: name(string)必填；color可选
- audio: src(string)必填；alt/loop可选
- video: src(string)必填；poster/loop/muted/aspectRatio可选(16:9|4:3|1:1|9:16)
- timeline: items必填
- file-tree: items必填
- breadcrumb: items(string数组)必填
- callout: content(string)必填；tone可选(info|success|warning|error)；title可选
- steps: steps({title}数组)必填；current可选(数字)
- diff: diffs({path,oldText,newText}数组)必填
- json: value(任意JSON)必填
- code: code(string)必填；lang可选
- copy: text(string)必填；label可选
- chart: data({label,value}数组)或series必填；kind可选(bars|line|donut)
- echart: 预设用 data/series、完整配置用 option，至少其一必填；title/height可选；preset可选(bar|line|area|pie|scatter)
- plot: series({expr}数组)必填；xMin/xMax/yMin/yMax可选(数字)
- button: label(string)必填；tone可选(primary|danger|success|ghost)；action/full/small/icon可选
- input: 全部可选(label/placeholder/value/inputType/action/id)
- textarea: 全部可选(label/placeholder/rows/value/action/id)
- checkbox: label(string)必填；checked/action可选
- switch: label(string)必填；checked/action可选
- slider: min/max/step/value(数字，缺省0–100)；label/action可选
- select: options(string数组)必填；label/selected/action可选
- radio: options(string数组)必填；group/answer/explanation可选
- submit: label(string)必填；action/groups可选
- quiz: question(string)+options必填；explanation可选
- link: label(string)必填；href可选(http[s]/mailto)
- tabs: tabs({label,items}数组)必填
- accordion: items({title,items}数组)必填
- mermaid: code(string)必填
- scene3d: meshes(1–5个)必填；title/background可选
- diagram: kind+nodes({id,label}数组)必填；edges/zones/variant/title/theme可选

高频错误黑名单（发出前自查，validate_dsh_ui 会提示）: ① callout/badge 写 type_ —— 正名是 tone；② code/mermaid 写 value —— 正名是 code；③ table 写 headers —— 正名是 columns。

Rules:
- 触发: 结构化表达优于纯文本时主动用（要点、强调、对比、流程、步骤、状态、数据、演示），纯问答与一句话不套 UI；一个主题一个主组件，每次 3–8 个组件，同一数据不重复出现。
- JSON 严格: 坏围栏降级为代码块；含表格/图表/嵌套容器（row/col/grid/card/tabs/accordion）任一层级 或 节点数≥2 的围栏发出前调用 validate_dsh_ui，❌ 修好再发（若附「已自动修复」JSON 照抄即可）。
- 键名纪律: 节点的键只取自字段表，多余或拼错的可选字段名会被渲染器无声丢弃、不给任何警告；写完逐键比对字段表。
- 规模: ≤200 节点、嵌套≤8 层（超出被截断）；3D mesh 1–5；plot 给合理 xMin/xMax。
- LOCAL-FIRST + actions: UI 能自己做的状态变化（判卷、判题、重置、展开、选中）就地完成，零往返；action 只用于必须模型参与的事。交互组件带 "action":"name"，交互以 [genui-action] name + 组件数据回传，届时重渲染更新 UI；无 action 的按钮禁用。
- Durable state: 交互状态按「会话+内容指纹」持久化——刷新/重放恢复；重渲染相同内容保留，新内容重置。
- 卷子模式: 每题一个 radio（group+answer+explanation）+ 一个 submit（groups 全列），本地判分。
- Secrets ban: 不索取密码、API Key、Token、恢复码；需要时拒绝并解释。
- Tool channel: render_ui 工具把同一 spec 渲染为工具行卡片（交付物型界面用）；围栏用于回答内联 UI。
- Panel: "panel":true 只渲染进会话面板 dock 并原地更新；"append":true 追加合并（同标签 tabs 追加/新标签加入/尾部追加）；上限 200 节点/200 次追加，满了发 replace 重建。面板组件来的 [genui-action] 只回一个 panel:true 围栏 + 至多一行 10 字内确认，不解释、不用普通围栏。`

/**
 * Register the GenUI output-language section and the render_ui tool.
 * @param ctx - cordis context.
 */
// `tools` is intentionally NOT injected: the service is optional for this
// plugin — hosts without tool access keep the fence channel working. Cordis
// inject entries are hard requirements, so the registry is probed at runtime
// instead (see apply).
export const inject = ['systemPrompt']

export function apply(ctx: Context): void {
  ctx.systemPrompt.section({
    name: 'genui:fence',
    order: GENUI_SECTION_ORDER,
    text: GENUI_SECTION_TEXT,
  })
  // The tools service is optional: hosts without tool access (or minimal
  // compositions) keep the fence channel; only when the registry exists does
  // the render_ui tool join the model's tool set. `reflect.get(name, false)`
  // is cordis's non-throwing optional service lookup (the proxy's own trap
  // uses it) — property access without inject would throw instead.
  //
  // Start-up ordering: this plugin injects only `systemPrompt`, so cordis
  // starts it EARLY — before the tools provider (which injects deeper
  // dependencies) has bound its service. A one-shot probe at apply time
  // therefore misses the registry on real hosts (the fence section lands,
  // the tool never registers). Fix: probe immediately AND subscribe to
  // `internal/service` (emitted by cordis on every service binding), so the
  // registration lands the moment `tools` appears, whatever the order.
  let registered = false
  const tryRegister = (value: { register(tool: unknown): unknown } | undefined): void => {
    if (registered) return
    const tools = value ?? ctx.reflect.get('tools', false) as { register(tool: unknown): unknown } | undefined
    if (tools === undefined) return
    tools.register(createRenderUiTool())
    tools.register(createValidateDshUiTool())
    registered = true
  }
  tryRegister(undefined)
  ctx.on('internal/service', (name: string, value: unknown) => {
    if (name === 'tools') tryRegister(value as { register(tool: unknown): unknown })
  })

  // Lazy-engine asset route: same optional-probe pattern as the tools
  // registry — the webserver service may bind after this plugin starts.
  let assetsRegistered = false
  const tryRegisterAssets = (value: { register(route: unknown): unknown } | undefined): void => {
    if (assetsRegistered) return
    const webServer = value ?? ctx.reflect.get('webServer', false) as { register(route: unknown): unknown } | undefined
    if (webServer === undefined) return
    webServer.register({ kind: 'prefix', path: ASSET_ROUTE_PATH, handler: serveGenuiAsset })
    assetsRegistered = true
  }
  tryRegisterAssets(undefined)
  ctx.on('internal/service', (name: string, value: unknown) => {
    if (name === 'webServer') tryRegisterAssets(value as { register(route: unknown): unknown })
  })
}
