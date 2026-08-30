/**
 * The dsh-ui fence render pipeline, shared by both render channels:
 *
 * - **Registry channel** (contract hosts): the host's MarkdownText resolves
 *   ```dsh-ui fences through the fence-registry extension point and calls
 *   {@link renderGenuiFence} with a session-scoped context (sessionId + the
 *   settled source identity). An unrepairable body renders {@link FenceFallback}.
 * - **DOM channel** (pristine hosts, no extension point): the DOM observer
 *   (`dom-fence.ts`) finds stock code blocks labelled `dsh-ui` and mounts
 *   {@link renderResolvedFenceNode} into its own React root, wrapped in the
 *   plugin-owned action context. An unrepairable body returns `null` so the
 *   stock code block stays visible.
 *
 * Structural types are declared locally on purpose: the context contract is
 * a data shape, and pristine hosts do not export the host-side type names.
 */
import { Fragment, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type Key, type ReactNode } from 'react'
import { CodeBlock } from '@deepseek-ai/dsh-client-ui-primitives'
import { ErrorBoundary } from './ErrorBoundary.tsx'
import { GenuiBlock } from './GenuiBlock.tsx'
import { repairGenuiSpec, validateGenuiSpec } from './guard.ts'
import { fenceStateKey } from './interaction-store.ts'
import { parsePartialGenuiSpec } from './parse-partial.ts'
import { applyPanelOperation, diagnosePanelBudget, type PanelOperationStatus } from './panel-store.ts'
import type { GenuiSpec } from './spec.ts'
import { completeFenceJson, describeJsonFailure, isCompleteJson, repairFenceJson } from '../shared/fence-repair.ts'

/** Settled fence source identity (data shape, host-independent). */
export interface GenuiFenceSource {
  /** Stable structural id, e.g. `['assistant', seq, block, fence]` or `dom:<anchor>:<i>`. */
  readonly id: string
  /** Three-part order: [messageSeq, textBlockIndex, fenceIndex]. */
  readonly order: readonly [number, number, number]
}

/** Context a fence renderer receives beside the raw source and React key. */
export interface GenuiFenceContext {
  /** Owning session route; absent outside a session-scoped render. */
  readonly sessionId?: string
  /** Present only for settled/interrupted renders with a stable identity. */
  readonly source?: GenuiFenceSource
}

/** Observation-loop payload for a SETTLED, unrepairable fence body: the
 * owning session route (absent outside a session-scoped render — nothing to
 * relay then), the stable source identity when the host provided one, and
 * the human-readable parse failure (position + reason; never fence content). */
export interface GenuiFenceFailure {
  readonly sessionId: string | undefined
  readonly sourceId: string | undefined
  readonly diagnostic: string
}

/** Reporter seam: the client entry wires this to the scoped conversation
 * send so the model learns its fence never rendered (P1 observation loop).
 * Fired AT MOST ONCE per failed fence identity — see the dedup set below. */
export type GenuiFenceFailureReporter = (failure: GenuiFenceFailure) => void

/** localStorage key + size cap for the persisted dedup set (P1). */
const FENCE_FAILURE_DEDUP_KEY = 'dsh-genui:fence-failure-dedup:v1'
const FENCE_FAILURE_DEDUP_CAP = 400

/**
 * Already-reported fence failures (dedup), PERSISTED across page loads. A
 * fence re-renders on every message-tree pass and remounts on branch
 * switches, but the model must hear about one failure exactly once — the
 * reporter fires only when this set does not yet hold the key. Keyed by
 * session + source + diagnostic: a re-issued fence (fixed, later broken
 * again) always arrives under a NEW source identity and reports
 * independently; without a stable source the body length degrades into the
 * identity so distinct source-less failures stay distinct.
 *
 * Persistence: an in-memory set alone cleared on every refresh, so HISTORICAL
 * bad fences re-reported on each reload after remount — spamming the model
 * with the same dead failure N times. The dedup keys therefore ride
 * localStorage (stable across refreshes AND plugin reloads); every access is
 * guarded because storage can be blocked (sandboxed iframe, quota) — on any
 * failure the set degrades gracefully to the old session-only behavior.
 * Bounded by {@link FENCE_FAILURE_DEDUP_CAP}: oldest keys evict first (Set
 * preserves insertion order), so the store never grows unbounded.
 */
function loadReportedFenceFailures(): Set<string> {
  try {
    const raw = localStorage.getItem(FENCE_FAILURE_DEDUP_KEY)
    if (raw === null) return new Set()
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return new Set()
    const keys = parsed.filter((k): k is string => typeof k === 'string')
    return new Set(keys.slice(-FENCE_FAILURE_DEDUP_CAP))
  } catch {
    // Blocked/unavailable storage or a corrupt payload — dedup this page
    // load only (the pre-persistence behavior).
    return new Set()
  }
}

