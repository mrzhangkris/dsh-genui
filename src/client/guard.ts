/**
 * GenUI spec guard: resource limits, structural validation, and deterministic
 * repair for ```dsh-ui fence specs.
 *
 * The renderer path runs every fence body through `repairGenuiSpec` before
 * rendering, so a pathological or hostile spec — deep nesting, thousands of
 * nodes, oversized strings, out-of-range numbers — degrades gracefully instead
 * of stalling the UI. Repair is deterministic and prefix-stable: a component
 * that survives repair of a partial stream keeps its position when later
 * chunks arrive, so streaming re-renders stay consistent.
 *
 * Policy:
 * - Unknown node `type`s pass through untouched (plugin-registered custom
 *   components via `registerGenuiComponent` are opaque to this package).
 * - Known types: required fields must have the right type or the node is
 *   dropped; numbers are clamped into range; strings truncated; arrays
 *   sliced to their caps; containers recursed with a depth budget.
 * - The whole spec carries a node budget; once exhausted, remaining siblings
 *   are elided.
 */
import type { GenuiFileTreeNode, GenuiList, GenuiNode, GenuiPlot, GenuiPlotSeries, GenuiScene3D, GenuiSpec, GenuiDiagram, GenuiDiagramTheme, GenuiDiagramKind } from './spec.ts'
import { wrapSingleComponentRoot } from './spec.ts'

/** Hard resource limits enforced by repair (and mirrored at render time). */
export const GENUI_LIMITS = {
  /** Maximum nesting depth of the component tree. */
  maxDepth: 8,
  /** Maximum total nodes across the whole spec. */
  maxNodes: 200,
  /** Maximum length of any plain string field. */
  maxString: 2000,
  /** Maximum serialized length of a `json` node value. */
  maxJsonValue: 24_000,
  /** Maximum length of a `code` body. */
  maxCode: 12_000,
  /** Maximum length of a mermaid source. */
  maxMermaid: 8000,
  /** Maximum `grid` columns. */
  maxGridCols: 12,
  /** Maximum `tabs` count. */
  maxTabs: 12,
  /** Maximum `accordion` items. */
  maxAccordionItems: 24,
  /** Maximum `list` items. */
  maxListItems: 50,
  /** Maximum `select`/`radio` options. */
  maxOptions: 50,
  /** Maximum `table` rows / columns. */
  maxTableRows: 50,
  maxTableCols: 12,
  /** Maximum `chart` data points per series. */
  maxChartPoints: 60,
  /** Maximum `plot` series and per-series parameters. */
  maxPlotSeries: 8,
  maxPlotParams: 6,
  /** Maximum `scene3d` meshes per scene. */
  maxMeshes: 5,
  /** Maximum `scene3d` nodes per spec (nesting included). Browsers cap live
   * WebGL contexts (~16) and a page stuffed with scenes loses every context
   * at once (collective context loss), so scenes past the cap are dropped. */
  maxScene3dNodes: 5,
  /** Maximum `quiz` options. */
  maxQuizOptions: 8,
  /** Maximum `steps` / `timeline` / `breadcrumb` / `keyvalue` entries. */
  maxSteps: 24,
  maxTimelineItems: 24,
  maxBreadcrumbItems: 12,
  maxKeyValuePairs: 24,
  /** Maximum `file-tree` nesting. */
  maxTreeDepth: 6,
  /** Maximum `diagram` nodes / edges / zones / focal accents (editorial
   * complexity budget, mirroring diagram-design's §7 limits). */
  maxDiagramNodes: 9,
  maxDiagramEdges: 12,
  maxDiagramZones: 3,
  maxDiagramFocal: 2,
  maxDiagramLabel: 14,

  /** Maximum depth of an `echart` option object (prevents pathological nested
   * ECharts configs from stalling the guard walk). */
  maxEChartOptionDepth: 10,
  /** Maximum length of any single array inside an `echart` option (prevents
   * a model from stalling rendering with `series.data` of hundreds of
   * thousands of points). */
  maxEChartArrayLen: 500,
  /** Maximum total entries (object keys + array elements) traversed while
   * sanitizing an `echart` option. Bounds the walk so a pathologically
   * large option object cannot stall the guard. */
  maxEChartOptionNodes: 2000,
} as const

/** Result of `validateGenuiSpec`. */
export interface GenuiValidation {
  ok: boolean
  /** Human-readable problems, empty when `ok`. */
  errors: string[]
}

/* ---------------- shared field helpers ---------------- */

/** Is `v` one of `values`? (enum guard) */
function inEnum<T extends string>(v: unknown, values: readonly T[]): v is T {
  return typeof v === 'string' && (values as readonly string[]).includes(v)
}

/** String field: truncate a string to `cap`, or undefined when not a string. */
function str(v: unknown, cap: number): string | undefined {
  return typeof v === 'string' ? v.slice(0, cap) : undefined
}

/**
 * Color field: the value lands in an inline `style` (background/stroke) or
 * THREE.Color. Arbitrary CSS values are an exfiltration channel — a model
 * (or a hostile spec) could emit `url(https://attacker/track?...)` and the
 * browser would fetch it. Only formats that name a color pass: hex, rgb/hsl
 * functions, and host design tokens (`var(--dsw-*)`). Anything else degrades
 * to the component's default palette.
 */
const SAFE_COLOR_RE = /^(?:#[\da-fA-F]{3,8}|rgba?\([^)]{0,64}\)|hsla?\([^)]{0,64}\)|var\(--dsw-[\w-]+(?:,\s*#[0-9a-fA-F]{3,8})?\))$/

function color(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined
  const s = v.trim()
  return s.length <= 64 && SAFE_COLOR_RE.test(s) ? s : undefined
}

/**
 * Solid color field: hex/rgb/hsl plus a whitelist of common CSS named
 * colors — deliberately narrower than `color()`, which also admits host
 * design tokens (`var(--dsw-*)`). CSS variables are fine for inline
 * `style` strings (the browser resolves them), but THREE.Color cannot
 * parse a `var()` literal and throws, taking the whole 3D scene down to
 * the "3D 渲染失败" fallback. THREE.Color.NAMES does resolve CSS named
 * colors (`red`, `navy`, …), so the common ones pass (normalized to
 * lowercase, the exact form NAMES stores); anything outside the whitelist
 * degrades to the renderer's default palette.
 */
const SOLID_COLOR_RE = /^(?:#[\da-fA-F]{3,8}|rgba?\([^)]{0,64}\)|hsla?\([^)]{0,64}\))$/

/** Common CSS named colors THREE.Color.NAMES resolves. Deliberately NOT the
 * full CSS list — a closed, reviewed set; extend only with colors verified
 * against the renderer's three.js build. Matched case-insensitively. */
const SOLID_NAMED_COLORS = new Set([
  'red', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink', 'brown',
  'black', 'white', 'gray', 'grey', 'cyan', 'magenta', 'lime', 'teal',
  'navy', 'olive', 'maroon', 'silver', 'gold',
])

function solidColor(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined
  const s = v.trim()
  if (s.length > 64) return undefined
  if (SOLID_NAMED_COLORS.has(s.toLowerCase())) return s.toLowerCase()
  return SOLID_COLOR_RE.test(s) ? s : undefined
}

/**
 * Link target field: only http(s) and mailto survive. `javascript:`/`data:`
 * and every other scheme degrade to a plain-text node — the model's link is
 * display, not an execution channel.
 */
function safeHref(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined
  const s = v.trim()
  if (s.length > 2048) return undefined
  return /^https?:\/\//i.test(s) || /^mailto:[^@\s]+@[^@\s]+$/i.test(s) ? s : undefined
}

/** Media loads bytes, so accept only browser-reachable http(s) or same-origin
 * relative paths. Active/local schemes and protocol-relative URLs are
 * rejected. The renderer always keeps playback user-controlled. */
function safeMediaSrc(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined
  const s = v.trim()
  if (s === '' || s.length > 2048) return undefined
  if (/^https?:\/\//i.test(s)) return s
  if (/^[a-z][a-z0-9+.-]*:/i.test(s) || /^[/\\]{2}/.test(s)) return undefined
  return s
}

/** Finite-number field: clamp into [min, max], or undefined when not finite. */
function num(v: unknown, min: number, max: number): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : undefined
}

/** Integer field: clamp into [min, max], or undefined when not a finite integer. */
function int(v: unknown, min: number, max: number): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, Math.trunc(v))) : undefined
}

/** Optional enum field: the value when it matches, otherwise undefined. */
function enu<T extends string>(v: unknown, values: readonly T[]): T | undefined {
  return inEnum(v, values) ? v : undefined
}

/** Plain object (not array, not null). */
function obj(v: unknown): Record<string, unknown> | undefined {
  return typeof v === 'object' && v !== null && !Array.isArray(v) ? v as Record<string, unknown> : undefined
}

/**
 * Optional-field spread helper. `exactOptionalPropertyTypes` forbids
 * `{ gap: number | undefined }`; computing the value into a const first and
 * spreading `opt('gap', g)` keeps every optional field either absent or a
 * plain value.
 */
function opt<K extends string, V>(key: K, value: V | undefined): Partial<Record<K, V>> {
  return value === undefined ? {} : { [key]: value } as Partial<Record<K, V>>
}

const TEXT_SIZES = ['h1', 'h2', 'h3', 'body', 'muted', 'caption'] as const
const BUTTON_TONES = ['primary', 'danger', 'success', 'ghost'] as const
const BADGE_TONES = ['success', 'warn', 'danger', 'accent'] as const
const INPUT_TYPES = ['text', 'email', 'password'] as const
const CALLOUT_TONES = ['info', 'success', 'warning', 'error'] as const
const CHART_KINDS = ['bars', 'line', 'donut'] as const
const PLOT_KINDS = ['line', 'area', 'scatter'] as const
const MEDIA_ASPECT_RATIOS = ['16:9', '4:3', '1:1', '9:16'] as const
const MESH_SHAPES = ['box', 'sphere', 'cone', 'cylinder', 'torus'] as const
const FILE_TYPES = ['file', 'dir'] as const
const DIAGRAM_KINDS: readonly string[] = [
  'architecture', 'it-state', 'flowchart', 'sequence', 'state', 'er', 'timeline',
  'swimlane', 'quadrant', 'radar', 'loop', 'nested', 'tree', 'org-chart', 'layers',
  'venn', 'pyramid', 'bar', 'line', 'gantt', 'scatter', 'high-level', 'process',
  'medallion', 'data-flow', 'dp-integration', 'dp-security-matrix',
]
const DIAGRAM_NODE_TYPES = ['focal', 'backend', 'store', 'external', 'input', 'optional', 'security'] as const
const DIAGRAM_VARIANTS = ['light', 'dark', 'editorial'] as const
const DIAGRAM_EDGE_KINDS = ['solid', 'dashed', 'accent', 'link'] as const
const DIAGRAM_ROUTES = ['auto', 'orthogonal', 'straight'] as const

