/**
 * GenuiBlock: renders a declarative GenUI spec (from a ```dsh-ui fence in an
 * assistant reply) as real interactive components inline in the conversation.
 * The component tree is white-listed and mapped to DOM directly — no raw HTML.
 * The block shell holds the shared interaction state (answers registry,
 * durable localStorage persistence, action debounce); the per-family
 * components live in src/client/blocks/*.
 */
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useGenuiAction } from './action-context.ts'
import css from './GenuiBlock.module.css'
import { loadBlockState, saveBlockState, type BlockInteractionState } from './interaction-store.ts'
import { renderNode } from './blocks/render-node.tsx'
import type { AnswersState, GenuiBlockProps, QuestionMeta } from './blocks/state.ts'
import type { GenuiSpec } from './spec.ts'

export const GENUI_ACTION_DEBOUNCE_MS = 300

/**
 * Wrap the harness action callback with the per-action trailing debounce.
 * Absent provider = v1 behavior (components are display-only, callback
 * stays undefined). Pending timers are cleared on unmount so a click that
 * never fired does not leak into the next mount.
 */
function useDebouncedAction(onAction: GenuiBlockProps['onAction'] | undefined): GenuiBlockProps['onAction'] {
  const pending = useRef<Map<string, ReturnType<typeof setTimeout>> | null>(null)
  useEffect(() => {
    return () => {
      const timers = pending.current
      if (timers === null) return
      for (const timer of timers.values()) clearTimeout(timer)
      timers.clear()
    }
  }, [])
  return useMemo(() => {
    if (onAction === undefined) return undefined
    const timers = new Map<string, ReturnType<typeof setTimeout>>()
    pending.current = timers
    return (action: string, payload: Record<string, unknown>): void => {
      const existing = timers.get(action)
      if (existing !== undefined) clearTimeout(existing)
      timers.set(action, setTimeout(() => {
        timers.delete(action)
        onAction(action, payload)
      }, GENUI_ACTION_DEBOUNCE_MS))
    }
  }, [onAction])
}

/**
 * Structural spec equality for the memo comparator: the fence path re-parses
 * the body on every streaming chunk and produces a FRESH object even when the
 * repaired content is unchanged (a chunk that closed no new component). The
 * default shallow memo would then re-render the whole tree per chunk — up to
 * ~200 full-tree renders for a max-size fence. Stringify equality makes the
 * memo skip renders whose content did not actually change; the cost is one
 * JSON.stringify per chunk (≤200 nodes, negligible next to a React tree
 * reconciliation). `stateKey` already embeds the content fingerprint, so when
 * both keys are equal and non-undefined the specs necessarily stringify
 * equal — the stringify branch matters for the streaming path (stateKey
 * undefined).
 */
function specEquivalent(a: GenuiSpec, b: GenuiSpec): boolean {
  if (a === b) return true
  return JSON.stringify(a) === JSON.stringify(b)
}

/** Durable payload for the current state snapshot: secret field values are
 * stripped before writing — passwords never persist. Shared by the debounced
 * save and the unmount/key-change flush so both write the exact same shape. */
function persistedStateOf(
  answers: Record<string, string>,
  locked: boolean,
  fields: Record<string, string>,
  secretFields: ReadonlySet<string>,
  meta: Record<string, QuestionMeta>,
): BlockInteractionState {
  const safeFields = Object.fromEntries(
    Object.entries(fields).filter(([id]) => !secretFields.has(id)),
  )
  return {
    answers,
    locked,
    ...(Object.keys(safeFields).length > 0 ? { fields: safeFields } : {}),
    // Grading metadata rides along: without it a restored submitted paper can
    // only render the hollow "0 / 0" score.
    ...(Object.keys(meta).length > 0 ? { meta } : {}),
  }
}

/**
 * Render a GenUI spec as an inline block. Falls back to nothing when the spec
 * carries no items (the fence renderer already refused non-specs before us).
 */
/** Warnings equivalence for the memo comparator: resolveGenuiSpecDetailed
 * produces a FRESH array per render even when the content is unchanged (the
 * streaming path re-runs per chunk), so identity comparison would defeat the
 * memo — compare contents instead. */
function warningsEquivalent(a: string[] | undefined, b: string[] | undefined): boolean {
  if (a === b) return true
  if (a === undefined || b === undefined) return false
  return a.length === b.length && a.every((w, i) => w === b[i])
}