const reportedFenceFailures = loadReportedFenceFailures()

/** Record a reported failure in the set AND in localStorage, evicting the
 * oldest keys past the cap. A failed write never breaks the report itself:
 * the in-memory set still dedups everything this page load. */
function persistReportedFenceFailure(key: string): void {
  reportedFenceFailures.add(key)
  while (reportedFenceFailures.size > FENCE_FAILURE_DEDUP_CAP) {
    const oldest = reportedFenceFailures.values().next().value
    if (oldest === undefined) break
    reportedFenceFailures.delete(oldest)
  }
  try {
    localStorage.setItem(FENCE_FAILURE_DEDUP_KEY, JSON.stringify([...reportedFenceFailures]))
  } catch {
    // Storage unavailable — in-memory dedup above still covers this load.
  }
}

const FENCE_ERROR_STYLE: CSSProperties = {
  margin: '0 0 6px',
  padding: '6px 10px',
  borderRadius: 6,
  background: 'rgba(239, 68, 68, 0.14)',
  border: '1px solid rgba(239, 68, 68, 0.4)',
  color: '#f87171',
  fontSize: 12,
  lineHeight: 1.55,
  whiteSpace: 'pre-wrap',
}

/**
 * Fallback for a ```dsh-ui fence whose body has no finished component yet.
 * Two very different situations land here and they must not be conflated:
 *
 * 1. **Streaming partial** — the reply is still being written and the JSON
 *    simply is not complete. The host marks the streaming message with
 *    `[data-streaming]` on the AssistantMarkdown root, which is an ancestor
 *    of every fence. While that marker is present, a plain code block is the
 *    correct rendering (partial JSON must never look like an error).
 *
 * 2. **Settled defect** — the message is finished but the body still does
 *    not parse as JSON (a malformed fence like a missing `}`). This used to
 *    fail silently: the fence degraded to a code block with no hint, and the
 *    author had no way to know the UI never rendered. Once the streaming
 *    marker is gone, surface a compact diagnostic with the parse position so
 *    the defect is visible instead of silent — and, when a reporter is wired,
 *    relay the same failure back to the model exactly once (P1 observation
 *    loop): the author learns what went wrong and avoids the class of error,
 *    instead of the defect dying in the user's browser.
 */
function FenceFallback({ raw, fenceKey, context, reportFailure }: {
  raw: string
  fenceKey: Key
  context: GenuiFenceContext | undefined
  reportFailure: GenuiFenceFailureReporter | undefined
}) {
  const ref = useRef<HTMLDivElement | null>(null)
  const [settled, setSettled] = useState(false)
  useLayoutEffect(() => {
    const node = ref.current
    if (node !== null && node.closest('[data-streaming]') === null) setSettled(true)
  })
  const diagnostic = settled && raw.trim() !== '' ? describeJsonFailure(raw) : null
  // Failure report (P1): fire only when the defect is certain (settled +
  // parse failure), a reporter is wired, and a session route exists (no
  // session → no conversation.send channel → nothing to relay). The
  // module-level set dedups across re-renders AND remounts (branch switches,
  // message-tree passes), so one failure reaches the model exactly once; a
  // failed send is dropped like every fire-and-forget action here. The effect
  // runs post-paint and never gates the banner above — the UI is unaffected.
  const sessionId = context?.sessionId
  const sourceId = context?.source?.id
  const rawLength = raw.length
  useEffect(() => {
    if (diagnostic === null || reportFailure === undefined || sessionId === undefined) return
    const dedupKey = sessionId + '|' + (sourceId ?? 'raw:' + rawLength) + '|' + diagnostic
    if (reportedFenceFailures.has(dedupKey)) return
    persistReportedFenceFailure(dedupKey)
    reportFailure({ sessionId, sourceId, diagnostic })
  }, [diagnostic, reportFailure, sessionId, sourceId, rawLength])
  return (
    <div ref={ref}>
      {diagnostic !== null && (
        <div style={FENCE_ERROR_STYLE} role="alert">
          ⚠️ dsh-ui fence JSON 解析失败{diagnostic} —— 围栏保持为代码块；请让模型检查并修复 JSON 后重发。
        </div>
      )}
      <CodeBlock key={fenceKey} code={`${raw}\n`} lang="dsh-ui" />
    </div>
  )
}

