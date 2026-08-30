/**
 * Interaction-state store: durable per-block GenUI interaction state
 * (radio answers, submit lock, input/textarea values) in localStorage.
 *
 * LOCAL-FIRST persistence: a ```dsh-ui block's interactive state survives
 * page refresh and session reopen because it is keyed by
 * `session + block slot + content fingerprint` — replaying the same message
 * (same content) restores the exact state, while NEW content (换题, edited
 * spec) gets a fresh key and thus a clean slate. Different messages never
 * share state because their content fingerprints differ.
 *
 * Bounded: at most MAX_BLOCKS entries, LRU-evicted on write; each block's
 * payload is small (answers map + a few field values).
 * @module @omdsh-dev/dsh-genui/client/interaction-store
 */

import type { QuestionMeta } from './blocks/state.ts'

/** Durable state of one UI block. */
export interface BlockInteractionState {
  /** group → chosen option label (radio aggregation answers). */
  answers?: Record<string, string>
  /** True after a local grading: the paper stays graded across refresh. */
  locked?: boolean
  /** field id → current value (input/textarea with an `id`). */
  fields?: Record<string, string>
  /**
   * group → question metadata registered by grouped radios (label/options/
   * answer/explanation). Persisted TOGETHER WITH `locked`: a submitted
   * paper restored without its grading data could only render a meaningless
   * "0 / 0" score, so the submit view needs the meta to redraw the grade.
   */
  meta?: Record<string, QuestionMeta>
}

const STORE_KEY = 'dsh.genui.interaction'
/** Max tracked blocks; LRU eviction keeps the store bounded. */
const MAX_BLOCKS = 200

interface StoreShape {
  /** Block keys in most-recently-written order (index 0 = newest). */
  order: string[]
  blocks: Record<string, BlockInteractionState>
}

function emptyStore(): StoreShape {
  return { order: [], blocks: {} }
}

function readStore(): StoreShape {
  try {
    const raw = localStorage.getItem(STORE_KEY)
    if (raw === null) return emptyStore()
    const parsed = JSON.parse(raw) as Partial<StoreShape>
    if (!Array.isArray(parsed.order) || typeof parsed.blocks !== 'object' || parsed.blocks === null) {
      return emptyStore()
    }
    return { order: parsed.order.filter(k => typeof k === 'string'), blocks: parsed.blocks as Record<string, BlockInteractionState> }
  } catch {
    return emptyStore()
  }
}

function writeStore(store: StoreShape): void {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(store))
  } catch {
    // Quota / privacy-mode failures are non-fatal: interaction stays live
    // in memory, only the persistence is lost.
  }
}

/** Load a block's durable state, or null when absent/corrupt. */
export function loadBlockState(stateKey: string): BlockInteractionState | null {
  if (stateKey === '') return null
  const store = readStore()
  return store.blocks[stateKey] ?? null
}

/** Save a block's durable state (LRU: touched keys move to the front). */
export function saveBlockState(stateKey: string, state: BlockInteractionState): void {
  if (stateKey === '') return
  const store = readStore()
  const order = store.order.filter(k => k !== stateKey)
  order.unshift(stateKey)
  const blocks = { ...store.blocks, [stateKey]: state }
  while (order.length > MAX_BLOCKS) {
    const evicted = order.pop()
    if (evicted !== undefined) delete blocks[evicted]
  }
  writeStore({ order, blocks })
}

/** Forget a block's durable state (e.g. after a reset-to-empty). */
export function clearBlockState(stateKey: string): void {
  if (stateKey === '') return
  const store = readStore()
  if (!(stateKey in store.blocks)) return
  const blocks = { ...store.blocks }
  delete blocks[stateKey]
  writeStore({ order: store.order.filter(k => k !== stateKey), blocks })
}

/**
 * Deterministic content fingerprint (cyrb53, 53-bit) for a block's raw
 * fence body. Two render passes of the SAME content share a fingerprint
 * (state restores); edited content gets a new one (fresh state). Not a
 * security hash — the store only uses it for equality/identity.
 *
 * cyrb53 (two intertwined 32-bit lanes, avalanche-mixed) replaced the
 * original 32-bit djb2: whole fence bodies differing in ONE data cell
 * could collide in 32 bits (see the regression pair in
 * genui-durable-state.spec.tsx), silently cross-wiring durable state
 * between blocks. Pure, synchronous, dependency-free; same input always
 * maps to the same string (base-36, ~10 chars — key length is fine).
 */
export function fingerprint(raw: string): string {
  let h1 = 0xdeadbeef
  let h2 = 0x41c6ce57
  for (let i = 0; i < raw.length; i++) {
    const ch = raw.charCodeAt(i)
    h1 = Math.imul(h1 ^ ch, 2654435761)
    h2 = Math.imul(h2 ^ ch, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36)
}

/** Build the durable state key for a fence block: session + fence slot + content fingerprint. */
export function fenceStateKey(sessionId: string, fenceKey: number | string, raw: string): string {
  return `f:${sessionId}:${String(fenceKey)}:${fingerprint(raw)}`
}

/** Build the durable state key for a panel publish (content-keyed). */
export function panelStateKey(sessionId: string, raw: string): string {
  return `p:${sessionId}:${fingerprint(raw)}`
}

/** Build the durable state key for a render_ui tool card (call-keyed). */
export function toolStateKey(sessionId: string, callId: string): string {
  return `t:${sessionId}:${callId}`
}