export const GenuiBlock = memo(function GenuiBlock({ spec, stateKey, fallbackStateKey, warnings }: GenuiBlockProps) {
  const gap = spec.gap ?? 16
  const onAction = useDebouncedAction(useGenuiAction())
  // v2.5/v2.6 answers registry: grouped radios record selections + question
  // metadata here; `submit` nodes grade locally (locked until 重新作答) or
  // collect into one action. Block-local state survives re-renders (streaming
  // settle, panel updates) — selections persist while the block is mounted.
  // v2.7 durability: with a stateKey the state ALSO survives refresh/reopen —
  // loaded once at mount (seed for re-renders of the same content) and saved
  // on every change.
  // v2.9 streaming→settled migration: the settle transition remounts the
  // block under a NEW durable key (settled source id) while the user's
  // mid-stream answers live under the streaming-era key — consult the
  // fallback once and re-save under the primary so the answers carry over.
  // The initializer is idempotent (StrictMode double-invocation re-reads and
  // re-writes the same data), so the save inside is safe.
  const [persisted] = useState(() => {
    if (stateKey === undefined) return null
    const own = loadBlockState(stateKey)
    if (own !== null) return own
    if (fallbackStateKey === undefined || fallbackStateKey === stateKey) return null
    const prior = loadBlockState(fallbackStateKey)
    if (prior === null) return null
    saveBlockState(stateKey, prior)
    return prior
  })
  const [answers, setAnswers] = useState<Record<string, string>>(persisted?.answers ?? {})
  const [fields, setFields] = useState<Record<string, string>>(persisted?.fields ?? {})
  // Grading metadata restores with the rest of the durable state: a locked
  // (submitted) paper without its meta could only show a hollow "0 / 0".
  const [meta, setMeta] = useState<Record<string, QuestionMeta>>(persisted?.meta ?? {})
  const [locked, setLocked] = useState(persisted?.locked === true)
  const [round, setRound] = useState(0)
  // Secret (password) field ids: their values never persist and never join
  // submit collection — the input itself stays masked and its own action
  // still delivers the value on explicit user submit.
  const [secretFields, setSecretFields] = useState<ReadonlySet<string>>(new Set())
  const setAnswer = useCallback((group: string, choice: string) => {
    setAnswers(prev => (prev[group] === choice ? prev : { ...prev, [group]: choice }))
  }, [])
  const setField = useCallback((id: string, value: string) => {
    // Field invariant: a blank (trim-empty) value leaves the shared registry.
    setFields(prev => {
      if (value.trim() === '') {
        if (!(id in prev)) return prev
        const next = { ...prev }
        delete next[id]
        return next
      }
      return prev[id] === value ? prev : { ...prev, [id]: value }
    })
  }, [])
  const registerSecretField = useCallback((id: string) => {
    setSecretFields(prev => (prev.has(id) ? prev : new Set(prev).add(id)))
  }, [])
  const registerMeta = useCallback((group: string, m: QuestionMeta) => {
    setMeta(prev => {
      const existing = prev[group]
      if (existing !== undefined && existing.label === m.label && existing.answer === m.answer
        && existing.explanation === m.explanation) return prev
      return { ...prev, [group]: m }
    })
  }, [])
  const clear = useCallback(() => {
    setAnswers({})
    setLocked(false)
    setRound(r => r + 1) // radios remount (key carries the round) with clean selections
  }, [])
  const answersState = useMemo<AnswersState>(
    () => ({
      answers, fields, secretFields, meta, locked, round,
      setAnswer, setField, registerSecretField, registerMeta, clear, setLocked,
    }),
    [answers, fields, secretFields, meta, locked, round, setAnswer, setField, registerSecretField, registerMeta, clear],
  )
  // Latest interaction state for the synchronous flush below: the flush runs
  // from a cleanup closure that must see the CURRENT state, not the state
  // captured when its effect last re-ran.
  const stateRef = useRef({ answers, locked, fields, secretFields, meta })
  stateRef.current = { answers, locked, fields, secretFields, meta }
  // One save path shared by the debounced write and the unmount/key-change
  // flush — both must write the exact same shape (persistedStateOf strips
  // secret field values). Rebuilt per render; each effect captures the
  // `stateKey` of ITS OWN run, so a key change flushes under the OLD key
  // (where the streaming-era fallback migration later finds the data) before
  // the new key's debounce takes over.
  const persistNow = (): void => {
    if (stateKey === undefined) return
    const { answers: a, locked: l, fields: f, secretFields: sf, meta: m } = stateRef.current
    saveBlockState(stateKey, persistedStateOf(a, l, f, sf, m))
  }
  // Durable save (debounced 300ms — typing in a field fires per keystroke).
  useEffect(() => {
    if (stateKey === undefined) return
    const timer = setTimeout(persistNow, 300)
    return () => clearTimeout(timer)
    // persistNow is a per-render closure over stateKey/stateRef; listing it
    // would re-arm the timer every render, so only the state inputs matter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stateKey, answers, locked, fields, secretFields, meta])
  // Flush on unmount and on durable-key change: the 300ms debounce used to be
  // simply cancelled, so the LAST interaction inside the window (an answer
  // clicked right before the streaming→settled remount, or a page refresh)
  // was never written — the user's click vanished.
  useEffect(() => {
    if (stateKey === undefined) return
    return () => { persistNow() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stateKey])
  return (
    <div className={css.block} data-genui>
      {spec.title !== undefined && <div className={css.banner}>{spec.title}</div>}
      {warnings !== undefined && warnings.length > 0 && (
        <div className={css.specWarnings} role="note">
          <span className={css.specWarningsTitle}>⚠️ 界面规格有 {warnings.length} 处需要修正</span>
          <ul className={css.specWarningsList}>
            {warnings.map((w, i) => <li key={i}>{w}</li>)}
          </ul>
        </div>
      )}
      <div className={css.col} style={{ gap: `${gap}px` }}>
        {spec.items.map((c, i) => (
          // Staggered reveal: each root item fades/slides in after its
          // predecessors, so the block assembles piece by piece instead of
          // popping in as one slab. Delay capped so long specs still settle
          // quickly; prefers-reduced-motion disables it (see CSS).
          <div
            key={i}
            className={css.reveal}
            style={{ animationDelay: `${Math.min(i * 90, 720)}ms` }}
          >
            {renderNode(c, i, onAction, 0, answersState)}
          </div>
        ))}
      </div>
    </div>
  )
}, (prev, next) => prev.stateKey === next.stateKey
  && prev.fallbackStateKey === next.fallbackStateKey
  && warningsEquivalent(prev.warnings, next.warnings)
  && specEquivalent(prev.spec, next.spec))
