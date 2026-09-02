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

const FENCE_ERROR_STYLE: CSSProperties = {
  margin: '0 0 6px',
  padding: '6px 10px',
  borderRadius: 6,
  background: 'rgba(239, 68, 68, 0.14)',
  border: '1px solid rgba(239, 68, 68, 0.4)',
  // Host error token (same one DiffBlock uses), with the calibrated red as
  // fallback for token-less surfaces; the rgba tint/border keep their hex
  // approximations (the host exposes no error-tint token).
  color: 'var(--dsw-alias-state-error-primary, #f87171)',
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
 *    the defect is visible instead of silent.
 */
function FenceFallback({ raw, fenceKey }: { raw: string; fenceKey: Key }) {
  const ref = useRef<HTMLDivElement | null>(null)
  const [settled, setSettled] = useState(false)
  useLayoutEffect(() => {
    const node = ref.current
    if (node !== null && node.closest('[data-streaming]') === null) setSettled(true)
  })
  const diagnostic = settled && raw.trim() !== '' ? describeJsonFailure(raw) : null
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
 */
function FencePanelPublisher({ sessionId, sourceId, order, spec }: {
  sessionId: string
  sourceId: string
  order: readonly [number, number, number]
  spec: GenuiSpec
}) {
  useEffect(() => {
    const status: PanelOperationStatus = applyPanelOperation(sessionId, {
      sourceId,
      order,
      mode: spec.append === true ? 'append' : 'replace',
      spec,
    })
    if (status === 'overflow') diagnosePanelBudget(sessionId, sourceId)
  }, [sessionId, sourceId, order, spec])
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
  /**
   * Whole-body completeness of the adopted parse: true when the raw body
   * parses as-is OR tier-1 text repair heals it into a WHOLE-body parse
   * (trailing comma / unescaped quote — the author's full text is present).
   * False for prefix-closed partials (streaming truncation) and tier-2
   * bracket completions (a settled-but-truncated body cannot be told apart
   * from a missing-closer typo, so both stay conservatively incomplete).
   * The `panel append` gate consumes this instead of re-parsing the raw body:
   * gating on `isCompleteJson(raw)` used to silently drop appends whose only
   * defect was a repairable trailing comma.
   */
  complete: boolean
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
  const wholeRaw = isCompleteJson(raw)
  const settled = context?.source !== undefined || wholeRaw
  // Whole-body completeness for the append gate (see ResolvedGenuiSpec).
  // Computed once here so both render channels share the exact same verdict;
  // the `settled &&` short-circuit skips the repair scan mid-stream (a
  // streaming half never publishes an append anyway — no source exists).
  const complete = settled && (wholeRaw || repairFenceJson(raw) !== null)
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
      }
    }
  }
  return { spec, warnings, complete }
}

/** Single-entry fingerprint memo: renderInlineFence stringifies the spec for
 * the durable-state key on EVERY call, and GenuiBlock's memo comparator
 * stringifies both prop specs again — during streaming that tripled the
 * serialization of a growing tree. Specs are immutable between renders, so
 * identity is a sound cache key. */
let fingerprintSpec: GenuiSpec | null = null
let fingerprintCache = ''
function specFingerprint(spec: GenuiSpec): string {
  if (spec !== fingerprintSpec) {
    fingerprintSpec = spec
    fingerprintCache = JSON.stringify(spec)
  }
  return fingerprintCache
}

/** The inline GenuiBlock tree for a resolved non-panel spec. */
function renderInlineFence(key: Key, context: GenuiFenceContext | undefined, spec: GenuiSpec, warnings: string[] = []): ReactNode {
  const sessionId = context?.sessionId
  // The streaming→settled remount swaps the durable identity from the
  // document key to the settled source id; the fallback key lets the settled
  // mount migrate whatever the user answered mid-stream (see GenuiBlock).
  const fingerprint = specFingerprint(spec)
  const stateKey = sessionId === undefined
    ? undefined
    : fenceStateKey(sessionId, context?.source?.id ?? String(key), fingerprint)
  const fallbackStateKey = sessionId !== undefined && context?.source !== undefined
    ? fenceStateKey(sessionId, String(key), fingerprint)
    : undefined
  return (
    // React key carries the stable source identity when present (atomic
    // remount at streaming→settled), falling back to the document key.
    // v2.8: repaired specs that carried validation problems now surface an
    // amber bar (the block still renders) — previously they rendered
    // SILENTLY with no clue the spec was not what the author wrote.
    <ErrorBoundary key={context?.source?.id ?? key} label="该界面">
      <GenuiBlock
        spec={spec}
        warnings={warnings}
        // v2.7 durable state: session + stable source + content fingerprint —
        // replaying the same content restores answers/lock/field values; new
        // content (换题, edited spec) gets a fresh key. Without a stable
        // source (streaming / non-conversation surfaces) state is not
        // persisted.
        stateKey={stateKey}
        fallbackStateKey={fallbackStateKey}
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
  const { spec, warnings, complete } = resolveGenuiSpecDetailed(raw, context)
  if (spec === null) return null
  if (spec.panel === true) {
    // Publish only with a settled stable source — streaming/identity-less
    // renders keep the panel untouched. Appends additionally gate on a
    // WHOLE-body parse (see ResolvedGenuiSpec.complete): a settled-but-
    // truncated append never merges partial content, while a body whose only
    // defect was a repairable trailing comma still publishes.
    if (context !== undefined && context.sessionId !== undefined && context.source !== undefined) {
      if (spec.append === true && !complete) return <Fragment key={key} />
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
 */
export function renderGenuiFence(raw: string, key: Key, context?: GenuiFenceContext): ReactNode {
  const { spec, warnings, complete } = resolveGenuiSpecDetailed(raw, context)
  if (spec === null) return <FenceFallback key={key} fenceKey={key} raw={raw} />
  if (spec.panel === true) {
    if (context !== undefined && context.sessionId !== undefined && context.source !== undefined) {
      // Same whole-body append gate as the DOM channel (see renderResolvedFenceNode).
      if (spec.append === true && !complete) return null
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