const ECHART_PRESETS = ['bar', 'line', 'area', 'pie', 'scatter'] as const

/* ---------------- repair ---------------- */

/**
 * One repair diagnostic: WHY something the author wrote did not survive into
 * the rendered tree. The repair is intentionally silent on the render path
 * (streaming prefix-stability), but the same walk can COLLECT what it did so
 * the tools (render_ui / validate_dsh_ui) and the client warning bar can show
 * it — a silent drop the author cannot see is a bug factory (K3 audit #8).
 */
export interface GenuiRepairDiagnostic {
  /** `renamed`: an alias key was consumed as its canonical name. */
  kind: 'renamed' | 'dropped-unknown-key' | 'dropped-node'
  /** Dotted path of the node in the spec tree, e.g. `items[2]`. */
  path: string
  /** One-line human-readable (model-facing) explanation. */
  detail: string
}

interface RepairCtx {
  /** Nodes left in the budget; 0 stops the walk. */
  remaining: number
  /** `scene3d` nodes left for this spec (WebGL context cap — see
   * GENUI_LIMITS.maxScene3dNodes); 0 drops any further scene. */
  scene3dLeft: number
  /** Optional diagnostic collector (K3 audit #8); absent = fully silent. */
  diag?: GenuiRepairDiagnostic[]
}

/** Record an alias repair: `from` was consumed as its canonical `to`. */
function renamed(ctx: RepairCtx, path: string, from: string, to: string): void {
  ctx.diag?.push({ kind: 'renamed', path, detail: `${path} 的字段 '${from}' 已按正名 '${to}' 缝补——能用，但请改用正名 ${to}` })
}

/** Layout-container children with the children/columns aliases recorded
 * (K3 audit #8) and the child path threaded for nested diagnostics. */
function repairContainerItems(v: Record<string, unknown>, ctx: RepairCtx, depth: number, path: string): GenuiNode[] {
  if (v.items === undefined) {
    if (v.children !== undefined) renamed(ctx, path, 'children', 'items')
    else if (v.columns !== undefined) renamed(ctx, path, 'columns', 'items')
  }
  return repairItems(v.items ?? v.children ?? v.columns, ctx, depth + 1, `${path}.items`)
}

/** Canonical + accepted-alias input keys per node type. The unknown-key diff
 * uses this to report silently discarded fields; ALIASES ARE INCLUDED so a
 * key consumed as an alias reports once as `renamed` and never double-reports
 * as dropped. Keep in sync with the repairNode switch. */
const NODE_KEYS: Record<string, ReadonlySet<string>> = {
  text: new Set(['content', 'text', 'size', 'center']),
  row: new Set(['items', 'children', 'columns', 'wrap', 'spacer']),
  col: new Set(['items', 'children', 'columns', 'gap']),
  grid: new Set(['items', 'children', 'columns', 'cols']),
  card: new Set(['items', 'children', 'columns', 'title']),
  button: new Set(['label', 'text', 'tone', 'full', 'small', 'icon', 'action']),
  input: new Set(['label', 'placeholder', 'value', 'inputType', 'action', 'id']),
  select: new Set(['options', 'choices', 'label', 'action', 'selected', 'id']),
  checkbox: new Set(['label', 'checked', 'action']),
  link: new Set(['label', 'href']),
  audio: new Set(['src', 'url', 'alt', 'loop']),
  video: new Set(['src', 'url', 'alt', 'poster', 'loop', 'muted', 'aspectRatio']),
  badge: new Set(['label', 'text', 'value', 'tone', 'icon']),
  stat: new Set(['label', 'value', 'val', 'delta', 'unit']),
  progress: new Set(['value', 'percent', 'label', 'valueLabel']),
  divider: new Set([]),
  spacer: new Set([]),
  avatar: new Set(['name', 'color']),
  list: new Set(['items', 'children']),
  table: new Set(['columns', 'headers', 'rows', 'data']),
  chart: new Set(['data', 'points', 'series', 'kind']),
  tabs: new Set(['tabs']),
  plot: new Set(['series', 'xMin', 'xMax', 'yMin', 'yMax', 'title']),
  callout: new Set(['content', 'text', 'body', 'description', 'tone', 'type_', 'level', 'title']),
  steps: new Set(['steps', 'items', 'current']),
  keyvalue: new Set(['pairs', 'items', 'data']),
  diff: new Set(['diffs']),
  json: new Set(['value', 'data']),
  code: new Set(['code', 'value', 'lang']),
  radio: new Set(['options', 'choices', 'label', 'selected', 'action', 'group', 'answer', 'explanation']),
  submit: new Set(['label', 'action', 'resetAction', 'groups']),
  switch: new Set(['label', 'checked', 'action']),
  slider: new Set(['min', 'max', 'step', 'value', 'label', 'action', 'id']),
  textarea: new Set(['label', 'placeholder', 'rows', 'value', 'action', 'id']),
  accordion: new Set(['items']),
  copy: new Set(['text', 'content', 'label']),
  mermaid: new Set(['code', 'source']),
  scene3d: new Set(['meshes', 'objects', 'title', 'ambient', 'background']),
  diagram: new Set(['kind', 'nodes', 'edges', 'zones', 'variant', 'title', 'theme']),
  timeline: new Set(['items', 'entries']),
  'file-tree': new Set(['items']),
  breadcrumb: new Set(['items']),
  quiz: new Set(['question', 'options', 'choices', 'explanation', 'id', 'action']),
  echart: new Set(['title', 'height', 'preset', 'data', 'series', 'option']),
}

/** Walk `list` with the shared node budget; drops invalid entries. Only
 * KEPT entries consume the pool (dropped ones refund their charge), matching
 * walkTree's skip-before-charge. */
function repairItems(list: unknown, ctx: RepairCtx, depth: number, path: string): GenuiNode[] {
  if (!Array.isArray(list)) return []
  const out: GenuiNode[] = []
  for (let i = 0; i < list.length; i++) {
    if (ctx.remaining <= 0) break
    const itemPath = `${path}[${i}]`
    const declaredType = obj(list[i])?.type
    // The charge PRECEDES repairNode on purpose: nested walks must see the
    // decremented pool mid-repair, else a near-exhausted budget could admit
    // a whole maxDepth chain before any decrement lands (the elide-tail and
    // typed-list-children truncation tests pin this exact math). A node that
    // fails repair is refunded below — like walkTree's nameless-entry skip,
    // it never renders, so it must not consume the shared quota.
    ctx.remaining -= 1
    const node = repairNode(list[i], ctx, depth, itemPath)
    if (node !== null) out.push(node)
    else {
      ctx.remaining += 1
      if (typeof declaredType === 'string' && NODE_KEYS[declaredType] !== undefined) {
        // A DECLARED node failed repair (missing/invalid required fields): the
        // whole node vanished — name it, so the drop is never silent.
        ctx.diag?.push({ kind: 'dropped-node', path: itemPath, detail: `${itemPath}（type '${declaredType}'）因必填字段缺失或类型非法被整体丢弃` })
      }
    }
  }
  return out
}

