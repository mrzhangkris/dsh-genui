/**
 * GenUI spec language: the declarative component tree a model emits inside a
 * ```dsh-ui fence in its reply, which GenuiBlock renders as real interactive
 * UI inline in the conversation. The vocabulary is a white list — the renderer
 * maps each node to DOM directly, with no arbitrary-HTML path (same
 * untrusted-output stance as MarkdownText).
 *
 * v1 interactivity is client-side only: buttons, tabs, checkboxes, and inputs
 * are operable, but events do NOT flow back to the model.
 */

/** One node in the component tree. */
export type GenuiNode =
  | GenuiText
  | GenuiRow
  | GenuiCol
  | GenuiGrid
  | GenuiCard
  | GenuiButton
  | GenuiInput
  | GenuiSelect
  | GenuiCheckbox
  | GenuiLink
  | GenuiBadge
  | GenuiStat
  | GenuiProgress
  | GenuiDivider
  | GenuiList
  | GenuiTable
  | GenuiChart
  | GenuiTabs
  | GenuiAvatar
  | GenuiSpacer
  | GenuiPlot
  | GenuiCallout
  | GenuiSteps
  | GenuiKeyValue
  | GenuiDiff
  | GenuiJson
  | GenuiCode
  | GenuiRadio
  | GenuiSwitch
  | GenuiTextarea
  | GenuiAccordion
  | GenuiCopy
  | GenuiMermaid
  | GenuiScene3D
  | GenuiTimeline
  | GenuiFileTree
  | GenuiBreadcrumb
  | GenuiQuiz
  | GenuiSlider
  | GenuiFormula
  | GenuiSort
  | GenuiMatch
  | GenuiClassify
  | GenuiSimulation

export interface GenuiSpec {
  /** Short title shown as the card banner. */
  title?: string
  /** Vertical gap between root items in px. */
  gap?: number
  /** Panel-only flag: `true` routes the fence to the session panel dock
   * instead of the message flow (rendered by the same block, updated in
   * place on every publish). */
  panel?: boolean
  /** Root component list. */
  items: GenuiNode[]
}

/* ---------------- leaf nodes ---------------- */

export interface GenuiText {
  type: 'text'
  size?: 'h1' | 'h2' | 'h3' | 'body' | 'muted' | 'caption'
  content: string
  center?: boolean
}

export interface GenuiButton {
  type: 'button'
  label: string
  tone?: 'primary' | 'danger' | 'success' | 'ghost'
  full?: boolean
  small?: boolean
  icon?: string
  /** v2: when set, clicking sends this action back to the model. */
  action?: string
}

export interface GenuiInput {
  type: 'input'
  label?: string
  placeholder?: string
  value?: string
  inputType?: 'text' | 'email' | 'password'
  /** v2: when set, interaction sends this action back to the model. */
  action?: string
}

export interface GenuiSelect {
  type: 'select'
  label?: string
  options: string[]
  /** v2: when set, interaction sends this action back to the model. */
  action?: string
}

export interface GenuiCheckbox {
  type: 'checkbox'
  label: string
  checked?: boolean
  /** v2: when set, interaction sends this action back to the model. */
  action?: string
}

export interface GenuiLink {
  type: 'link'
  label: string
}

export interface GenuiBadge {
  type: 'badge'
  label: string
  tone?: 'success' | 'warn' | 'danger' | 'accent'
  icon?: string
}

export interface GenuiStat {
  type: 'stat'
  label: string
  value: string
  delta?: string
}

export interface GenuiProgress {
  type: 'progress'
  label?: string
  /** 0..100 */
  value: number
  valueLabel?: string
}

export interface GenuiDivider {
  type: 'divider'
}

export interface GenuiAvatar {
  type: 'avatar'
  name: string
  color?: string
}

export interface GenuiSpacer {
  type: 'spacer'
}

/* ---------------- container nodes ---------------- */

export interface GenuiRow {
  type: 'row'
  items: GenuiNode[]
  wrap?: boolean
  spacer?: boolean
}

export interface GenuiCol {
  type: 'col'
  items: GenuiNode[]
  gap?: number
}

export interface GenuiGrid {
  type: 'grid'
  cols: number
  items: GenuiNode[]
}

export interface GenuiCard {
  type: 'card'
  title?: string
  items: GenuiNode[]
}

