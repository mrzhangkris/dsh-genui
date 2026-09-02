// Panel incremental append: mergePanelSpecs rules (tab-label merge / tail
// append) and the settled-fence append behavior (complete bodies merge once,
// incomplete/partial bodies never merge, non-append replaces).
import { act, cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { renderGenuiFence } from '../src/client/index.tsx'
import { applyPanelOperation, clearSessionPanel, getPanelSpec, mergePanelSpecs } from '../src/client/panel-store.ts'

afterEach(() => {
  cleanup()
  clearSessionPanel('p1')
  // panel persistence writes localStorage — wipe it so a reused session id
  // never hydrates stale storage from an earlier test.
  localStorage.clear()
})

const text = (content: string) => ({ type: 'text', content })

const tabsSpec = (tabs: Array<{ label: string; items: unknown[] }>) => ({
  title: 'T',
  items: [{ type: 'tabs', tabs }],
})

/** Host-style settled fence context: message seq + block/fence indices. */
const ctx = (seq: number, block = 0, fence = 0) => ({
  sessionId: 'p1',
  source: { id: JSON.stringify(['assistant', seq, block, fence]), order: [seq, block, fence] as const },
})

describe('mergePanelSpecs', () => {
  it('merges tabs by label, appending items to same-labelled tabs', () => {
    const prev = tabsSpec([{ label: 'A', items: [text('a1')] }, { label: 'B', items: [text('b1')] }])
    const next = tabsSpec([{ label: 'B', items: [text('b2')] }, { label: 'C', items: [text('c1')] }])
    const merged = mergePanelSpecs(prev as never, next as never)
    const tabs = (merged.items[0] as { tabs: Array<{ label: string; items: unknown[] }> }).tabs
    expect(tabs.map(t => t.label)).toEqual(['A', 'B', 'C'])
    expect(tabs[0]!.items).toEqual([text('a1')])
    expect(tabs[1]!.items).toEqual([text('b1'), text('b2')])
    expect(tabs[2]!.items).toEqual([text('c1')])
  })

  it('appends plain item lists to the tail', () => {
    const prev = { title: 'P', items: [text('x')] }
    const merged = mergePanelSpecs(prev, { title: 'Q', items: [text('y'), text('z')] })
    expect(merged.title).toBe('P') // previous title wins
    expect(merged.items).toEqual([text('x'), text('y'), text('z')])
  })

  it('returns next as-is when there is no previous panel', () => {
    const next = { title: 'N', items: [text('n')] }
    expect(mergePanelSpecs(null, next)).toBe(next)
  })
})

describe('panel append fence (settled source)', () => {
  it('merges a complete append fence into the existing panel', () => {
    applyPanelOperation('p1', { sourceId: 'seed', order: [0, -1, 0], mode: 'replace', spec: tabsSpec([{ label: 'A', items: [text('a1')] }]) })
    render(renderGenuiFence(JSON.stringify({ panel: true, append: true, title: 'X', items: [{ type: 'tabs', tabs: [{ label: 'A', items: [text('a2')] }, { label: 'B', items: [text('b1')] }] }] }), 'k1', ctx(1)) as never)
    const spec = getPanelSpec('p1')!
    const tabs = (spec.items[0] as { tabs: Array<{ label: string; items: unknown[] }> }).tabs
    expect(tabs.map(t => t.label)).toEqual(['A', 'B'])
    expect(tabs[0]!.items).toHaveLength(2)
    expect(tabs[1]!.items).toHaveLength(1)
  })

  it('never merges an incomplete append body (streaming partial)', () => {
    applyPanelOperation('p1', { sourceId: 'seed', order: [0, -1, 0], mode: 'replace', spec: tabsSpec([{ label: 'A', items: [text('a1')] }]) })
    // Truncated JSON: parse-partial yields a partial spec, but the append
    // gate (complete JSON) must reject it — no partial merge.
    const partial = JSON.stringify({ panel: true, append: true, items: [{ type: 'tabs', tabs: [{ label: 'B', items: [{ type: 'text', content: 'b' }] }] }] }).slice(0, -5)
    render(renderGenuiFence(partial, 'k2', ctx(1)) as never)
    const spec = getPanelSpec('p1')!
    const tabs = (spec.items[0] as { tabs: Array<{ label: string }> }).tabs
    expect(tabs.map(t => t.label)).toEqual(['A'])
  })

  it('publishes an append whose only defect is a repairable trailing comma', () => {
    // The whole-body gate used to test isCompleteJson(RAW), which is false
    // for a trailing-comma body — the append was silently dropped even though
    // the repair pipeline had resolved a complete spec from the full text.
    applyPanelOperation('p1', { sourceId: 'seed', order: [0, -1, 0], mode: 'replace', spec: tabsSpec([{ label: 'A', items: [text('a1')] }]) })
    const body = `${JSON.stringify({ panel: true, append: true, items: [{ type: 'tabs', tabs: [{ label: 'A', items: [text('a2')] }] }] }).slice(0, -1)},}`
    render(renderGenuiFence(body, 'k-tc', ctx(1)) as never)
    const spec = getPanelSpec('p1')!
    const tabs = (spec.items[0] as { tabs: Array<{ label: string; items: unknown[] }> }).tabs
    expect(tabs[0]!.items).toHaveLength(2) // a1 + a2 — the append merged
  })

  it('publishes an append healed from unescaped quotes inside a value', () => {
    applyPanelOperation('p1', { sourceId: 'seed', order: [0, -1, 0], mode: 'replace', spec: tabsSpec([{ label: 'A', items: [text('a1')] }]) })
    // Unescaped quote inside a string value: tier-1 heals the whole body.
    const body = '{"panel":true,"append":true,"items":[{"type":"tabs","tabs":[{"label":"A","items":[{"type":"text","content":"对"别名"的容错"}]}]}]}'
    render(renderGenuiFence(body, 'k-q', ctx(1)) as never)
    const spec = getPanelSpec('p1')!
    const tabs = (spec.items[0] as { tabs: Array<{ label: string; items: unknown[] }> }).tabs
    expect(tabs[0]!.items).toHaveLength(2)
    expect((tabs[0]!.items[1] as { content: string }).content).toBe('对"别名"的容错')
  })

  it('still refuses an append whose body is missing a closing bracket (tier-2 territory)', () => {
    applyPanelOperation('p1', { sourceId: 'seed', order: [0, -1, 0], mode: 'replace', spec: tabsSpec([{ label: 'A', items: [text('a1')] }]) })
    // Missing closers are indistinguishable from streaming truncation — the
    // gate stays conservative and never merges a bracket-completed body.
    const body = JSON.stringify({ panel: true, append: true, items: [{ type: 'tabs', tabs: [{ label: 'A', items: [text('a2')] }] }] }).slice(0, -2)
    render(renderGenuiFence(body, 'k-br', ctx(1)) as never)
    const spec = getPanelSpec('p1')!
    const tabs = (spec.items[0] as { tabs: Array<{ label: string; items: unknown[] }> }).tabs
    expect(tabs[0]!.items).toHaveLength(1) // unchanged — append not merged
  })

  it('merges a completed append fence exactly once per source (renderer re-invokes)', () => {
    applyPanelOperation('p1', { sourceId: 'seed', order: [0, -1, 0], mode: 'replace', spec: tabsSpec([{ label: 'A', items: [text('a1')] }]) })
    const body = JSON.stringify({ panel: true, append: true, items: [{ type: 'tabs', tabs: [{ label: 'B', items: [text('b1')] }] }] })
    // The same settled fence (same source) is re-invoked on settle/re-render.
    render(renderGenuiFence(body, 'same-key', ctx(1)) as never)
    render(renderGenuiFence(body, 'same-key', ctx(1)) as never)
    render(renderGenuiFence(body, 'same-key', ctx(1)) as never)
    const spec = getPanelSpec('p1')!
    const tabs = (spec.items[0] as { tabs: Array<{ label: string; items: unknown[] }> }).tabs
    expect(tabs.map(t => t.label)).toEqual(['A', 'B'])
    expect(tabs[1]!.items).toHaveLength(1) // merged once, not three times
    // A DIFFERENT source (new message) with new content merges again.
    render(renderGenuiFence(JSON.stringify({ panel: true, append: true, items: [{ type: 'tabs', tabs: [{ label: 'B', items: [text('b2')] }, { label: 'C', items: [text('c1')] }] }] }), 'new-key', ctx(2)) as never)
    const spec2 = getPanelSpec('p1')!
    const tabs2 = (spec2.items[0] as { tabs: Array<{ label: string; items: unknown[] }> }).tabs
    expect(tabs2.map(t => t.label)).toEqual(['A', 'B', 'C'])
    expect(tabs2[1]!.items).toHaveLength(2) // b1 + b2
  })

  it('non-append panel fence still replaces the whole panel', () => {
    applyPanelOperation('p1', { sourceId: 'seed', order: [0, -1, 0], mode: 'replace', spec: tabsSpec([{ label: 'A', items: [text('a1')] }]) })
    render(renderGenuiFence(JSON.stringify({ panel: true, title: 'R', items: [text('fresh')] }), 'k3', ctx(3)) as never)
    const spec = getPanelSpec('p1')!
    expect(spec.title).toBe('R')
    expect(spec.items).toEqual([text('fresh')])
  })
})