function repairNode(value: unknown, ctx: RepairCtx, depth: number, path: string): GenuiNode | null {
  if (depth > GENUI_LIMITS.maxDepth) return null
  const v = obj(value)
  if (v === undefined) return null
  const type = v.type
  if (typeof type !== 'string') return null
  // Unknown-key diff against the per-type field table (K3 audit #8): repair
  // rebuilds every node from whitelisted keys, so anything else silently
  // vanishes — record it when a collector is attached. Types without a table
  // (plugin-registered customs) pass through untouched and stay unexamined.
  const allowed = NODE_KEYS[type]
  if (allowed !== undefined) {
    for (const key of Object.keys(v)) {
      // 'type' is the discriminator itself, not a payload field: it is
      // consumed by the switch below, never dropped — skip it so it does not
      // false-positive as an unknown key.
      if (key === 'type') continue
      if (!allowed.has(key)) {
        ctx.diag?.push({ kind: 'dropped-unknown-key', path, detail: `${path} 的字段 '${key}' 不是 ${type} 的合法字段，已被无声丢弃（键只取自字段表）` })
      }
    }
  }
  switch (type) {
    case 'text': {
      if (v.content === undefined && v.text !== undefined) renamed(ctx, path, 'text', 'content')
      const content = str(v.content, GENUI_LIMITS.maxString) ?? str(v.text, GENUI_LIMITS.maxString)
      if (content === undefined) return null
      return { type: 'text', content, ...opt('size', enu(v.size, TEXT_SIZES)), ...opt('center', v.center === true ? true : undefined) }
    }
    case 'row': {
      return { type: 'row', items: repairContainerItems(v, ctx, depth, path), ...opt('wrap', v.wrap === true ? true : undefined), ...opt('spacer', v.spacer === true ? true : undefined) }
    }
    case 'col': {
      return { type: 'col', items: repairContainerItems(v, ctx, depth, path), ...opt('gap', num(v.gap, 0, 96)) }
    }
    case 'grid': {
      return { type: 'grid', cols: int(v.cols, 1, GENUI_LIMITS.maxGridCols) ?? 1, items: repairContainerItems(v, ctx, depth, path) }
    }
    case 'card': {
      return { type: 'card', items: repairContainerItems(v, ctx, depth, path), ...opt('title', str(v.title, GENUI_LIMITS.maxString)) }
    }
    case 'button': {
      if (v.label === undefined && v.text !== undefined) renamed(ctx, path, 'text', 'label')
      const label = str(v.label, GENUI_LIMITS.maxString) ?? str(v.text, GENUI_LIMITS.maxString)
      if (label === undefined) return null
      return {
        type: 'button', label,
        ...opt('tone', enu(v.tone, BUTTON_TONES)),
        ...opt('full', v.full === true ? true : undefined),
        ...opt('small', v.small === true ? true : undefined),
        ...opt('icon', str(v.icon, 64)),
        ...opt('action', str(v.action, 200)),
      }
    }
    case 'input': {
      return {
        type: 'input',
        ...opt('label', str(v.label, GENUI_LIMITS.maxString)),
        ...opt('placeholder', str(v.placeholder, GENUI_LIMITS.maxString)),
        ...opt('value', str(v.value, GENUI_LIMITS.maxString)),
        ...opt('inputType', enu(v.inputType, INPUT_TYPES)),
        ...opt('action', str(v.action, 200)),
        ...opt('id', str(v.id, 200)),
      }
    }
    case 'select': {
      if (v.options === undefined && v.choices !== undefined) renamed(ctx, path, 'choices', 'options')
      const options = repairStrings(v.options ?? v.choices, GENUI_LIMITS.maxOptions, GENUI_LIMITS.maxString)
      if (options === undefined) return null
      return {
        type: 'select', options,
        ...opt('label', str(v.label, GENUI_LIMITS.maxString)),
        ...opt('action', str(v.action, 200)),
        ...opt('selected', int(v.selected, 0, options.length - 1)),
        ...opt('id', str(v.id, 200)),
      }
    }
    case 'checkbox': {
      const label = str(v.label, GENUI_LIMITS.maxString)
      if (label === undefined) return null
      return { type: 'checkbox', label, ...opt('checked', v.checked === true ? true : undefined), ...opt('action', str(v.action, 200)) }
    }
    case 'link': {
      const label = str(v.label, GENUI_LIMITS.maxString)
      if (label === undefined) return null
      return { type: 'link', label, ...opt('href', safeHref(v.href)) }
    }
    case 'audio': {
      if (v.src === undefined && v.url !== undefined) renamed(ctx, path, 'url', 'src')
      const src = safeMediaSrc(v.src ?? v.url)
      if (src === undefined) return null
      return {
        type: 'audio', src,
        ...opt('alt', str(v.alt, GENUI_LIMITS.maxString)),
        ...opt('loop', v.loop === true ? true : undefined),
      }
    }
    case 'video': {
      if (v.src === undefined && v.url !== undefined) renamed(ctx, path, 'url', 'src')
      const src = safeMediaSrc(v.src ?? v.url)
      if (src === undefined) return null
      return {
        type: 'video', src,
        ...opt('alt', str(v.alt, GENUI_LIMITS.maxString)),
        ...opt('poster', safeMediaSrc(v.poster)),
        ...opt('loop', v.loop === true ? true : undefined),
        ...opt('muted', v.muted === true ? true : undefined),
        ...opt('aspectRatio', enu(v.aspectRatio, MEDIA_ASPECT_RATIOS)),
      }
    }
    case 'badge': {
      const label = str(v.label, GENUI_LIMITS.maxString) ?? str(v.text, GENUI_LIMITS.maxString) ?? str(v.value, GENUI_LIMITS.maxString)
      if (label === undefined) return null
      return { type: 'badge', label, ...opt('tone', enu(v.tone, BADGE_TONES)), ...opt('icon', str(v.icon, 64)) }
    }
    case 'stat': {
      if (v.value === undefined && v.val !== undefined) renamed(ctx, path, 'val', 'value')
      const label = str(v.label, GENUI_LIMITS.maxString)
      const value = str(v.value, 128) ?? str(v.val, 128)
      if (label === undefined || value === undefined) return null
      // unit (K3 audit #9): optional suffix rendered appended to value
      // (value '72' + unit '%' displays '72%') — the model may also bake
      // the unit into the value string; both render identically.
      return { type: 'stat', label, value, ...opt('delta', str(v.delta, 64)), ...opt('unit', str(v.unit, 32)) }
    }
    case 'progress': {
      if (v.value === undefined && v.percent !== undefined) renamed(ctx, path, 'percent', 'value')
      const value = num(v.value ?? v.percent, 0, 100)
      if (value === undefined) return null
      return { type: 'progress', value, ...opt('label', str(v.label, GENUI_LIMITS.maxString)), ...opt('valueLabel', str(v.valueLabel, 64)) }
    }
    case 'divider': return { type: 'divider' }
    case 'spacer': return { type: 'spacer' }
    case 'avatar': {
      const name = str(v.name, 64)
      if (name === undefined) return null
      return { type: 'avatar', name, ...opt('color', color(v.color)) }
    }
    case 'list': {
      if (v.items === undefined && v.children !== undefined) renamed(ctx, path, 'children', 'items')
      const items = repairListItems(v.items ?? v.children, GENUI_LIMITS.maxListItems, ctx, depth + 1, `${path}.items`)
      if (items === undefined) return null
      return { type: 'list', items }
    }
    case 'table': {
      // `headers` is accepted as a `columns` alias — a common hand-written
      // spec mistake; the same tolerance as the `data`→`rows` alias below.
      const declaredCols = v.columns !== undefined ? v.columns : (v as Record<string, unknown>).headers
      // Alias repairs are recorded (K3 audit #8): the model wrote `headers`
      // / `data` — silently healed here, but it must not stay invisible.
      if (v.columns === undefined && (v as Record<string, unknown>).headers !== undefined) renamed(ctx, path, 'headers', 'columns')
      if (v.rows === undefined && (v as Record<string, unknown>).data !== undefined) renamed(ctx, path, 'data', 'rows')
      let rawCols = declaredCols as unknown
      let rawRows = v.rows !== undefined ? v.rows : (v as Record<string, unknown>).data
      // Self-heal model-shaped tables: antd-style object columns
      // ({title,key}) become header strings, and object-array rows (or a
      // `data` alias) flatten to 2D rows keyed by the column keys — without
      // this the whole node is dropped for "missing 2D rows" and the user
      // sees nothing (issue #42).
      if (Array.isArray(rawCols) && rawCols.length > 0 && typeof rawCols[0] === 'object' && rawCols[0] !== null) {
        rawCols = rawCols.map(c => columnHeaderText(c))
      }
      if (Array.isArray(rawRows) && rawRows.length > 0 && typeof rawRows[0] === 'object' && rawRows[0] !== null && !Array.isArray(rawRows[0])) {
        const keys = Array.isArray(declaredCols) && declaredCols.length > 0 && typeof declaredCols[0] === 'object' && declaredCols[0] !== null
          ? (declaredCols as Array<Record<string, unknown>>).map(c => columnKeyOf(c)).filter((k): k is string => k !== undefined)
          : Object.keys(rawRows[0] as Record<string, unknown>)
        rawRows = rawRows.map(row => keys.map(k => cellText((row as Record<string, unknown>)[k])))
      }
      const columns = repairStrings(rawCols, GENUI_LIMITS.maxTableCols, 128)
      const rows = repairRows(rawRows, GENUI_LIMITS.maxTableRows, GENUI_LIMITS.maxTableCols)
      if (columns === undefined || rows === undefined) return null
      return { type: 'table', columns, rows }
    }
    case 'chart': {
      if (v.data === undefined && v.points !== undefined) renamed(ctx, path, 'points', 'data')
      const data = repairChartData(v.data ?? v.points, GENUI_LIMITS.maxChartPoints)
      const series = Array.isArray(v.series) ? repairSeries(v.series, GENUI_LIMITS.maxPlotSeries, GENUI_LIMITS.maxChartPoints) : undefined
      // `data` is required by the type but grouped bars may ship `series`
      // alone; a series-only chart gets an empty data array (the renderer
      // reads `series` in that case).
      if (data === undefined && series === undefined) return null
      return { type: 'chart', data: data ?? [], ...opt('kind', enu(v.kind, CHART_KINDS)), ...opt('series', series) }
    }
    case 'tabs': {
      const tabs = repairTabs(v.tabs, ctx, depth, path)
      if (tabs === undefined) return null
      return { type: 'tabs', tabs }
    }
    case 'plot': {
      const series = repairPlotSeries(v.series, GENUI_LIMITS.maxPlotSeries)
      if (series === undefined) return null
      return {
        type: 'plot', series,
        ...opt('xMin', num(v.xMin, -1e6, 1e6)),
        ...opt('xMax', num(v.xMax, -1e6, 1e6)),
        ...opt('yMin', num(v.yMin, -1e9, 1e9)),
        ...opt('yMax', num(v.yMax, -1e9, 1e9)),
        ...opt('title', str(v.title, GENUI_LIMITS.maxString)),
      }
    }
    case 'callout': {
      // `text`/`body`/`description` are accepted as `content` aliases;
      // `type_`/`level` as `tone` aliases — all recorded (K3 audit #8):
      // the blacklist tells the model these forms are FORBIDDEN to emit.
      if (v.content === undefined) {
        if (v.text !== undefined) renamed(ctx, path, 'text', 'content')
        else if (v.body !== undefined) renamed(ctx, path, 'body', 'content')
        else if (v.description !== undefined) renamed(ctx, path, 'description', 'content')
      }
      if (v.tone === undefined && v.type_ !== undefined) renamed(ctx, path, 'type_', 'tone')
      else if (v.tone === undefined && v.level !== undefined) renamed(ctx, path, 'level', 'tone')
      const content = str(v.content, GENUI_LIMITS.maxString) ?? str(v.text, GENUI_LIMITS.maxString) ?? str(v.body, GENUI_LIMITS.maxString) ?? str(v.description, GENUI_LIMITS.maxString)
      if (content === undefined) return null
      return { type: 'callout', content, ...opt('tone', enu(v.tone ?? v.type_ ?? v.level, CALLOUT_TONES)), ...opt('title', str(v.title, GENUI_LIMITS.maxString)) }
    }
    case 'steps': {
      if (v.steps === undefined && v.items !== undefined) renamed(ctx, path, 'items', 'steps')
      const steps = repairSteps(v.steps ?? v.items)
      if (steps === undefined) return null
      return { type: 'steps', steps, ...opt('current', int(v.current, 0, steps.length)) }
    }
    case 'keyvalue': {
      if (v.pairs === undefined) {
        if (v.items !== undefined) renamed(ctx, path, 'items', 'pairs')
        else if (v.data !== undefined) renamed(ctx, path, 'data', 'pairs')
      }
      const pairs = repairPairs(v.pairs ?? v.items ?? v.data, GENUI_LIMITS.maxKeyValuePairs)
      if (pairs === undefined) return null
      return { type: 'keyvalue', pairs }
    }
    case 'diff': {
      const diffs = repairDiffs(v.diffs)
      if (diffs === undefined) return null
      return { type: 'diff', diffs }
    }
    case 'json': {
      // Any JSON VALUE is acceptable, but its SERIALIZED size is bounded:
      // JsonNode re-stringifies per render, so an unbounded payload let a
      // single node pin the main thread (echart options carry three caps;
      // json had none). Oversized values DROP the whole node — truncation
      // would produce invalid JSON.
      if (!('value' in v) && !('data' in v)) return null
      if (!('value' in v) && 'data' in v) renamed(ctx, path, 'data', 'value')
      const raw = v.value ?? v.data
      let serialized: string
      try {
        serialized = JSON.stringify(raw) ?? ''
      } catch {
        return null
      }
      if (serialized.length > GENUI_LIMITS.maxJsonValue) return null
      return { type: 'json', value: raw }
    }
    case 'code': {
      // `value` is accepted as a `code` alias (hand-written spec mistake),
      // but it is blacklist #2 — record the stitch so it is never silent.
      if (v.code === undefined && v.value !== undefined) renamed(ctx, path, 'value', 'code')
      const code = str(v.code, GENUI_LIMITS.maxCode) ?? str(v.value, GENUI_LIMITS.maxCode)
      if (code === undefined) return null
      return { type: 'code', code, ...opt('lang', str(v.lang, 64)) }
    }
    case 'radio': {
      if (v.options === undefined && v.choices !== undefined) renamed(ctx, path, 'choices', 'options')
      const options = repairStrings(v.options ?? v.choices, GENUI_LIMITS.maxOptions, GENUI_LIMITS.maxString)
      if (options === undefined) return null
      return {
        type: 'radio', options,
        ...opt('label', str(v.label, GENUI_LIMITS.maxString)),
        ...opt('selected', int(v.selected, 0, options.length - 1)),
        ...opt('action', str(v.action, 200)),
        ...opt('group', str(v.group, 200)),
        // answer: option index (number) or label (string); out-of-range
        // indices are DROPPED (clamping would silently grade against the
        // wrong option)
        ...opt('answer', typeof v.answer === 'number' && Number.isFinite(v.answer)
          && v.answer >= 0 && v.answer < options.length
          ? Math.trunc(v.answer)
          : typeof v.answer === 'string' ? v.answer.slice(0, 512) : undefined),
        ...opt('explanation', str(v.explanation, GENUI_LIMITS.maxString)),
      }
    }
    case 'submit': {
      const label = str(v.label, GENUI_LIMITS.maxString)
      // action is OPTIONAL: local grading (any question carries `answer`)
      // needs no round trip, so a submit without an action is valid. It only
      // becomes semantically required when no local answers exist — the
      // renderer disables the button then (honest affordance).
      const action = str(v.action, 200)
      if (label === undefined) return null
      return {
        type: 'submit', label,
        ...opt('action', action),
        ...opt('resetAction', str(v.resetAction, 200)),
        ...opt('groups', repairStrings(v.groups, GENUI_LIMITS.maxOptions, 200)),
      }
    }
    case 'switch': {
      const label = str(v.label, GENUI_LIMITS.maxString)
      if (label === undefined) return null
      return { type: 'switch', label, ...opt('checked', v.checked === true ? true : undefined), ...opt('action', str(v.action, 200)) }
    }
    case 'slider': {
      const min = num(v.min, -1e9, 1e9) ?? 0
      const max = num(v.max, -1e9, 1e9) ?? 100
      const lo = Math.min(min, max)
      const hi = Math.max(min, max)
      const step = num(v.step, 1e-9, Math.max(hi - lo, 1e-9))
      const value = num(v.value, lo, hi) ?? lo
      return {
        type: 'slider',
        min: lo,
        max: hi,
        ...opt('step', step),
        value,
        ...opt('label', str(v.label, GENUI_LIMITS.maxString)),
        ...opt('action', str(v.action, 200)),
        ...opt('id', str(v.id, 200)),
      }
    }
    case 'textarea': {
      return {
        type: 'textarea',
        ...opt('label', str(v.label, GENUI_LIMITS.maxString)),
        ...opt('placeholder', str(v.placeholder, GENUI_LIMITS.maxString)),
        ...opt('rows', int(v.rows, 1, 30)),
        ...opt('value', str(v.value, GENUI_LIMITS.maxString)),
        ...opt('action', str(v.action, 200)),
        ...opt('id', str(v.id, 200)),
      }
    }
    case 'accordion': {
      const items = repairAccordion(v.items, ctx, depth, path)
      if (items === undefined) return null
      return { type: 'accordion', items }
    }
    case 'copy': {
      if (v.text === undefined && v.content !== undefined) renamed(ctx, path, 'content', 'text')
      const text = str(v.text, GENUI_LIMITS.maxCode) ?? str(v.content, GENUI_LIMITS.maxCode)
      if (text === undefined) return null
      return { type: 'copy', text, ...opt('label', str(v.label, 128)) }
    }
    case 'mermaid': {
      if (v.code === undefined && v.source !== undefined) renamed(ctx, path, 'source', 'code')
      const code = str(v.code, GENUI_LIMITS.maxMermaid) ?? str(v.source, GENUI_LIMITS.maxMermaid)
      if (code === undefined) return null
      return { type: 'mermaid', code }
    }
    case 'scene3d': {
      // Shared per-spec cap (maxScene3dLeft): browsers allow ~16 live WebGL
      // contexts and cross it and the page loses EVERY context, so scenes
      // past the cap are dropped — repairItems reports the drop. The budget
      // is spent only on scenes that survive mesh repair, so an invalid
      // scene never burns a slot.
      if (ctx.scene3dLeft <= 0) return null
      if (v.meshes === undefined && v.objects !== undefined) renamed(ctx, path, 'objects', 'meshes')
      const meshes = repairMeshes(v.meshes ?? v.objects)
      if (meshes === undefined) return null
      ctx.scene3dLeft -= 1
      return { type: 'scene3d', meshes, ...opt('title', str(v.title, GENUI_LIMITS.maxString)), ...opt('ambient', num(v.ambient, 0, 2)), ...opt('background', color(v.background)) }
    }
    case 'diagram': {
      const repaired = repairDiagram(v)
      return repaired
    }
    case 'timeline': {
      if (v.items === undefined && v.entries !== undefined) renamed(ctx, path, 'entries', 'items')
      const items = repairTimeline(v.items ?? v.entries, GENUI_LIMITS.maxTimelineItems)
      if (items === undefined) return null
      return { type: 'timeline', items }
    }
    case 'file-tree': {
      // repairTree charges every entry (dir/file at any depth) against the
      // shared node budget — without it a huge tree bypasses the 200-node cap
      // and renders tens of thousands of DOM rows (long-thread).
      const items = repairTree(v.items, GENUI_LIMITS.maxListItems, ctx)
      if (items === undefined) return null
      return { type: 'file-tree', items }
    }
    case 'breadcrumb': {
      const items = repairStrings(v.items, GENUI_LIMITS.maxBreadcrumbItems, GENUI_LIMITS.maxString)
      if (items === undefined) return null
      return { type: 'breadcrumb', items }
    }
    case 'quiz': {
      if (v.options === undefined && v.choices !== undefined) renamed(ctx, path, 'choices', 'options')
      const question = str(v.question, GENUI_LIMITS.maxString)
      const options = repairQuizOptions(v.options ?? v.choices)
      if (question === undefined || options === undefined) return null
      return {
        type: 'quiz', question, options,
        ...opt('explanation', str(v.explanation, GENUI_LIMITS.maxString)),
        ...opt('id', str(v.id, 200)),
        ...opt('action', str(v.action, 200)),
      }
    }
    case 'echart': {
      // Preset shorthand data/series reuse the chart repair helpers.
      const data = v.data !== undefined ? repairChartData(v.data, GENUI_LIMITS.maxChartPoints) : undefined
      const series = v.series !== undefined && Array.isArray(v.series)
        ? repairSeries(v.series, GENUI_LIMITS.maxPlotSeries, GENUI_LIMITS.maxChartPoints)
        : undefined
      // Full option: depth-bounded pass-through (the model writes the ECharts
      // option object; the guard walks it to cap nesting but does not
      // validate ECharts semantics — that is echarts' own job).
      const sanitized = v.option !== undefined
        ? sanitizeEChartOption(v.option, 0, { count: GENUI_LIMITS.maxEChartOptionNodes })
        : undefined
      // A chart option root is always a plain object; a scalar root is
      // invalid, so degrade to preset/data/series handling (option dropped).
      const option: Record<string, unknown> | undefined =
        sanitized === undefined || typeof sanitized !== 'object' || sanitized === null || Array.isArray(sanitized)
          ? undefined
          : sanitized as Record<string, unknown>
      // At least one of preset+data or option must be present.
      if (option === undefined && data === undefined && series === undefined) return null
      return {
        type: 'echart',
        ...opt('title', str(v.title, GENUI_LIMITS.maxString)),
        ...opt('height', int(v.height, 100, 800)),
        ...opt('preset', enu(v.preset, ECHART_PRESETS)),
        ...opt('data', data),
        ...opt('series', series),
        ...opt('option', option),
      }
    }
    default:
      // Plugin-registered custom node types are opaque to the guard: pass
      // through unchanged (the renderer's default branch resolves them).
      return value as GenuiNode
  }
}