export interface GenuiList {
  type: 'list'
  items: Array<string | { title: string; desc?: string }>
}

export interface GenuiTable {
  type: 'table'
  columns: string[]
  rows: Array<Array<string | number>>
}

export interface GenuiChartDatum {
  label: string
  value: number
  color?: string
}

export interface GenuiChart {
  type: 'chart'
  /** Chart shape: bars (default), line (trend), donut (share). */
  kind?: 'bars' | 'line' | 'donut'
  data: GenuiChartDatum[]
  /** Multi-series grouped bars: one series of data per entry. */
  series?: Array<{ label: string; color?: string; data: GenuiChartDatum[] }>
}

export interface GenuiTab {
  label: string
  items: GenuiNode[]
}

export interface GenuiTabs {
  type: 'tabs'
  tabs: GenuiTab[]
}

/* ---------------- v1.1 additions: plot / callout / steps / keyvalue / 收编 ---------------- */

export interface GenuiPlotSeries {
  /** Math expression in x (safe evaluator: sin/cos/tan/pow/sqrt/log/exp/abs/floor/ceil/round/min/max/pi/e). */
  expr: string
  /** Legend label; defaults to the expression. */
  label?: string
  /** Stroke color. */
  color?: string
  /** v2: adjustable parameters (e.g. {a: 2} in "a*sin(x)") — one slider each, live re-render. */
  params?: Array<{
    name: string
    value: number
    min?: number
    max?: number
    step?: number
    /** v1.5: animate this parameter (auto-play) from `value` to `animateTo`. */
    animateTo?: number
    /** Animation duration in ms (default 4000). */
    durationMs?: number
    /** Loop the animation (default false). */
    loop?: boolean
  }>
}

export interface GenuiPlot {
  type: 'plot'
  /** Functions to draw, in draw order. */
  series: GenuiPlotSeries[]
  xMin?: number
  xMax?: number
  yMin?: number
  yMax?: number
  title?: string
}

export interface GenuiCallout {
  type: 'callout'
  tone?: 'info' | 'success' | 'warning' | 'error'
  /** Short heading above the body. */
  title?: string
  content: string
}

export interface GenuiStep {
  title: string
  desc?: string
}

export interface GenuiSteps {
  type: 'steps'
  /** Completed steps are rendered in the accent color, the rest muted. */
  current?: number
  steps: GenuiStep[]
}

export interface GenuiKeyValue {
  type: 'keyvalue'
  pairs: Array<{ key: string; value: string }>
}

/** 收编 dsh DiffBlock: file mutations as an inline diff. */
export interface GenuiDiff {
  type: 'diff'
  diffs: Array<{
    path: string
    oldText: string | null
    newText: string
  }>
}

/** 收编 dsh JsonTree: a structured JSON value for inspection. */
export interface GenuiJson {
  type: 'json'
  /** Any JSON value to render as a tree. */
  value: unknown
}

/** 收编 dsh CodeBlock: syntax-highlighted code with an explicit language. */
export interface GenuiCode {
  type: 'code'
  lang?: string
  code: string
}

/* ---------------- v1.2: richer interactivity ---------------- */

export interface GenuiRadio {
  type: 'radio'
  label?: string
  options: string[]
  /** Default-selected option index. */
  selected?: number
  /** v2: when set, interaction sends this action back to the model. */
  action?: string
}

export interface GenuiSwitch {
  type: 'switch'
  label: string
  checked?: boolean
  /** v2: when set, interaction sends this action back to the model. */
  action?: string
}

export interface GenuiTextarea {
  type: 'textarea'
  label?: string
  placeholder?: string
  rows?: number
  value?: string
}

export interface GenuiAccordionItem {
  title: string
  items: GenuiNode[]
}

export interface GenuiAccordion {
  type: 'accordion'
  items: GenuiAccordionItem[]
}

export interface GenuiCopy {
  type: 'copy'
  label?: string
  text: string
}

/* ---------------- v1.3: advanced ---------------- */

/** Mermaid diagram: flowchart/sequence/class/gantt source rendered lazily. */
export interface GenuiMermaid {
  type: 'mermaid'
  /** Mermaid diagram source (whitelisted diagram kinds at render time). */
  code: string
}