/**
 * Keyed publisher for a settled `panel:true` fence: submits ONE panel
 * operation from the host-provided stable source (id + order), in an
 * effect — never inside the render function. StrictMode's duplicate effects
 * are absorbed by the operation map's per-source dedup, so the panel folds
 * and notifies exactly once per source. Renders nothing.
 *
 * The effect fires once per source identity, not once per render: the host
 * re-invokes the fence renderer on every message-tree render (a fresh spec
 * object each time) and a replayed operation is an idempotent no-op in the
 * panel store anyway, so re-firing on `spec` identity only burned cycles.
 * `spec` therefore rides a latest-value ref read at fire time, and the
 * order tuple enters the deps as primitives — hosts rebuild the tuple array
 * per render, so its identity is not stable even though its values are.
 * A genuine content update always arrives under a NEW source (new message
 * seq / call id), which remounts or re-fires the effect as before.
 */
function FencePanelPublisher({ sessionId, sourceId, order, spec }: {
  sessionId: string
  sourceId: string
  order: readonly [number, number, number]
  spec: GenuiSpec
}) {
  const specRef = useRef(spec)
  specRef.current = spec
  useEffect(() => {
    const current = specRef.current
    const status: PanelOperationStatus = applyPanelOperation(sessionId, {
      sourceId,
      order,
      mode: current.append === true ? 'append' : 'replace',
      spec: current,
    })
    if (status === 'overflow') diagnosePanelBudget(sessionId, sourceId)
  }, [sessionId, sourceId, order[0], order[1], order[2]])
  return null
}

/**
 * Resolve a raw fence body to a guarded spec.
 *
 * - Tier-1 repair (quote escape + trailing commas): safe at any time —
 *   adopted only when the whole body parses, so a still-growing streaming
 *   half keeps falling back to the code block, never flashing a banner.
 * - Tier-2 completion (missing quotes/brackets): settled renders only —
 *   `context.source` exists exclusively once the message finished, so
 *   streaming halves are never completed early.
 */
export function resolveGenuiSpec(raw: string, context?: GenuiFenceContext): GenuiSpec | null {
  return resolveGenuiSpecDetailed(raw, context).spec
}

/** Parsed+repaired spec plus any validation problems found on the ORIGINAL
 * body (before repair). A non-empty `warnings` means the spec rendered but
 * was not exactly what the author wrote — the block shows an amber bar. */
export interface ResolvedGenuiSpec {
  spec: GenuiSpec | null
  warnings: string[]
}

export function resolveGenuiSpecDetailed(raw: string, context?: GenuiFenceContext): ResolvedGenuiSpec {
  const validate = (candidate: unknown): string[] => {
    if (candidate === undefined) return []
    const v = validateGenuiSpec(candidate)
    return v.ok ? [] : v.errors
  }
  // Warnings are a SETTLED-render concern: mid-stream, re-validating a
  // half-grown prefix per chunk flashed transient amber bars while typing.
  // "Settled" is either of:
  //   - the host marked the message finished (`context.source` exists), or
  //   - the body ALREADY parses as complete JSON — registry/toolview-style
  //     callers legitimately pass no context at all, and their complete
  //     bodies must still be validated (source alone was a false proxy for
  //     that case). A streaming half fails whole-body JSON.parse, so it
  //     stays suppressed. Short-circuit keeps the conversation path free of
  //     an extra parse when source already proves settledness.
  const settled = context?.source !== undefined || isCompleteJson(raw)
  const parsed = parsePartialGenuiSpec(raw)
  let spec = parsed === null ? null : repairGenuiSpec(parsed)
  // Warnings reflect the ORIGINAL parsed body when it was used as-is;
  // after repair the body has already been normalized, so re-validating the
  // repaired spec would hide the author's original mistake.
  let warnings = parsed === null || !settled ? [] : validate(parsed)
  if (spec === null) {
    const repaired = repairFenceJson(raw)
    if (repaired !== null) {
      const reparsed = parsePartialGenuiSpec(repaired.text)
      spec = reparsed === null ? null : repairGenuiSpec(reparsed)
      if (reparsed !== null && settled) warnings = validate(reparsed)
    }
    if (spec === null && context?.source !== undefined) {
      const completed = completeFenceJson(raw)
      if (completed !== null) {
        const reparsed = parsePartialGenuiSpec(completed.text)
        spec = reparsed === null ? null : repairGenuiSpec(reparsed)
        if (reparsed !== null && settled) warnings = validate(reparsed)
        // P3 visibility: a truncated degradation DROPPED content — the
        // rendered UI is only the repaired prefix, and that loss used to be
        // silent. Surface it in the amber bar so the author knows to check
        // for missing pieces instead of trusting the partial UI.
        if (spec !== null && completed.truncated === true) {
          warnings = [...warnings, '部分内容因格式错误被丢弃（渲染的是修复后保留的前缀，请检查是否缺内容）']
        }
      }
    }
  }
  return { spec, warnings }
}