/* ---------------- per-type sub-repairers ---------------- */

function repairStrings(v: unknown, cap: number, strCap: number): string[] | undefined {
  if (!Array.isArray(v)) return undefined
  const out: string[] = []
  for (const item of v) {
    if (out.length >= cap) break
    if (typeof item === 'string') {
      out.push(item.slice(0, strCap))
    } else if (item !== null && typeof item === 'object') {
      // 兼容模型误用对象数组（如把 ask_user_question 的 {label,description}
      // 格式错用到 select/radio 的 options）——提取可读字段，而不是静默丢
      // 掉整个选项，让用户看到「选项没列举出来」的空列表。
      const o = item as Record<string, unknown>
      const s = typeof o.label === 'string' ? o.label
        : typeof o.value === 'string' ? o.value
        : typeof o.title === 'string' ? o.title
        : JSON.stringify(item)
      out.push(s.slice(0, strCap))
    }
  }
  return out
}

function repairListItems(
  v: unknown,
  cap: number,
  ctx: RepairCtx,
  depth: number,
  path: string,
): GenuiList['items'] | undefined {
  if (!Array.isArray(v)) return undefined
  const out: GenuiList['items'] = []
  let i = 0
  for (const item of v) {
    i += 1
    if (out.length >= cap) break
    if (typeof item === 'string') {
      out.push(item.slice(0, GENUI_LIMITS.maxString))
      continue
    }
    const o = obj(item)
    const title = o === undefined ? undefined : str(o.title, GENUI_LIMITS.maxString)
    if (title !== undefined) {
      out.push({ title, ...opt('desc', o === undefined ? undefined : str(o.desc, GENUI_LIMITS.maxString)) })
      continue
    }
    if (o !== undefined && typeof o.type === 'string') {
      // Typed children are GenuiNodes: charge them against the shared node
      // budget (module header promise — exhausted budget elides remaining
      // siblings). Strings and {title,desc} objects are list-item shapes,
      // not nodes, so they never consume budget. Same accounting as
      // repairItems: charge before repairNode (nested walks must see the
      // decremented pool mid-repair), refund a dropped child — only KEPT
      // nodes spend the shared quota.
      if (ctx.remaining <= 0) break
      ctx.remaining -= 1
      const node = repairNode(o, ctx, depth, `${path}[${i - 1}]`)
      if (node !== null) out.push(node)
      else {
        ctx.remaining += 1
        ctx.diag?.push({ kind: 'dropped-node', path: `${path}[${i - 1}]`, detail: `${path}[${i - 1}]（type '${o.type}'）因必填字段缺失或类型非法被整体丢弃` })
      }
    }
  }
  return out
}