/** One mesh in a 3D scene. */
export interface GenuiMesh {
  /** Primitive geometry, white-listed. */
  shape: 'box' | 'sphere' | 'cone' | 'cylinder' | 'torus'
  /** Mesh color. */
  color?: string
  /** [x, y, z] position. */
  position?: [number, number, number]
  /** [x, y, z] rotation in radians. */
  rotation?: [number, number, number]
  /** Uniform scale, or [sx, sy, sz]. */
  scale?: number | [number, number, number]
  /** Box size [w, h, d] or sphere/cone/cylinder radius. */
  size?: number | [number, number, number]
}

/** 3D scene rendered with three.js (lazily imported). */
export interface GenuiScene3D {
  type: 'scene3d'
  title?: string
  meshes: GenuiMesh[]
  /** Ambient light intensity (0..2). */
  ambient?: number
  /** Background color; default transparent. */
  background?: string
}

/* ---------------- v1.4: more content structure ---------------- */

export interface GenuiTimelineItem {
  /** Title of the event. */
  title: string
  /** Secondary description. */
  desc?: string
  /** Optional timestamp label. */
  time?: string
}

export interface GenuiTimeline {
  type: 'timeline'
  items: GenuiTimelineItem[]
}

export interface GenuiFileTreeNode {
  /** File or directory name. */
  name: string
  /** Directory when true (collapsible children). */
  type?: 'file' | 'dir'
  /** Child nodes (dirs only). */
  children?: GenuiFileTreeNode[]
}

export interface GenuiFileTree {
  type: 'file-tree'
  items: GenuiFileTreeNode[]
}

export interface GenuiBreadcrumb {
  type: 'breadcrumb'
  items: string[]
}

/* ---------------- v1.5: teaching ---------------- */

export interface GenuiQuizOption {
  label: string
  /** True when this option is the correct answer. */
  correct?: boolean
  /** Per-option feedback shown after selection. */
  feedback?: string
}

export interface GenuiQuiz {
  type: 'quiz'
  /** The question text. */
  question: string
  /** Answer options; exactly one should be correct. */
  options: GenuiQuizOption[]
  /** Shown after answering (either way). */
  explanation?: string
  /** Reset the quiz when this value changes (e.g. a question id). */
  id?: string
}

/* ---------------- learning controls ---------------- */

export interface GenuiSlider {
  type: 'slider'
  label: string
  value: number
  min: number
  max: number
  step?: number
  unit?: string
  action?: string
}

export interface GenuiFormulaStep {
  expression: string
  explanation?: string
}

export interface GenuiFormula {
  type: 'formula'
  label?: string
  expression: string
  steps?: GenuiFormulaStep[]
}

export interface GenuiSort {
  type: 'sort'
  prompt?: string
  items: string[]
  answer: string[]
  action?: string
}

export interface GenuiMatchPair {
  left: string
  right: string
}

export interface GenuiMatch {
  type: 'match'
  prompt?: string
  pairs: GenuiMatchPair[]
  action?: string
}

export interface GenuiClassifyGroup {
  label: string
  items: string[]
}

export interface GenuiClassify {
  type: 'classify'
  prompt?: string
  groups: GenuiClassifyGroup[]
  action?: string
}

export interface GenuiSimulationStep {
  label: string
  content: string
}

export interface GenuiSimulation {
  type: 'simulation'
  title?: string
  steps: GenuiSimulationStep[]
  current?: number
  intervalMs?: number
  loop?: boolean
  action?: string
}

/** Parse the raw fence body as a GenuiSpec, or null when it is not one. */
export function parseGenuiSpec(raw: string): GenuiSpec | null {
  const trimmed = raw.trim()
  if (trimmed === '') return null
  let value: unknown
  try {
    value = JSON.parse(trimmed)
  } catch {
    return null
  }
  return isGenuiSpec(value) ? value : null
}

/** Basic structural guard: is this object a valid GenuiSpec? */
export function isGenuiSpec(value: unknown): value is GenuiSpec {
  if (typeof value !== 'object' || value === null) return false
  const v = value as { items?: unknown; title?: unknown; gap?: unknown }
  if (!Array.isArray(v.items)) return false
  if (v.title !== undefined && typeof v.title !== 'string') return false
  if (v.gap !== undefined && typeof v.gap !== 'number') return false
  return true
}