/** The durable-state GenuiBlock for one inline fence: stateKey = session +
 * stable source + content fingerprint (v2.7 — replaying the same content
 * restores answers/lock/field values; new content (换题, edited spec) gets a
 * fresh key; without a stable source, streaming / non-conversation surfaces
 * do not persist state).
 *
 * The content fingerprint is memoized in a PER-MOUNT ref, not a module-level
 * variable (audit #9: no cross-session mutable global) — each fence instance
 * caches the JSON of the last spec it saw, exactly the granularity the old
 * single-entry module cache served. The memo exists because
 * renderInlineFence stringifies the spec on every call and GenuiBlock's memo
 * comparator stringifies both prop specs again — during streaming that
 * tripled the serialization of a growing tree. Specs are immutable between
 * renders, so identity is a sound cache key. */
function FingerprintedGenuiBlock({ sessionId, sourceKey, spec, warnings }: {
  sessionId: string | undefined
  sourceKey: string
  spec: GenuiSpec
  warnings: string[]
}): ReactNode {
  const memo = useRef<{ readonly spec: GenuiSpec; readonly fingerprint: string } | null>(null)
  let stateKey: string | undefined
  if (sessionId !== undefined) {
    if (memo.current === null || memo.current.spec !== spec) {
      memo.current = { spec, fingerprint: JSON.stringify(spec) }
    }
    stateKey = fenceStateKey(sessionId, sourceKey, memo.current.fingerprint)
  }
  return <GenuiBlock spec={spec} warnings={warnings} stateKey={stateKey} />
}

/** The inline GenuiBlock tree for a resolved non-panel spec. */
function renderInlineFence(key: Key, context: GenuiFenceContext | undefined, spec: GenuiSpec, warnings: string[] = []): ReactNode {
  return (
    // React key carries the stable source identity when present (atomic
    // remount at streaming→settled), falling back to the document key.
    // v2.8: repaired specs that carried validation problems now surface an
    // amber bar (the block still renders) — previously they rendered
    // SILENTLY with no clue the spec was not what the author wrote.
    <ErrorBoundary key={context?.source?.id ?? key} label="该界面">
      <FingerprintedGenuiBlock
        sessionId={context?.sessionId}
        sourceKey={context?.source?.id ?? String(key)}
        spec={spec}
        warnings={warnings}
      />
    </ErrorBoundary>
  )
}

/**
 * The resolved fence render for the DOM channel: `null` when the body is
 * unrepairable (the stock code block stays visible), otherwise the panel
 * publisher (`panel:true`; renders nothing in the flow — mounted as an empty
 * root so the taken-over block is hidden) or the inline GenuiBlock tree.
 * Shared verbatim by both channels.
 */
export function renderResolvedFenceNode(raw: string, key: Key, context?: GenuiFenceContext): ReactNode | null {
  const { spec, warnings } = resolveGenuiSpecDetailed(raw, context)
  if (spec === null) return null
  if (spec.panel === true) {
    // Publish only with a settled stable source — streaming/identity-less
    // renders keep the panel untouched. Appends additionally gate on a
    // complete body (a settled-but-malformed append never merges partial
    // content).
    if (context !== undefined && context.sessionId !== undefined && context.source !== undefined) {
      if (spec.append === true && !isCompleteJson(raw)) return <Fragment key={key} />
      return (
        <FencePanelPublisher
          key={key}
          sessionId={context.sessionId}
          sourceId={context.source.id}
          order={context.source.order}
          spec={spec}
        />
      )
    }
    return <Fragment key={key} />
  }
  return renderInlineFence(key, context, spec, warnings)
}

/**
 * Registry-channel fence renderer (contract hosts): like the resolved node,
 * but an unrepairable body renders the fallback code block + settled
 * diagnostic — the host replaced its own block with our output — and an
 * unpublishable `panel:true` fence renders `null` (nothing in the flow).
 *
 * `reportFailure` (optional) closes the observation loop on settled,
 * unrepairable bodies: the client entry passes a reporter that relays the
 * parse failure to the model through the same scoped conversation send the
 * [genui-action] channel uses. Optional so host/test callers that register
 * the renderer with the plain three-argument contract keep working.
 */
export function renderGenuiFence(raw: string, key: Key, context?: GenuiFenceContext, reportFailure?: GenuiFenceFailureReporter): ReactNode {
  const { spec, warnings } = resolveGenuiSpecDetailed(raw, context)
  if (spec === null) return <FenceFallback key={key} fenceKey={key} raw={raw} context={context} reportFailure={reportFailure} />
  if (spec.panel === true) {
    if (context !== undefined && context.sessionId !== undefined && context.source !== undefined) {
      if (spec.append === true && !isCompleteJson(raw)) return null
      return (
        <FencePanelPublisher
          key={key}
          sessionId={context.sessionId}
          sourceId={context.source.id}
          order={context.source.order}
          spec={spec}
        />
      )
    }
    return null
  }
  return renderInlineFence(key, context, spec, warnings)
}