function repairRows(v: unknown, rowCap: number, colCap: number): Array<Array<string | number>> | undefined {
  if (!Array.isArray(v)) return undefined
  const out: Array<Array<string | number>> = []
  for (const row of v) {
    if (out.length >= rowCap) break
    if (!Array.isArray(row)) continue
    const cells: Array<string | number> = []
    for (const cell of row) {
      if (cells.length >= colCap) break
      if (typeof cell === 'string') cells.push(cell.slice(0, 256))
      else if (typeof cell === 'number' && Number.isFinite(cell)) cells.push(cell)
    }
    if (cells.length > 0) out.push(cells)
  }
  return out
}

function repairChartData(v: unknown, cap: number): Array<{ label: string; value: number; color?: string }> | undefined {
  if (!Array.isArray(v)) return undefined
  const out: Array<{ label: string; value: number; color?: string }> = []
  for (const datum of v) {
    if (out.length >= cap) break
    const o = obj(datum)
    const label = o === undefined ? undefined : str(o.label, 128)
    const value = o === undefined ? undefined : num(o.value, -1e12, 1e12)
    if (label === undefined || value === undefined) continue
    out.push({ label, value, ...opt('color', o === undefined ? undefined : color(o.color)) })
  }
  return out
}

function repairSeries(v: unknown, cap: number, pointCap: number): Array<{ label: string; color?: string; data: Array<{ label: string; value: number; color?: string }> }> | undefined {
  if (!Array.isArray(v)) return undefined
  const out: Array<{ label: string; color?: string; data: Array<{ label: string; value: number; color?: string }> }> = []
  for (const s of v) {
    if (out.length >= cap) break
    const o = obj(s)
    const label = o === undefined ? undefined : str(o.label, 128)
    const data = o === undefined ? undefined : repairChartData(o.data, pointCap)
    if (label === undefined || data === undefined) continue
    out.push({ label, data, ...opt('color', o === undefined ? undefined : color(o.color)) })
  }
  return out
}

function repairTabs(v: unknown, ctx: RepairCtx, depth: number, path: string): Array<{ label: string; items: GenuiNode[] }> | undefined {
  if (!Array.isArray(v)) return undefined
  const out: Array<{ label: string; items: GenuiNode[] }> = []
  for (let i = 0; i < v.length; i++) {
    if (out.length >= GENUI_LIMITS.maxTabs) break
    const o = obj(v[i])
    const label = o === undefined ? undefined : str(o.label, 128)
    if (label === undefined || o === undefined) continue
    // `content` is accepted as an `items` alias (single component or array) —
    // models routinely emit tabs[].content and losing it empties every tab.
    const tabPath = `${path}.tabs[${i}]`
    if (o.items === undefined && o.content !== undefined) renamed(ctx, tabPath, 'content', 'items')
    const rawItems = o.items !== undefined ? o.items
      : o.content !== undefined ? (Array.isArray(o.content) ? o.content : [o.content])
      : undefined
    out.push({ label, items: repairItems(rawItems, ctx, depth + 1, `${tabPath}.items`) })
  }
  return out
}

/** Header text for an object-shaped table column ({title,key} antd style). */
function columnHeaderText(c: unknown): string {
  const o = obj(c)
  if (o === undefined) return String(c)
  for (const k of ['title', 'label', 'key', 'dataIndex'] as const) {
    const s = o[k]
    if (typeof s === 'string' && s !== '') return s
  }
  return JSON.stringify(c)
}

/** Row key for an object-shaped column, mirroring columnHeaderText's order. */
function columnKeyOf(c: unknown): string | undefined {
  const o = obj(c)
  if (o === undefined) return undefined
  for (const k of ['key', 'dataIndex', 'title', 'label'] as const) {
    const s = o[k]
    if (typeof s === 'string' && s !== '') return s
  }
  return undefined
}

/** Cell text for object-array rows: strings/finite numbers pass through,
 * everything else stringifies so the column alignment is preserved
 * (repairRows would drop null/undefined cells and shift the row). */
function cellText(v: unknown): string | number {
  if (typeof v === 'string') return v
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (v === null || v === undefined) return ''
  return JSON.stringify(v)
}

function repairPlotSeries(v: unknown, cap: number): GenuiPlot['series'] | undefined {
  if (!Array.isArray(v)) return undefined
  const out: GenuiPlot['series'] = []
  for (const s of v) {
    if (out.length >= cap) break
    const o = obj(s)
    const expr = o === undefined ? undefined : str(o.expr, 512)
    if (expr === undefined || o === undefined) continue
    const params: NonNullable<GenuiPlotSeries['params']> = []
    if (Array.isArray(o.params)) {
      for (const p of o.params) {
        if (params.length >= GENUI_LIMITS.maxPlotParams) break
        const po = obj(p)
        const name = po === undefined ? undefined : str(po.name, 64)
        const value = po === undefined ? undefined : num(po.value, -1e9, 1e9)
        if (name === undefined || value === undefined) continue
        params.push({
          name, value,
          ...opt('min', po === undefined ? undefined : num(po.min, -1e9, 1e9)),
          ...opt('max', po === undefined ? undefined : num(po.max, -1e9, 1e9)),
          ...opt('step', po === undefined ? undefined : num(po.step, 1e-9, 1e9)),
          ...opt('animateTo', po === undefined ? undefined : num(po.animateTo, -1e9, 1e9)),
          ...opt('durationMs', po === undefined ? undefined : num(po.durationMs, 1, 120_000)),
          ...opt('loop', po === undefined ? undefined : po.loop === true ? true : undefined),
        })
      }
    }
    out.push({ expr, ...opt('label', str(o.label, 128)), ...opt('color', color(o.color)), ...opt('kind', enu(o.kind, PLOT_KINDS)), ...opt('params', params.length > 0 ? params : undefined) })
  }
  return out
}

function repairSteps(v: unknown): Array<{ title: string; desc?: string }> | undefined {
  if (!Array.isArray(v)) return undefined
  const out: Array<{ title: string; desc?: string }> = []
  for (const s of v) {
    if (out.length >= GENUI_LIMITS.maxSteps) break
    const o = obj(s)
    const title = o === undefined ? undefined : str(o.title, 256)
    if (title === undefined) continue
    out.push({ title, ...opt('desc', o === undefined ? undefined : str(o.desc, GENUI_LIMITS.maxString)) })
  }
  return out
}

function repairPairs(v: unknown, cap: number): Array<{ key: string; value: string }> | undefined {
  if (!Array.isArray(v)) return undefined
  const out: Array<{ key: string; value: string }> = []
  for (const p of v) {
    if (out.length >= cap) break
    const o = obj(p)
    const key = o === undefined ? undefined : str(o.key, 256)
    const value = o === undefined ? undefined : str(o.value, GENUI_LIMITS.maxString)
    if (key === undefined || value === undefined) continue
    out.push({ key, value })
  }
  return out
}

function repairDiffs(v: unknown): Array<{ path: string; oldText: string | null; newText: string }> | undefined {
  if (!Array.isArray(v)) return undefined
  const out: Array<{ path: string; oldText: string | null; newText: string }> = []
  for (const d of v) {
    if (out.length >= 24) break
    const o = obj(d)
    const path = o === undefined ? undefined : str(o.path, 1024)
    const newText = o === undefined ? undefined : str(o.newText, 20_000)
    if (path === undefined || newText === undefined) continue
    const old = o === undefined ? undefined : o.oldText
    out.push({ path, newText, oldText: old === null || typeof old !== 'string' ? null : old.slice(0, 20_000) })
  }
  return out
}

function repairAccordion(v: unknown, ctx: RepairCtx, depth: number, path: string): Array<{ title: string; items: GenuiNode[] }> | undefined {
  if (!Array.isArray(v)) return undefined
  const out: Array<{ title: string; items: GenuiNode[] }> = []
  for (let i = 0; i < v.length; i++) {
    if (out.length >= GENUI_LIMITS.maxAccordionItems) break
    const o = obj(v[i])
    const title = o === undefined ? undefined : str(o.title, 256)
    if (title === undefined || o === undefined) continue
    out.push({ title, items: repairItems(o.items, ctx, depth + 1, `${path}.items[${i}]`) })
  }
  return out
}

function repairMeshes(v: unknown): GenuiScene3D['meshes'] | undefined {
  if (!Array.isArray(v)) return undefined
  const out: GenuiScene3D['meshes'] = []
  for (const m of v) {
    if (out.length >= GENUI_LIMITS.maxMeshes) break
    const o = obj(m)
    const shape = o === undefined ? undefined : enu(o.shape, MESH_SHAPES)
    if (shape === undefined) continue
    const scale = o === undefined ? undefined : num(o.scale, -1e6, 1e6) ?? tuple3(o.scale)
    const size = o === undefined ? undefined : num(o.size, -1e6, 1e6) ?? tuple3(o.size)
    out.push({
      shape,
      // solidColor, not color(): a mesh color lands in THREE.Color, which
      // never throws but silently renders unparseable strings (e.g.
      // var(--dsw-*) — browser-only tokens) as WHITE — filter to solid
      // literals here so a mesh degrades to the default palette instead of
      // washing out (the renderer adds no validation of its own).
      ...opt('color', o === undefined ? undefined : solidColor(o.color)),
      ...opt('position', o === undefined ? undefined : tuple3(o.position)),
      ...opt('rotation', o === undefined ? undefined : tuple3(o.rotation)),
      ...opt('scale', scale),
      ...opt('size', size),
    })
  }
  return out
}

function tuple3(v: unknown): [number, number, number] | undefined {
  if (!Array.isArray(v) || v.length !== 3) return undefined
  const [a, b, c] = v
  if (typeof a !== 'number' || !Number.isFinite(a) || typeof b !== 'number' || !Number.isFinite(b)
    || typeof c !== 'number' || !Number.isFinite(c)) return undefined
  return [Math.min(1e6, Math.max(-1e6, a)), Math.min(1e6, Math.max(-1e6, b)), Math.min(1e6, Math.max(-1e6, c))]
}

/* ---------------- diagram (editorial) sub-repairers ---------------- */

/** Clamp a coordinate/size to the 4px editorial grid. */
function grid4(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(v / 4) * 4))
}

function repairDiagramNodes(v: unknown): GenuiDiagram['nodes'] | undefined {
  if (!Array.isArray(v)) return undefined
  const out: GenuiDiagram['nodes'] = []
  const seen = new Set<string>()
  for (const raw of v) {
    if (out.length >= GENUI_LIMITS.maxDiagramNodes) break
    const o = obj(raw)
    if (o === undefined) continue
    const id = str(o.id, 128)
    const label = str(o.label, GENUI_LIMITS.maxString)
    if (id === undefined || label === undefined) continue
    if (seen.has(id)) continue
    seen.add(id)
    const nodeType = enu(o.type, DIAGRAM_NODE_TYPES)
    // Coordinate fields are clamped to a sane canvas and rounded to 4px.
    const x = o.x === undefined ? undefined : grid4(num(o.x, -1e6, 1e6) ?? 0, 0, 1e6)
    const y = o.y === undefined ? undefined : grid4(num(o.y, -1e6, 1e6) ?? 0, 0, 1e6)
    const w = o.w === undefined ? undefined : grid4(num(o.w, -1e6, 1e6) ?? 96, 40, 2000)
    const h = o.h === undefined ? undefined : grid4(num(o.h, -1e6, 1e6) ?? 48, 24, 1200)
    out.push({
      id, label,
      ...opt('sub', str(o.sub, 256)),
      ...opt('type', nodeType),
      ...opt('x', x),
      ...opt('y', y),
      ...opt('w', w),
      ...opt('h', h),
      ...opt('tag', str(o.tag, 32)),
    })
  }
  return out
}

function repairDiagramEdges(v: unknown): GenuiDiagram['edges'] | undefined {
  if (v === undefined) return []
  if (!Array.isArray(v)) return undefined
  const out: GenuiDiagram['edges'] = []
  for (const raw of v) {
    if (out.length >= GENUI_LIMITS.maxDiagramEdges) break
    const o = obj(raw)
    if (o === undefined) continue
    const from = str(o.from, 128)
    const to = str(o.to, 128)
    if (from === undefined || to === undefined) continue
    out.push({
      from, to,
      ...opt('label', str(o.label, GENUI_LIMITS.maxDiagramLabel)),
      ...opt('kind', enu(o.kind, DIAGRAM_EDGE_KINDS)),
      ...opt('route', enu(o.route, DIAGRAM_ROUTES)),
    })
  }
  return out
}

function repairDiagramTheme(v: unknown): GenuiDiagramTheme | undefined {
  const o = obj(v)
  if (o === undefined) return undefined
  const out: GenuiDiagramTheme = {}
  for (const key of ['paper', 'paper-2', 'ink', 'muted', 'soft', 'rule', 'accent', 'accent-tint', 'link'] as const) {
    const c = color(o[key])
    if (c !== undefined) out[key] = c
  }
  return Object.keys(out).length === 0 ? undefined : out
}

function repairDiagramZones(v: unknown): GenuiDiagram['zones'] | undefined {
  if (v === undefined) return []
  if (!Array.isArray(v)) return undefined
  const out: GenuiDiagram['zones'] = []
  for (const raw of v) {
    if (out.length >= GENUI_LIMITS.maxDiagramZones) break
    const o = obj(raw)
    if (o === undefined) continue
    const label = str(o.label, 64)
    if (label === undefined) continue
    out.push({
      label,
      ...opt('x', o.x === undefined ? undefined : grid4(num(o.x, -1e6, 1e6) ?? 0, 0, 1e6)),
      ...opt('y', o.y === undefined ? undefined : grid4(num(o.y, -1e6, 1e6) ?? 0, 0, 1e6)),
      ...opt('w', o.w === undefined ? undefined : grid4(num(o.w, -1e6, 1e6) ?? 100, 40, 2000)),
      ...opt('h', o.h === undefined ? undefined : grid4(num(o.h, -1e6, 1e6) ?? 100, 40, 1200)),
    })
  }
  return out
}

function repairDiagram(v: unknown): GenuiDiagram | null {
  const o = obj(v)
  if (o === undefined) return null
  const kind = enu(o.kind, DIAGRAM_KINDS as unknown as readonly GenuiDiagramKind[])
  if (kind === undefined) return null
  const nodes = repairDiagramNodes(o.nodes)
  if (nodes === undefined) return null
  const edges = repairDiagramEdges(o.edges)
  if (edges === undefined) return null
  const zones = repairDiagramZones(o.zones)
  if (zones === undefined) return null
  return {
    type: 'diagram', kind, nodes, edges, zones,
    ...opt('variant', enu(o.variant, DIAGRAM_VARIANTS)),
    ...opt('title', str(o.title, 256)),
    ...opt('theme', repairDiagramTheme(o.theme)),
  }
}

function repairTimeline(v: unknown, cap: number): Array<{ title: string; desc?: string; time?: string }> | undefined {
  if (!Array.isArray(v)) return undefined
  const out: Array<{ title: string; desc?: string; time?: string }> = []
  for (const item of v) {
    if (out.length >= cap) break
    const o = obj(item)
    const title = o === undefined ? undefined : str(o.title, 256)
    if (title === undefined) continue
    out.push({
      title,
      ...opt('desc', o === undefined ? undefined : str(o.desc, GENUI_LIMITS.maxString)),
      ...opt('time', o === undefined ? undefined : str(o.time, 128)),
    })
  }
  return out
}

function repairTree(v: unknown, cap: number, ctx: RepairCtx): GenuiFileTreeNode[] | undefined {
  // Recursion is bounded by GENUI_LIMITS.maxTreeDepth (see the inner walk).
  return walkTree(v, cap, GENUI_LIMITS.maxTreeDepth, ctx)
}

function walkTree(v: unknown, cap: number, depthLeft: number, ctx: RepairCtx): GenuiFileTreeNode[] | undefined {
  if (!Array.isArray(v)) return undefined
  const out: GenuiFileTreeNode[] = []
  for (const item of v) {
    // Every KEPT entry is a rendered DOM row at any depth: decrement the
    // SHARED budget (same pool repairItems uses) and stop the walk once it
    // is spent. A nameless junk entry is dropped BEFORE the charge — it
    // never renders, so it must not consume the valid-entry quota (the
    // decrement moved below the name check; walkTree still shares the one
    // ctx pool repairItems spends, so budget math stays consistent).
    if (out.length >= cap) break
    if (ctx.remaining <= 0) break
    const o = obj(item)
    if (o === undefined) continue
    const name = str(o.name, 256)
    if (name === undefined) continue
    ctx.remaining -= 1
    const children = depthLeft > 0 && Array.isArray(o.children) ? walkTree(o.children, cap, depthLeft - 1, ctx) : undefined
    out.push({ name, ...opt('type', enu(o.type, FILE_TYPES)), ...opt('children', children) })
  }
  return out
}

function repairQuizOptions(v: unknown): Array<{ label: string; correct?: boolean; feedback?: string }> | undefined {
  if (!Array.isArray(v)) return undefined
  const out: Array<{ label: string; correct?: boolean; feedback?: string }> = []
  for (const optItem of v) {
    if (out.length >= GENUI_LIMITS.maxQuizOptions) break
    const o = obj(optItem)
    const label = o === undefined ? undefined : str(o.label, 512)
    if (label === undefined) continue
    out.push({
      label,
      ...opt('correct', o === undefined ? undefined : o.correct === true ? true : undefined),
      ...opt('feedback', o === undefined ? undefined : str(o.feedback, GENUI_LIMITS.maxString)),
    })
  }
  return out
}

/**
 * Patterns that indicate HTML/script injection in a string field. ECharts
 * default `tooltip.renderMode: 'html'` writes tooltip content via
 * `innerHTML`; even with renderMode forced to 'richText' (see below),
 * filtering these patterns is defense-in-depth — a model (or a
 * prompt-injected model) should never emit `<script>`, `onerror=`, or
 * `javascript:` inside a chart option string.
 */
const ECHART_HTML_DANGER_RE = /<(?:script|img|svg|iframe|video|audio|object|embed|source)\b|on[a-z]+\s*=|javascript:/i

/**
 * Prefixes that make ECharts hand a string to the browser as a network/data
 * load: `series[].symbol: 'image://…'` (and graphic `style.image`) fetch an
 * external URL, while `data:`/`blob:` URLs load bytes directly — each is an
 * exfiltration/tracking channel for a prompt-injected model that the `url(` /
 * HTML checks above never see. Only a string STARTING with the scheme is
 * dangerous (ECharts prefix-parses these fields); labels, formatter
 * templates, and hex colors are unaffected.
 */
const ECHART_EXFIL_RE = /^(?:image|data|blob):/i

/**
 * Mutable budget counter for the sanitize walk — passed by reference so
 * every recursion shares one pool.
 */
interface EChartSanitizeBudget { count: number }

/**
 * Sanitize an ECharts option object: depth-bounded, budget-bounded
 * pass-through that strips dangerous values (functions, `url()` in styles,
 * HTML/script injection patterns in strings) but preserves the object shape
 * ECharts needs. Scalars are KEPT: ECharts options are full of them,
 * including inside `data` arrays (`data: [120, 150, 180]`,
 * `xAxis.data: ['1月', '2月']`). Previously a scalar hit the plain-object
 * gate below and returned undefined, so every primitive-valued array was
 * filtered to empty and dropped — a chart with a full `option` rendered
 * with empty series (blank canvas). This is a safety walk, not an ECharts
 * semantic validator.
 *
 * Security: `tooltip.renderMode` is forced to `'richText'` on every tooltip
 * object. ECharts' default `'html'` mode writes tooltip content via
 * `innerHTML`, which is an XSS vector when the option originates from model
 * output — a prompt-injected model could emit
 * `{"tooltip":{"formatter":"<img src=x onerror=...>"}}` and execute
 * arbitrary script. `richText` renders as text, never touching innerHTML.
 */
function sanitizeEChartOption(v: unknown, depth: number, budget: EChartSanitizeBudget): unknown {
  if (budget.count <= 0) return undefined
  budget.count -= 1
  if (depth > GENUI_LIMITS.maxEChartOptionDepth) return undefined
  // Scalars pass through: numbers/strings/booleans/null are legal ECharts
  // values both as object fields and as array elements.
  if (typeof v === 'string') {
    const s = v.slice(0, GENUI_LIMITS.maxString)
    // Reject strings containing HTML/script injection patterns or CSS url()
    // (exfiltration channel), plus image:/data:/blob: prefixes (ECharts turns
    // those into browser network/data loads — see ECHART_EXFIL_RE). Preserves
    // legitimate ECharts string values (labels, plain-text formatter
    // templates, hex colors, etc.).
    if (s.toLowerCase().includes('url(') || ECHART_HTML_DANGER_RE.test(s) || ECHART_EXFIL_RE.test(s.trim())) return undefined
    return s
  }
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'boolean') return v
  if (v === null) return null
  if (Array.isArray(v)) {
    const cap = Math.min(v.length, GENUI_LIMITS.maxEChartArrayLen)
    const arr: unknown[] = []
    for (let i = 0; i < cap; i++) {
      const s = sanitizeEChartOption(v[i], depth + 1, budget)
      // A rejected element becomes a null placeholder instead of being
      // dropped: index-aligned arrays (xAxis.data ↔ series.data) must keep
      // their positions or every later label/data point would shift left.
      arr.push(s !== undefined ? s : null)
    }
    return arr.length > 0 ? arr : undefined
  }
  const o = obj(v)
  if (o === undefined) return undefined
  const out: Record<string, unknown> = {}
  for (const [key, val] of Object.entries(o)) {
    // `image` fields accept BARE absolute URLs: ECharts fetches
    // graphic[].style.image and label.rich.*.backgroundColor.image directly,
    // but the string gate above (ECHART_EXFIL_RE) only matches
    // image:/data:/blob: PREFIXES, so a bare https:// URL slips through and
    // becomes a tracking/exfil channel. Protocol-relative URLs
    // (`//evil.example/x.png`) are equally fetched — the browser resolves
    // them against the page's own scheme — so they are dropped too. Text
    // that merely MENTIONS a URL lives under other keys (label.text,
    // formatter templates) and is unaffected.
    if (key === 'image' && typeof val === 'string' && (val.includes('://') || val.trim().startsWith('//'))) continue
    const s = sanitizeEChartOption(val, depth + 1, budget)
    if (s === undefined) continue
    // Force tooltip.renderMode: 'richText' to prevent ECharts from writing
    // tooltip content via innerHTML (the default 'html' mode is an XSS
    // vector when the option comes from model output).
    if (key === 'tooltip' && typeof s === 'object' && s !== null && !Array.isArray(s)) {
      (s as Record<string, unknown>).renderMode = 'richText'
    }
    out[key] = s
  }
  // Preserve legitimate empty objects: an input `{}` (e.g. an empty style
  // placeholder ECharts accepts) used to collapse to undefined, silently
  // deleting the key. Only fold non-empty objects whose every field was
  // stripped by the walk above.
  return Object.keys(out).length > 0 || Object.keys(o).length === 0 ? out : undefined
}

/**
 * Deterministically repair a raw spec value into a renderable GenuiSpec.
 * Returns null only when the root is not an object with an `items` array
 * (a bare component root is wrapped into a col first — the documented fence
 * vocabulary allows single-component bodies); every other defect is healed by
 * dropping/clamping/truncating. Idempotent: repairing a repaired spec is a
 * no-op.
 */
export function repairGenuiSpec(value: unknown, diag?: GenuiRepairDiagnostic[]): GenuiSpec | null {
  const v = obj(value)
  if (v === undefined) return null
  if (!Array.isArray(v.items)) {
    const wrapped = wrapSingleComponentRoot(value)
    if (wrapped === null) return null
    return repairGenuiSpec(wrapped, diag)
  }
  // K3 audit #8: optional diagnostic collector — silent when absent (the
  // streaming render path passes nothing), populated by the tools and the
  // fence resolver so alias stitches and drops surface to model + user.
  const ctx: RepairCtx = { remaining: GENUI_LIMITS.maxNodes, scene3dLeft: GENUI_LIMITS.maxScene3dNodes, ...(diag !== undefined ? { diag } : {}) }
  // Root-level unknown keys (everything but the four spec fields) also
  // vanish silently — record them at the `spec` path.
  if (diag !== undefined) {
    for (const key of Object.keys(v)) {
      if (key !== 'title' && key !== 'gap' && key !== 'panel' && key !== 'append' && key !== 'items') {
        diag.push({ kind: 'dropped-unknown-key', path: 'spec', detail: `spec 根对象的字段 '${key}' 不是合法的 spec 字段（title/gap/panel/append/items），已被无声丢弃` })
      }
    }
  }
  return {
    ...opt('title', str(v.title, GENUI_LIMITS.maxString)),
    ...opt('gap', num(v.gap, 0, 96)),
    ...opt('panel', v.panel === true ? true : undefined),
    ...opt('append', v.append === true ? true : undefined),
    items: repairItems(v.items, ctx, 0, 'items'),
  }
}

/* ---------------- validation ---------------- */

/**
 * Count the nodes of a spec tree (every item, descending into tabs /
 * accordion / file-tree / list containers — the same descent
 * `validateGenuiSpec` walks). Shared by the panel fold (node-budget gate)
 * and validation, so the panel never runs a second, divergent traversal.
 * `cap` bounds the walk for hostile inputs; the panel passes
 * `PANEL_LIMITS.maxNodes + 1` to detect overflow without counting the whole
 * tree.
 */
export function countGenuiNodes(value: unknown, cap = Number.POSITIVE_INFINITY): number {
  let count = 0
  const walk = (list: unknown): void => {
    if (!Array.isArray(list)) return
    for (const item of list) {
      if (count >= cap) return
      count += 1
      const v = obj(item)
      if (v === undefined) continue
      if (v.type === 'tabs' && Array.isArray(v.tabs)) {
        for (const t of v.tabs) {
          if (count >= cap) return
          const to = obj(t)
          if (to !== undefined) walk(to.items)
        }
      } else if (v.type === 'accordion' && Array.isArray(v.items)) {
        for (const it of v.items) {
          if (count >= cap) return
          const io = obj(it)
          if (io !== undefined) walk(io.items)
        }
      } else if ((v.type === 'row' || v.type === 'col' || v.type === 'grid' || v.type === 'card') && Array.isArray(v.items)) {
        // Layout containers hold real children; skipping them undercounted
        // the tree and hid silent drops from validate_dsh_ui (issue #42).
        walk(v.items)
      } else if (v.type === 'file-tree' && Array.isArray(v.items)) {
        walk(v.items)
      } else if (v.type === 'list' && Array.isArray(v.items)) {
        // Typed list children are nodes too (repair charges them against the
        // budget); strings and {title,desc} shapes are skipped.
        for (const li of v.items) {
          if (count >= cap) return
          const lo = obj(li)
          if (lo !== undefined && typeof lo.type === 'string') walk([lo])
        }
      }
    }
  }
  const root = obj(value)
  walk(root === undefined ? [] : root.items)
  return count
}

/** Every white-listed node `type`. Keep in sync with the repairNode switch —
 * validate_dsh_ui uses it to tell declared GenUI nodes apart from unrelated
 * `"type"` strings (e.g. file-tree's `{type:'file'}` children). */
export const GENUI_NODE_TYPES: ReadonlySet<string> = new Set([
  'accordion', 'audio', 'avatar', 'badge', 'breadcrumb', 'button', 'callout', 'card', 'chart',
  'checkbox', 'code', 'col', 'copy', 'diff', 'divider', 'file-tree', 'grid', 'input', 'json',
  'keyvalue', 'link', 'list', 'mermaid', 'plot', 'progress', 'quiz', 'radio', 'row', 'scene3d',
  'select', 'slider', 'spacer', 'stat', 'steps', 'submit', 'switch', 'table', 'tabs', 'text',
  'textarea', 'timeline', 'video', 'echart', 'diagram',
])

/**
 * Count DECLARED nodes in a raw spec tree: objects whose `type` is a
 * white-listed string, descending the same containers `countGenuiNodes`
 * walks. `validate_dsh_ui` compares this with the repaired count to surface
 * children the repair silently dropped (blank-render class of bugs, issue
 * #42) instead of reporting a green check on a half-empty tree.
 */
export function countDeclaredGenuiNodes(value: unknown, cap = Number.POSITIVE_INFINITY): number {
  let count = 0
  const declared = (candidate: unknown): boolean => {
    const o = obj(candidate)
    return o !== undefined && typeof o.type === 'string' && GENUI_NODE_TYPES.has(o.type)
  }
  const walk = (list: unknown): void => {
    if (!Array.isArray(list)) return
    for (const item of list) {
      if (count >= cap) return
      if (!declared(item)) continue
      count += 1
      const v = obj(item)
      if (v === undefined) continue
      if (v.type === 'tabs' && Array.isArray(v.tabs)) {
        for (const t of v.tabs) walkItemsOf(t)
      } else if (v.type === 'accordion' && Array.isArray(v.items)) {
        for (const it of v.items) walkItemsOf(it)
      } else if ((v.type === 'row' || v.type === 'col' || v.type === 'grid' || v.type === 'card') && Array.isArray(v.items)) {
        walk(v.items)
      } else if (v.type === 'list' && Array.isArray(v.items)) {
        for (const li of v.items) {
          if (declared(li)) walk([li])
        }
      }
    }
  }
  const walkItemsOf = (holder: unknown): void => {
    const o = obj(holder)
    if (o === undefined) return
    const items = o.items !== undefined ? o.items : o.content
    if (Array.isArray(items)) walk(items)
    else if (declared(items)) walk([items])
  }
  const root = obj(value)
  if (root === undefined) return count
  // Single-component root (no items array): the root itself is the declared node.
  if (!Array.isArray(root.items) && declared(value)) walk([value])
  else walk(root.items)
  return count
}

/**
 * Validate a raw spec value against the white list and limits, collecting
 * human-readable problems. Unlike repair this never mutates: it is a
 * diagnostic for tests and tooling. Unknown `type`s are reported (a plugin
 * custom type is valid only when a renderer is registered — the guard cannot
 * know, so it flags them as warnings).
 */
export function validateGenuiSpec(value: unknown): GenuiValidation {
  const errors: string[] = []
  const v = obj(value)
  if (v === undefined) return { ok: false, errors: ['spec root must be an object'] }
  if (!Array.isArray(v.items)) {
    // Single-component root: validate through the wrapped form so the tool
    // agrees with the renderer about what is a valid fence body.
    const wrapped = wrapSingleComponentRoot(value)
    if (wrapped !== null) return validateGenuiSpec(wrapped)
    return { ok: false, errors: ['spec.items must be an array'] }
  }
  if (v.title !== undefined && typeof v.title !== 'string') errors.push('spec.title must be a string')
  if (v.gap !== undefined && (typeof v.gap !== 'number' || !Number.isFinite(v.gap))) errors.push('spec.gap must be a finite number')
  let count = 0
  let capped = false
  const walk = (list: unknown, depth: number, path: string): void => {
    if (capped) return
    if (!Array.isArray(list)) {
      errors.push(`${path} must be an array`)
      return
    }
    for (let i = 0; i < list.length; i++) {
      if (capped || count >= GENUI_LIMITS.maxNodes) {
        if (!capped) {
          errors.push(`spec exceeds ${GENUI_LIMITS.maxNodes} nodes; tail elided`)
          capped = true
        }
        return
      }
      count += 1
      const at = `${path}[${i}]`
      validateNode(list[i], depth, at, errors, walk)
    }
  }
  walk(v.items, 0, 'items')
  return { ok: errors.length === 0, errors }
}

type Walker = (list: unknown, depth: number, path: string) => void

function validateNode(value: unknown, depth: number, at: string, errors: string[], walk: Walker): void {
  if (depth > GENUI_LIMITS.maxDepth) {
    errors.push(`${at}: exceeds max depth ${GENUI_LIMITS.maxDepth}`)
    return
  }
  const v = obj(value)
  if (v === undefined) {
    errors.push(`${at}: must be an object`)
    return
  }
  const type = v.type
  if (typeof type !== 'string') {
    errors.push(`${at}: missing string 'type'`)
    return
  }
  const isStr = (name: string): void => { if (v[name] !== undefined && typeof v[name] !== 'string') errors.push(`${at}: '${name}' must be a string`) }
  const isNum = (name: string): void => { if (v[name] !== undefined && (typeof v[name] !== 'number' || !Number.isFinite(v[name]))) errors.push(`${at}: '${name}' must be a finite number`) }
  switch (type) {
    case 'text':
      if (typeof v.content !== 'string' && typeof v.text !== 'string') {
        errors.push(`${at}: type 'text' requires content or text (string)`)
      }
      isStr('content')
      isStr('text')
      break
    case 'row': case 'col': case 'card': case 'grid':
      if (!Array.isArray(v.items) && !Array.isArray(v.children) && !Array.isArray(v.columns)) {
        errors.push(`${at}: type '${type}' requires items (array)`)
      }
      walk(v.items ?? v.children ?? v.columns, depth + 1, `${at}.items`)
      if (type === 'grid') isNum('cols')
      break
    case 'divider': case 'spacer':
      // No fields; a missing case here fell to `default` and wrongly
      // reported these as "unknown type" despite repair rendering them.
      break
    case 'button': case 'checkbox': case 'link': case 'switch':
      if (typeof v.label !== 'string' && typeof v.text !== 'string') errors.push(`${at}: type '${type}' requires label (string)`)
      isStr('label')
      break
    case 'audio': case 'video':
      if (typeof v.src !== 'string' && typeof v.url !== 'string') errors.push(`${at}: type '${type}' requires src (string)`)
      isStr('src')
      isStr('alt')
      if (type === 'video') isStr('poster')
      break
    case 'slider':
      isStr('label')
      isNum('min'); isNum('max'); isNum('step'); isNum('value')
      break
    case 'input': case 'textarea':
      isStr('label'); isStr('placeholder'); isStr('value')
      break
    case 'select': case 'radio':
      if (!Array.isArray(v.options) && !Array.isArray(v.choices)) errors.push(`${at}: type '${type}' requires options (array)`)
      break
    case 'submit':
      if (typeof v.label !== 'string') errors.push(`${at}: type 'submit' requires label (string)`)
      // action is optional (local grading needs no round trip); the
      // renderer disables the button when it is absent AND no question
      // carries local `answer` data.
      break
    case 'badge':
      if (typeof v.label !== 'string' && typeof v.text !== 'string' && typeof v.value !== 'string') {
        errors.push(`${at}: type 'badge' requires label, text, or value (string)`)
      }
      isStr('label')
      isStr('text')
      isStr('value')
      break
    case 'stat':
      if (typeof v.label !== 'string') errors.push(`${at}: type 'stat' requires label (string)`)
      if (typeof v.value !== 'string' && typeof v.val !== 'string') errors.push(`${at}: type 'stat' requires value (string)`)
      isStr('delta')
      // unit is an optional string suffix (K3 audit #9): type-check it so a
      // non-string unit surfaces as a validation error, not a silent drop.
      isStr('unit')
      break
    case 'progress':
      const progVal = v.value ?? v.percent
      if (typeof progVal !== 'number' || !Number.isFinite(progVal) || (progVal as number) < 0 || (progVal as number) > 100) {
        errors.push(`${at}: type 'progress' requires value (number 0..100)`)
      }
      isNum('value')
      break
    case 'avatar':
      if (typeof v.name !== 'string') errors.push(`${at}: type 'avatar' requires name (string)`)
      break
    case 'list':
      if (!Array.isArray(v.items) && !Array.isArray(v.children)) errors.push(`${at}: type 'list' requires items (array)`)
      if (Array.isArray(v.items)) {
        // Descend into typed children so validation agrees with repair and
        // rendering (they recurse into list items as GenuiNodes). Strings and
        // {title,desc} list-item shapes are not nodes and are skipped.
        for (let i = 0; i < v.items.length; i++) {
          const item = obj(v.items[i])
          if (item !== undefined && typeof item.type === 'string') {
            validateNode(item, depth + 1, `${at}.items[${i}]`, errors, walk)
          }
        }
      }
      break
    case 'table':
      // `headers` alias mirrors repair: a headers-only table is valid.
      if (!Array.isArray(v.columns) && !Array.isArray((v as Record<string, unknown>).headers)) errors.push(`${at}: type 'table' requires columns (array)`)
      if (!Array.isArray(v.rows)) errors.push(`${at}: type 'table' requires rows (array)`)
      break
    case 'chart':
      if (!Array.isArray(v.data) && !Array.isArray(v.points) && !Array.isArray(v.series)) errors.push(`${at}: type 'chart' requires data or series (array)`)
      break
    case 'tabs': {
      if (!Array.isArray(v.tabs)) errors.push(`${at}: type 'tabs' requires tabs (array)`)
      if (Array.isArray(v.tabs)) {
        for (let i = 0; i < v.tabs.length; i++) {
          const t = obj(v.tabs[i])
          if (t === undefined) { errors.push(`${at}.tabs[${i}] must be an object`); continue }
          if (typeof t.label !== 'string') errors.push(`${at}.tabs[${i}].label must be a string`)
          // Mirror repairTabs: `content` is accepted as an `items` alias
          // (single component or array). Validating items-only reported
          // working specs as broken and sent the model into pointless
          // rewrite loops via validate_dsh_ui.
          const rawItems = t.items !== undefined ? t.items
            : t.content !== undefined ? (Array.isArray(t.content) ? t.content : [t.content])
            : undefined
          walk(rawItems, depth + 1, `${at}.tabs[${i}].items`)
        }
      }
      break
    }
    case 'plot':
      if (!Array.isArray(v.series)) errors.push(`${at}: type 'plot' requires series (array)`)
      break
    case 'callout':
      // `text`/`body`/`description` aliases mirror repair.
      if (typeof v.content !== 'string' && typeof v.text !== 'string' && typeof v.body !== 'string' && typeof v.description !== 'string') errors.push(`${at}: type 'callout' requires content (string)`)
      break
    case 'steps':
      if (!Array.isArray(v.steps) && !Array.isArray(v.items)) errors.push(`${at}: type 'steps' requires steps (array)`)
      break
    case 'keyvalue':
      if (!Array.isArray(v.pairs) && !Array.isArray(v.items) && !Array.isArray(v.data)) errors.push(`${at}: type 'keyvalue' requires pairs (array)`)
      break
    case 'diff':
      if (!Array.isArray(v.diffs)) errors.push(`${at}: type 'diff' requires diffs (array)`)
      break
    case 'json':
      if (!('value' in v) && !('data' in v)) errors.push(`${at}: type 'json' requires value`)
      break
    case 'code':
      // `value` alias mirrors repair.
      if (typeof v.code !== 'string' && typeof v.value !== 'string') errors.push(`${at}: type 'code' requires code (string)`)
      break
    case 'accordion':
      if (!Array.isArray(v.items)) errors.push(`${at}: type 'accordion' requires items (array)`)
      if (Array.isArray(v.items)) {
        for (let i = 0; i < v.items.length; i++) {
          const item = obj(v.items[i])
          if (item === undefined) { errors.push(`${at}.items[${i}] must be an object`); continue }
          if (typeof item.title !== 'string') errors.push(`${at}.items[${i}].title must be a string`)
          walk(item.items, depth + 1, `${at}.items[${i}].items`)
        }
      }
      break
    case 'copy':
      if (typeof v.text !== 'string' && typeof v.content !== 'string') errors.push(`${at}: type 'copy' requires text (string)`)
      break
    case 'mermaid':
      if (typeof v.code !== 'string' && typeof v.source !== 'string') errors.push(`${at}: type 'mermaid' requires code (string)`)
      break
    case 'scene3d':
      if (!Array.isArray(v.meshes) && !Array.isArray(v.objects)) errors.push(`${at}: type 'scene3d' requires meshes (array)`)
      break
    case 'timeline':
      if (!Array.isArray(v.items) && !Array.isArray(v.entries)) errors.push(`${at}: type 'timeline' requires items (array)`)
      break
    case 'file-tree':
      if (!Array.isArray(v.items)) errors.push(`${at}: type 'file-tree' requires items (array)`)
      break
    case 'breadcrumb':
      if (!Array.isArray(v.items)) errors.push(`${at}: type 'breadcrumb' requires items (array)`)
      break
    case 'quiz':
      if (typeof v.question !== 'string') errors.push(`${at}: type 'quiz' requires question (string)`)
      if (!Array.isArray(v.options) && !Array.isArray(v.choices)) errors.push(`${at}: type 'quiz' requires options (array)`)
      break
    case 'diagram':
      if (typeof v.kind !== 'string') errors.push(`${at}: type 'diagram' requires kind (string)`)
      if (!Array.isArray(v.nodes)) errors.push(`${at}: type 'diagram' requires nodes (array)`)
      if (v.edges !== undefined && !Array.isArray(v.edges)) errors.push(`${at}: type 'diagram' requires edges (array) when present`)
      break

    case 'echart':
      if (v.option === undefined && v.data === undefined && v.series === undefined) {
        errors.push(`${at}: type 'echart' requires option, data, or series`)
      }
      isNum('height')
      break
    default:
      // Unknown type: plugin-registered custom nodes are valid when a
      // renderer exists; the guard cannot know, so report as a warning.
      errors.push(`${at}: unknown type '${type}' (custom renderer?)`)
  }
}
