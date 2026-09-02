// GenUI spec guard: resource limits, deterministic repair, and validation.
// Pure node tests — no DOM. The fence path runs every body through
// `repairGenuiSpec` before rendering, so these invariants protect the UI.
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { GENUI_LIMITS, GENUI_NODE_TYPES, countDeclaredGenuiNodes, countGenuiNodes, repairGenuiSpec, validateGenuiSpec, type GenuiRepairDiagnostic } from '../src/client/guard.ts'
import { type GenuiNode, type GenuiList, isGenuiSpec, parseGenuiSpec } from '../src/client/spec.ts'

const text = (content: string) => ({ type: 'text', content })

describe('repairGenuiSpec: root shape', () => {
  it('returns null for non-object roots', () => {
    expect(repairGenuiSpec(null)).toBeNull()
    expect(repairGenuiSpec('x')).toBeNull()
    expect(repairGenuiSpec([])).toBeNull()
    expect(repairGenuiSpec(42)).toBeNull()
  })

  it('returns null when items is not an array', () => {
    expect(repairGenuiSpec({ title: 'x' })).toBeNull()
    expect(repairGenuiSpec({ items: 'nope' })).toBeNull()
    expect(repairGenuiSpec({ items: {} })).toBeNull()
  })

  it('keeps title and clamps gap', () => {
    const spec = repairGenuiSpec({ title: 'T', gap: 200, items: [text('a')] })
    expect(spec?.title).toBe('T')
    expect(spec?.gap).toBe(96)
    const spec2 = repairGenuiSpec({ gap: -10, items: [] })
    expect(spec2?.gap).toBe(0)
  })

  it('produces a valid GenuiSpec for a valid input (idempotent)', () => {
    const input = {
      title: 't', gap: 12, items: [
        text('hi'), { type: 'stat', label: 'L', value: '1', delta: '+2%' },
      ],
    }
    const once = repairGenuiSpec(input)
    const twice = repairGenuiSpec(once)
    expect(once).not.toBeNull()
    expect(twice).toEqual(once)
    expect(isGenuiSpec(once)).toBe(true)
  })
})

describe('repairGenuiSpec: single-component roots', () => {
  it('wraps a bare component root into a col (documented fence vocabulary)', () => {
    const spec = repairGenuiSpec({ type: 'callout', tone: 'info', title: '核心观察', content: '你好' })
    expect(spec).not.toBeNull()
    // The repaired GenuiSpec carries no `type` (root spec field set) — the
    // observable wrap effect is the items array holding the bare component.
    expect(spec?.items).toHaveLength(1)
    expect((spec?.items[0] as { type: string }).type).toBe('callout')
    expect(isGenuiSpec(spec)).toBe(true)
  })

  it('hoists panel/append from the bare component onto the wrapper', () => {
    const spec = repairGenuiSpec({ type: 'text', content: 'x', panel: true, append: true })
    expect(spec?.panel).toBe(true)
    expect(spec?.append).toBe(true)
    const inner = spec?.items[0] as { panel?: unknown; append?: unknown }
    expect(inner.panel).toBeUndefined()
    expect(inner.append).toBeUndefined()
  })

  it('still rejects non-component objects without an items array', () => {
    expect(repairGenuiSpec({ title: 'x' })).toBeNull()
    expect(repairGenuiSpec({ foo: 1 })).toBeNull()
  })

  it('idempotent: a wrapped single root repairs to itself', () => {
    const once = repairGenuiSpec({ type: 'stat', label: 'L', value: '1' })
    const twice = repairGenuiSpec(once)
    expect(twice).toEqual(once)
  })
})

describe('validateGenuiSpec / parseGenuiSpec: single-component roots', () => {
  it('accepts a bare component as valid', () => {
    const result = validateGenuiSpec({ type: 'callout', tone: 'info', title: 'T', content: 'c' })
    expect(result.ok).toBe(true)
  })

  it('parseGenuiSpec wraps a single-component fence body', () => {
    const spec = parseGenuiSpec(JSON.stringify({ type: 'keyvalue', pairs: [{ key: 'a', value: 'b' }] }))
    expect(spec?.type).toBe('col')
    expect((spec?.items[0] as { type: string }).type).toBe('keyvalue')
  })

  it('parseGenuiSpec still rejects non-component junk', () => {
    expect(parseGenuiSpec('{"foo":1}')).toBeNull()
    expect(parseGenuiSpec('not json')).toBeNull()
  })
})

describe('repairGenuiSpec: node-level healing', () => {
  it('drops nodes with missing required fields', () => {
    const spec = repairGenuiSpec({ items: [
      { type: 'text' }, // no content
      { type: 'button' }, // no label
      { type: 'table', columns: ['a'] }, // no rows
      { type: 'quiz', question: 'q' }, // no options
      { type: 'audio' }, // no src
      { type: 'video' }, // no src
      text('kept'),
    ] })
    expect(spec?.items).toHaveLength(1)
    expect((spec?.items[0] as { content: string }).content).toBe('kept')
  })

  it('normalizes object-array options into strings (select/radio)', () => {
    // Models sometimes reuse ask_user_question's {label,description} shape for
    // select/radio options; the guard must extract readable text instead of
    // silently dropping every option (empty list = "options not rendered").
    const spec = repairGenuiSpec({ items: [
      { type: 'radio', label: 'Q', group: 'q', options: [
        { label: '甲方案', description: '说明' },
        { value: '乙方案' },
        { title: '丙方案' },
        { x: 1 },
      ] },
      { type: 'select', options: [{ label: '选项A' }, { label: '选项B' }] },
    ] })
    const [radio, select] = spec!.items as Array<{ options?: string[] }>
    expect(radio.options).toEqual(['甲方案', '乙方案', '丙方案', '{"x":1}'])
    expect(select.options).toEqual(['选项A', '选项B'])
  })

  it('clamps out-of-range numbers', () => {
    const spec = repairGenuiSpec({ items: [
      { type: 'progress', value: 150 },
      { type: 'progress', value: -5 },
      { type: 'grid', cols: 40, items: [] },
    ] })
    const [p1, p2, g] = spec!.items as Array<{ value?: number; cols?: number }>
    expect(p1.value).toBe(100)
    expect(p2.value).toBe(0)
    expect(g.cols).toBe(GENUI_LIMITS.maxGridCols)
  })

  it('clamps non-integer grid cols', () => {
    const spec = repairGenuiSpec({ items: [{ type: 'grid', cols: 3.7, items: [] }] })
    expect((spec!.items[0] as { cols: number }).cols).toBe(3)
  })

  it('truncates oversized strings', () => {
    const long = 'x'.repeat(5000)
    const spec = repairGenuiSpec({ items: [text(long)] })
    expect((spec!.items[0] as { content: string }).content).toHaveLength(GENUI_LIMITS.maxString)
  })

  it('keeps same-origin link paths; rejects schemes and protocol-relative hrefs', () => {
    const spec = repairGenuiSpec({ items: [
      { type: 'link', label: 'docs', href: '/docs' },
      { type: 'link', label: 'query', href: '/api/file?id=1#frag' },
      { type: 'link', label: 'mail', href: 'mailto:a@b.example' },
      { type: 'link', label: 'web', href: 'https://example.com/x' },
      { type: 'link', label: 'js', href: 'javascript:alert(1)' },
      { type: 'link', label: 'data', href: 'data:text/html,<b>x</b>' },
      { type: 'link', label: 'tel', href: 'tel:+1234' },
      { type: 'link', label: 'proto-rel', href: '//evil.example/x' },
      { type: 'link', label: 'proto-rel-bs', href: '/\\evil.example/x' },
      { type: 'link', label: 'relative', href: 'docs/relative' },
      { type: 'link', label: 'anchor', href: '#section' },
    ] })
    expect(spec?.items).toEqual([
      { type: 'link', label: 'docs', href: '/docs' },
      { type: 'link', label: 'query', href: '/api/file?id=1#frag' },
      { type: 'link', label: 'mail', href: 'mailto:a@b.example' },
      { type: 'link', label: 'web', href: 'https://example.com/x' },
      // Everything below degrades to a href-less link node (plain text).
      { type: 'link', label: 'js' },
      { type: 'link', label: 'data' },
      { type: 'link', label: 'tel' },
      { type: 'link', label: 'proto-rel' },
      { type: 'link', label: 'proto-rel-bs' },
      { type: 'link', label: 'relative' },
      { type: 'link', label: 'anchor' },
    ])
  })

  it('keeps safe media URLs and rejects active or local schemes', () => {
    const spec = repairGenuiSpec({ items: [
      { type: 'audio', src: '/mmx-files/a.mp3', alt: 'A', loop: true },
      { type: 'video', src: 'https://cdn.example.com/b.mp4', poster: '/b.jpg', aspectRatio: '4:3', muted: true },
      { type: 'audio', src: 'javascript:alert(1)' },
      { type: 'video', src: 'file:///tmp/private.mp4' },
      { type: 'video', src: '//example.com/protocol-relative.mp4' },
    ] })
    expect(spec?.items).toEqual([
      { type: 'audio', src: '/mmx-files/a.mp3', alt: 'A', loop: true },
      { type: 'video', src: 'https://cdn.example.com/b.mp4', poster: '/b.jpg', muted: true, aspectRatio: '4:3' },
    ])
  })

  it('truncates oversized code and mermaid bodies', () => {
    const spec = repairGenuiSpec({ items: [
      { type: 'code', code: 'x'.repeat(GENUI_LIMITS.maxCode + 100) },
      { type: 'mermaid', code: 'y'.repeat(GENUI_LIMITS.maxMermaid + 100) },
    ] })
    expect((spec!.items[0] as { code: string }).code).toHaveLength(GENUI_LIMITS.maxCode)
    expect((spec!.items[1] as { code: string }).code).toHaveLength(GENUI_LIMITS.maxMermaid)
  })

  it('caps array-backed nodes (tabs, meshes, options, rows)', () => {
    const many = (n: number) => Array.from({ length: n }, (_, i) => ({ label: `t${i}`, items: [] }))
    const spec = repairGenuiSpec({ items: [
      { type: 'tabs', tabs: many(30) },
      { type: 'scene3d', meshes: Array.from({ length: 20 }, () => ({ shape: 'box' as const })) },
      { type: 'select', options: Array.from({ length: 80 }, (_, i) => `o${i}`) },
      { type: 'table', columns: ['a'], rows: Array.from({ length: 80 }, () => ['x']) },
    ] })
    const [tabs, scene, select, table] = spec!.items as Array<{ tabs?: unknown[]; meshes?: unknown[]; options?: string[]; rows?: unknown[] }>
    expect(tabs.tabs).toHaveLength(GENUI_LIMITS.maxTabs)
    expect(scene.meshes).toHaveLength(GENUI_LIMITS.maxMeshes)
    expect(select.options).toHaveLength(GENUI_LIMITS.maxOptions)
    expect(table.rows).toHaveLength(GENUI_LIMITS.maxTableRows)
  })

  it('caps total node count', () => {
    const spec = repairGenuiSpec({ items: Array.from({ length: 500 }, (_, i) => text(`n${i}`)) })
    expect(spec!.items).toHaveLength(GENUI_LIMITS.maxNodes)
  })

  it('caps nesting depth', () => {
    let node: unknown = text('leaf')
    for (let i = 0; i < 30; i++) node = { type: 'col', items: [node] }
    const spec = repairGenuiSpec({ items: [node] })
    let cur: unknown = spec!.items[0]
    let depth = 0
    while (cur !== undefined && typeof cur === 'object') {
      const items = (cur as { items?: unknown[] }).items
      cur = items?.[0]
      depth += 1
    }
    // Root col at depth 0 … deepest kept node at depth maxDepth, one more dropped.
    expect(depth).toBe(GENUI_LIMITS.maxDepth + 1)
  })

  it('drops invalid chart without data or series but keeps series-only charts', () => {
    const spec = repairGenuiSpec({ items: [
      { type: 'chart' },
      { type: 'chart', series: [{ label: 's', data: [{ label: 'a', value: 1 }] }] },
    ] })
    expect(spec!.items).toHaveLength(1)
    expect((spec!.items[0] as { type: string }).type).toBe('chart')
  })

  it('passes unknown node types through untouched (custom components)', () => {
    const custom = { type: 'my-widget', flavor: 'pink', data: { a: [1, 2] } }
    const spec = repairGenuiSpec({ items: [custom] })
    expect(spec!.items).toHaveLength(1)
    expect(spec!.items[0]).toEqual(custom)
  })

  it('strips __proto__/constructor/prototype from custom nodes (clone, never reference)', () => {
    // JSON.parse creates an OWN enumerable `__proto__` data property — the
    // exact shape a hostile fence body produces. Handing the raw node to the
    // renderer (or any downstream spread) would pollute Object.prototype.
    const raw = JSON.parse('{"type":"my-widget","flavor":"pink","__proto__":{"polluted":true},"constructor":{"c":1},"prototype":{"p":2},"data":{"ok":1,"__proto__":{"deep":true}}}')
    const spec = repairGenuiSpec({ items: [raw] })
    expect(spec?.items).toHaveLength(1)
    const node = spec!.items[0] as Record<string, unknown>
    expect(node).not.toBe(raw) // pass-through is a clone, not the original reference
    expect(node.flavor).toBe('pink') // legit fields survive
    expect(Object.keys(node)).toEqual(['type', 'flavor', 'data']) // dangerous keys stripped…
    expect(Object.keys(node.data as object)).toEqual(['ok']) // …at every level
    expect(Object.hasOwn(node, '__proto__')).toBe(false)
    expect(Object.hasOwn(node, 'constructor')).toBe(false)
    expect(Object.hasOwn(node, 'prototype')).toBe(false)
    expect(({} as Record<string, unknown>).polluted).toBeUndefined() // no prototype pollution
  })

  it('cuts over-deep content inside custom nodes (shared maxDepth budget)', () => {
    let deep: unknown = { leaf: true }
    for (let i = 0; i < 30; i++) deep = { child: deep }
    const spec = repairGenuiSpec({ items: [{ type: 'my-widget', payload: deep }] })
    expect(spec?.items).toHaveLength(1)
    let cur: unknown = (spec!.items[0] as Record<string, unknown>).payload
    let depth = 0
    while (cur !== null && typeof cur === 'object') {
      cur = (cur as Record<string, unknown>).child
      depth += 1
    }
    // The custom node itself sits at depth 0; its payload chain is cut so the
    // deepest kept object is at maxDepth and everything below collapses to null.
    expect(depth).toBe(GENUI_LIMITS.maxDepth)
    expect(cur).toBeNull()
  })

  it('sanitizes raw scalars inside collections', () => {
    const spec = repairGenuiSpec({ items: [
      { type: 'list', items: ['ok', 42, { title: 't' }, null] },
      { type: 'keyvalue', pairs: [{ key: 'k', value: 'v' }, { key: 1, value: 'x' }] },
    ] })
    const [list] = spec!.items as Array<{ items?: Array<string | { title: string }>; pairs?: Array<{ key: string; value: string }> }>
    expect(list.items).toEqual(['ok', { title: 't' }])
    const [kv] = spec!.items.slice(1) as Array<{ pairs: Array<{ key: string; value: string }> }>
    expect(kv.pairs).toEqual([{ key: 'k', value: 'v' }])
  })
})

describe('repairGenuiSpec: table / tabs tolerance (issue #42)', () => {
  it('flattens object columns and object-array rows (data alias) into a real table', () => {
    const spec = repairGenuiSpec({ items: [
      { type: 'table',
        columns: [{ title: '名称', key: 'name' }, { title: '数量', dataIndex: 'count' }],
        data: [
          { name: '苹果', count: 3, extra: 'x' },
          { name: '梨', count: null },
        ] },
    ] })
    const table = spec?.items[0] as { columns: string[], rows: Array<Array<string | number>> }
    expect(table.columns).toEqual(['名称', '数量'])
    expect(table.rows).toEqual([['苹果', 3], ['梨', '']])
  })

  it('keys object rows by the first row when columns are plain strings', () => {
    const spec = repairGenuiSpec({ items: [
      { type: 'table', columns: ['a', 'b'], rows: [{ a: 1, b: 'two' }] },
    ] })
    const table = spec?.items[0] as { rows: Array<Array<string | number>> }
    expect(table.rows).toEqual([[1, 'two']])
  })

  it('accepts tabs[].content as an items alias (array or single component)', () => {
    const spec = repairGenuiSpec({ items: [
      { type: 'tabs', tabs: [
        { label: '一', content: [{ type: 'text', content: 'a' }, { type: 'badge', label: 'b' }] },
        { label: '二', content: { type: 'text', content: 'c' } },
      ] },
    ] })
    const tabs = spec?.items[0] as { tabs: Array<{ label: string, items: unknown[] }> }
    expect(tabs.tabs[0]?.items).toHaveLength(2)
    expect(tabs.tabs[1]?.items).toHaveLength(1)
  })
})

describe('node counting: container descent + declared nodes (issue #42)', () => {
  it('countGenuiNodes descends into row / col / grid / card containers', () => {
    const tree = { items: [
      { type: 'row', items: [{ type: 'col', items: [text('a'), text('b')] }] },
      { type: 'grid', cols: 2, items: [text('c')] },
      { type: 'card', title: 'k', items: [text('d')] },
    ] }
    expect(countGenuiNodes(tree)).toBe(8)
  })

  it('countDeclaredGenuiNodes walks the same containers and skips non-node "type" strings', () => {
    const tree = { items: [
      { type: 'row', items: [text('a')] },
      { type: 'file-tree', items: [
        { name: 'src', type: 'dir', children: [{ name: 'i.ts', type: 'file' }] },
      ] },
    ] }
    // row + text + the file-tree node itself; the dir/file children are not
    // GenUI nodes and must not count.
    expect(countDeclaredGenuiNodes(tree)).toBe(3)
  })

  it('countDeclaredGenuiNodes counts a single-component root', () => {
    expect(countDeclaredGenuiNodes({ type: 'callout', content: 'x' })).toBe(1)
  })
})

describe('repairGenuiSpec: list nodes', () => {
  it('keeps row/text/badge children inside a list', () => {
    const spec = repairGenuiSpec({
      items: [
        {
          type: 'list',
          items: [
            'src',
            {
              type: 'row',
              items: [
                { type: 'text', text: 'app.ts' },
                { type: 'badge', text: 'TS' },
                { type: 'badge', value: '42 lines' },
              ],
            },
          ],
        },
      ],
    })
    const [list] = spec!.items as Array<{ items: GenuiList['items'] }>
    expect(list.items).toHaveLength(2)
    expect(list.items[0]).toBe('src')
    const row = list.items[1] as GenuiNode & { items: GenuiNode[] }
    expect(row.type).toBe('row')
    expect(row.items.map(item => item.type)).toEqual(['text', 'badge', 'badge'])
    expect(row.items[0]).toMatchObject({ type: 'text', content: 'app.ts' })
    expect(row.items[1]).toMatchObject({ type: 'badge', label: 'TS' })
    expect(row.items[2]).toMatchObject({ type: 'badge', label: '42 lines' })
  })

  it('keeps valid entries while dropping invalid typed list nodes', () => {
    const spec = repairGenuiSpec({
      items: [
        {
          type: 'list',
          items: [
            'plain',
            { type: 'row', items: [{ type: 'text', content: 'keep' }] },
            { type: 'text' },
            { type: 'button' },
            { type: 'badge', label: 'ok' },
          ],
        },
      ],
    })
    const [list] = spec!.items as Array<{ items: GenuiList['items'] }>
    expect(list.items).toEqual([
      'plain',
      { type: 'row', items: [{ type: 'text', content: 'keep' }] },
      { type: 'badge', label: 'ok' },
    ])
  })

  it('charges typed list children against the shared node budget', () => {
    const badges = (n: number) => Array.from({ length: n }, (_, i) => ({ type: 'badge' as const, label: `b${i}` }))
    const spec = repairGenuiSpec({
      items: [
        { type: 'list', items: badges(50) },
        { type: 'list', items: badges(50) },
        { type: 'list', items: badges(50) },
        { type: 'list', items: badges(50) },
      ],
    })
    const lists = spec!.items as Array<{ items: Array<{ type: string; label: string }> }>
    // 3 full lists (3×50 badges) + 3 list nodes = 153 nodes; the 4th list
    // node costs 1 and fits 46 more badges before the 200-node budget cuts
    // (196 badges + 4 lists = 200 exactly). Without the deduction all 204
    // nodes would slip through.
    expect(lists[0]!.items).toHaveLength(50)
    expect(lists[1]!.items).toHaveLength(50)
    expect(lists[2]!.items).toHaveLength(50)
    expect(lists[3]!.items).toHaveLength(46)
    expect(countGenuiNodes(spec)).toBe(GENUI_LIMITS.maxNodes)
  })

  it('keeps title-objects, strings, and typed nodes interleaved in order', () => {
    const spec = repairGenuiSpec({
      items: [
        {
          type: 'list',
          items: [
            { type: 'badge', label: 'node-first' },
            { title: 'titled', desc: 'd' },
            'plain',
            { type: 'text', text: 'typed-last' },
          ],
        },
      ],
    })
    const [list] = spec!.items as Array<{ items: GenuiList['items'] }>
    expect(list.items).toEqual([
      { type: 'badge', label: 'node-first' },
      { title: 'titled', desc: 'd' },
      'plain',
      { type: 'text', content: 'typed-last' },
    ])
  })

  it('prefers the title form when an object carries both title and type', () => {
    const spec = repairGenuiSpec({
      items: [
        { type: 'list', items: [{ title: 'T', desc: 'D', type: 'badge', label: 'B' }] },
      ],
    })
    const [list] = spec!.items as Array<{ items: GenuiList['items'] }>
    expect(list.items).toEqual([{ title: 'T', desc: 'D' }])
  })

  it('countGenuiNodes includes typed list children', () => {
    const count = countGenuiNodes({
      items: [
        {
          type: 'list',
          items: [
            { type: 'badge', label: 'a' },
            { type: 'list', items: [{ type: 'text', content: 'x' }] },
            'plain',
            { title: 't' },
          ],
        },
      ],
    })
    // list + badge + nested-list + nested-text = 4; the 'plain' string and
    // {title,desc} shape are list-item entries, not nodes.
    expect(count).toBe(4)
  })
})

describe('validateGenuiSpec: diagnostics', () => {
  it('passes a well-formed spec', () => {
    const result = validateGenuiSpec({ items: [text('a'), { type: 'progress', value: 50 }] })
    expect(result.ok).toBe(true)
    expect(result.errors).toEqual([])
  })

  it('reports missing required fields with paths', () => {
    const result = validateGenuiSpec({ items: [text('a'), { type: 'button' }] })
    expect(result.ok).toBe(false)
    expect(result.errors.join('\n')).toContain('items[1]')
    expect(result.errors.join('\n')).toContain('label')
  })

  it('reports out-of-range progress and deep nesting', () => {
    let node: unknown = text('x')
    for (let i = 0; i < 20; i++) node = { type: 'card', items: [node] }
    const result = validateGenuiSpec({ items: [{ type: 'progress', value: 120 }, node] })
    expect(result.ok).toBe(false)
    expect(result.errors.join('\n')).toContain('0..100')
    expect(result.errors.join('\n')).toContain('max depth')
  })

  it('reports the node budget', () => {
    const result = validateGenuiSpec({ items: Array.from({ length: 500 }, (_, i) => text(`n${i}`)) })
    expect(result.ok).toBe(false)
    expect(result.errors.join('\n')).toContain(`${GENUI_LIMITS.maxNodes} nodes`)
  })

  it('flags unknown types as custom-renderer warnings', () => {
    const result = validateGenuiSpec({ items: [{ type: 'my-widget' }] })
    expect(result.ok).toBe(false)
    expect(result.errors.join('\n')).toContain("unknown type 'my-widget'")
  })

  it('accepts text/badge aliases the same way repair does', () => {
    const result = validateGenuiSpec({
      items: [
        {
          type: 'list',
          items: [
            { type: 'text', text: 'app.ts' },
            { type: 'badge', text: 'TS' },
            { type: 'badge', value: '42 lines' },
            { type: 'badge', label: 'plain' },
          ],
        },
      ],
    })
    expect(result.ok).toBe(true)
    expect(result.errors).toEqual([])
  })

  it('still rejects text/badge without any accepted label field', () => {
    const result = validateGenuiSpec({ items: [{ type: 'text' }, { type: 'badge' }] })
    expect(result.ok).toBe(false)
    expect(result.errors.join('\n')).toContain("requires content or text")
    expect(result.errors.join('\n')).toContain("requires label, text, value, or content")
  })
})

describe('repairGenuiSpec: color field whitelist (CSS injection channel)', () => {
  it('keeps hex / rgb / hsl / host-token colors', () => {
    const spec = repairGenuiSpec({
      items: [
        { type: 'avatar', name: 'A', color: '#4f8ef7' },
        { type: 'chart', data: [{ label: 'x', value: 1, color: 'rgb(10, 20, 30)' }] },
        { type: 'chart', data: [{ label: 'y', value: 2, color: 'var(--dsw-static-green-400)' }] },
        { type: 'scene3d', meshes: [{ shape: 'box', color: 'hsl(210 50% 40%)' }], background: '#101418' },
      ],
    })
    expect(spec?.items[0]).toMatchObject({ color: '#4f8ef7' })
    const chart1 = spec!.items[1] as { data: Array<{ color?: string }> }
    expect(chart1.data[0]!.color).toBe('rgb(10, 20, 30)')
    const chart2 = spec!.items[2] as { data: Array<{ color?: string }> }
    expect(chart2.data[0]!.color).toBe('var(--dsw-static-green-400)')
    expect(spec?.items[3]).toMatchObject({ background: '#101418' })
  })

  it('drops url()/javascript:/garbage values (degrade to default palette)', () => {
    const spec = repairGenuiSpec({
      items: [
        { type: 'avatar', name: 'A', color: 'url(https://evil.example/track?u=1)' },
        { type: 'chart', data: [{ label: 'x', value: 1, color: 'javascript:alert(1)' }] },
        { type: 'plot', series: [{ expr: 'x', color: 'expression(alert(1))' }] },
        { type: 'scene3d', meshes: [{ shape: 'box', color: 'not-a-color' }] },
      ],
    })
    expect(spec?.items[0]).toEqual({ type: 'avatar', name: 'A' })
    const chart = spec!.items[1] as { data: Array<{ color?: string }> }
    expect(chart.data[0]!.color).toBeUndefined()
    const plot = spec!.items[2] as { series: Array<{ color?: string }> }
    expect(plot.series[0]!.color).toBeUndefined()
    const scene = spec!.items[3] as { meshes: Array<{ color?: string }> }
    expect(scene.meshes[0]!.color).toBeUndefined()
  })
})

describe('validateGenuiSpec: repair parity for the tabs[].content alias', () => {
  // repairTabs accepts `content` as an items alias (single component or
  // array); validation must accept it too, else validate_dsh_ui flags
  // working specs and models rewrite them pointlessly.
  it('accepts tabs[].content as a single node without errors', () => {
    const result = validateGenuiSpec({
      items: [{ type: 'tabs', tabs: [{ label: 'A', content: text('x') }] }],
    })
    expect(result.ok).toBe(true)
    expect(result.errors).toEqual([])
  })

  it('accepts tabs[].content as an array', () => {
    const result = validateGenuiSpec({
      items: [{ type: 'tabs', tabs: [{ label: 'A', content: [text('a'), text('b')] }] }],
    })
    expect(result.ok).toBe(true)
    expect(result.errors).toEqual([])
  })

  it('still reports real problems inside aliased tab content', () => {
    const result = validateGenuiSpec({
      items: [{ type: 'tabs', tabs: [{ label: 'A', content: [{ type: 'progress' }] }] }],
    })
    expect(result.ok).toBe(false)
    expect(result.errors.join('\n')).toContain('tabs[0]')
  })
})

describe('repairGenuiSpec: json value size budget', () => {
  it('keeps normal values verbatim', () => {
    const spec = repairGenuiSpec({ items: [{ type: 'json', value: { a: 1, b: ['x', 'y'] } }] })
    expect(spec?.items[0]).toEqual({ type: 'json', value: { a: 1, b: ['x', 'y'] } })
  })

  it('keeps an explicit value: null (a legit JSON scalar, not blank/undefined)', () => {
    // Regression: `v.value ?? v.data` swallowed an explicit null into
    // undefined and the fence rendered "undefined" instead of "null".
    const spec = repairGenuiSpec({ items: [{ type: 'json', value: null }] })
    const node = spec?.items[0] as { type: string; value?: unknown } | undefined
    expect(node).toEqual({ type: 'json', value: null })
    expect(node !== undefined && 'value' in node && node.value === null).toBe(true)
  })

  it('keeps an explicit data: null through the data→value rename', () => {
    const spec = repairGenuiSpec({ items: [{ type: 'json', data: null }] })
    expect(spec?.items[0]).toEqual({ type: 'json', value: null })
  })

  it('drops the node when the serialized value exceeds maxJsonValue', () => {
    // One huge string payload: pre-fix this passed through unbounded and
    // JsonNode would re-stringify it on every render.
    const big = { pad: 'x'.repeat(GENUI_LIMITS.maxJsonValue + 10) }
    expect(repairGenuiSpec({ items: [{ type: 'json', value: big }] })).toEqual({ items: [] })
  })

  it('tolerates unserializable values instead of throwing', () => {
    const circular: Record<string, unknown> = {}
    circular.self = circular
    expect(() => repairGenuiSpec({ items: [{ type: 'json', value: circular }] })).not.toThrow()
  })
})

describe('repair/validate: table headers → columns alias', () => {
  it('repairs a headers-only table into columns', () => {
    const spec = repairGenuiSpec({
      items: [{ type: 'table', headers: ['列1', '列2'], rows: [['值1', '值2']] }],
    })
    expect(spec?.items[0]).toEqual({ type: 'table', columns: ['列1', '列2'], rows: [['值1', '值2']] })
  })

  it('validator accepts headers as a columns alias (no false warning)', () => {
    const result = validateGenuiSpec({
      items: [{ type: 'table', headers: ['a', 'b'], rows: [['1', '2']] }],
    })
    expect(result.ok).toBe(true)
    expect(result.errors).toEqual([])
  })

  it('still reports a table missing both columns and headers', () => {
    const result = validateGenuiSpec({ items: [{ type: 'table', rows: [['1']] }] })
    expect(result.ok).toBe(false)
    expect(result.errors.join('\n')).toContain('columns')
  })

  it('object-style headers flatten the same as object columns', () => {
    const spec = repairGenuiSpec({
      items: [{ type: 'table', headers: [{ title: '名称', key: 'name' }], rows: [{ name: '张三' }] }],
    })
    expect(spec?.items[0]).toEqual({ type: 'table', columns: ['名称'], rows: [['张三']] })
  })
})

describe('repair/validate: callout text→content & type_→tone aliases', () => {
  it('repairs a callout with text into content', () => {
    const spec = repairGenuiSpec({ items: [{ type: 'callout', text: '正文', title: '标题' }] })
    expect(spec?.items[0]).toEqual({ type: 'callout', content: '正文', title: '标题' })
  })

  it('repairs type_ into tone', () => {
    const spec = repairGenuiSpec({ items: [{ type: 'callout', type_: 'success', content: 'x' }] })
    expect(spec?.items[0]).toEqual({ type: 'callout', content: 'x', tone: 'success' })
  })

  it('validator accepts text (no false warning)', () => {
    const r = validateGenuiSpec({ items: [{ type: 'callout', text: 'x' }] })
    expect(r.ok).toBe(true)
    expect(r.errors).toEqual([])
  })

  it('canonical content wins when both text and content present', () => {
    const spec = repairGenuiSpec({ items: [{ type: 'callout', content: '正文', text: '备选' }] })
    expect(spec?.items[0]).toEqual({ type: 'callout', content: '正文' })
  })

  it('still reports a callout with neither content nor text', () => {
    const r = validateGenuiSpec({ items: [{ type: 'callout', title: 'x' }] })
    expect(r.ok).toBe(false)
    expect(r.errors.join('\n')).toContain('content')
  })

  it('repairs body into content', () => {
    const spec = repairGenuiSpec({ items: [{ type: 'callout', body: '正文字段', tone: 'info' }] })
    expect(spec?.items[0]).toEqual({ type: 'callout', content: '正文字段', tone: 'info' })
  })

  it('validator accepts body (no false warning)', () => {
    const r = validateGenuiSpec({ items: [{ type: 'callout', body: 'x' }] })
    expect(r.ok).toBe(true)
    expect(r.errors).toEqual([])
  })
})

describe('repair/validate: HTML heading aliases h1/h2/h3 → text+size', () => {
  it('repairs {"type":"h2",content} into text+size:h2 (正向)', () => {
    const spec = repairGenuiSpec({ items: [{ type: 'h2', content: '章节标题' }] })
    expect(spec?.items[0]).toEqual({ type: 'text', content: '章节标题', size: 'h2' })
  })

  it('validator stays silent for h1/h2/h3 (any case/space form)', () => {
    for (const t of ['h1', 'h2', 'h3', 'H2', ' h3 ']) {
      const r = validateGenuiSpec({ items: [{ type: t, content: 'x' }] })
      expect(r.ok, `${t} -> ${JSON.stringify(r.errors)}`).toBe(true)
      expect(r.errors).toEqual([])
    }
  })

  it('records a type-level renamed diagnostic for the stitch', () => {
    const diag: GenuiRepairDiagnostic[] = []
    repairGenuiSpec({ items: [{ type: 'h2', content: 'x' }] }, diag)
    const renames = diag.filter(d => d.kind === 'renamed')
    expect(renames).toHaveLength(1)
    expect(renames[0].path).toBe('items[0]')
    expect(renames[0].detail).toContain('h2')
    expect(renames[0].detail).toContain('text')
  })

  it('content priority: content → text → string children → body', () => {
    expect(repairGenuiSpec({ items: [{ type: 'h2', text: '来自text' }] })?.items[0])
      .toEqual({ type: 'text', content: '来自text', size: 'h2' })
    expect(repairGenuiSpec({ items: [{ type: 'h2', children: '来自children' }] })?.items[0])
      .toEqual({ type: 'text', content: '来自children', size: 'h2' })
    expect(repairGenuiSpec({ items: [{ type: 'h2', body: '来自body' }] })?.items[0])
      .toEqual({ type: 'text', content: '来自body', size: 'h2' })
    // canonical content wins when both content and an alias are present
    expect(repairGenuiSpec({ items: [{ type: 'h2', content: '正文', body: '备选' }] })?.items[0])
      .toEqual({ type: 'text', content: '正文', size: 'h2' })
  })

  it('alias-consumed keys do not double-report as dropped-unknown-key', () => {
    const diag: GenuiRepairDiagnostic[] = []
    repairGenuiSpec({ items: [{ type: 'h2', text: 'x' }] }, diag)
    expect(diag.filter(d => d.kind === 'renamed')).toHaveLength(2) // type 级 + text→content 字段级
    expect(diag.filter(d => d.kind === 'dropped-unknown-key')).toHaveLength(0)
  })

  it('case-insensitive: H2 → text+size:h2', () => {
    const spec = repairGenuiSpec({ items: [{ type: 'H2', content: '大写标题' }] })
    expect(spec?.items[0]).toEqual({ type: 'text', content: '大写标题', size: 'h2' })
  })

  it('drops a heading alias with no content field (h2 无内容 → dropped)', () => {
    const spec = repairGenuiSpec({ items: [{ type: 'h2' }, text('保留下来的节点')] })
    expect(spec?.items).toHaveLength(1)
    expect(spec?.items[0]).toEqual({ type: 'text', content: '保留下来的节点' })
  })

  it('does NOT stitch h4/h5/h6 (opaque pass-through + validator error with pointer)', () => {
    const spec = repairGenuiSpec({ items: [{ type: 'h5', content: 'x' }] })
    expect((spec?.items[0] as { type: string }).type).toBe('h5')
    const r = validateGenuiSpec({ items: [{ type: 'h5', content: 'x' }] })
    expect(r.ok).toBe(false)
    expect(r.errors.join('\n')).toContain("unknown type 'h5'")
    expect(r.errors.join('\n')).toContain('请改用 {"type":"text","size":"h3"}')
    // 大写形式同样报错
    expect(validateGenuiSpec({ items: [{ type: 'H4' }] }).ok).toBe(false)
  })

  it('does NOT stitch when children is an array (nested-child intent)', () => {
    const spec = repairGenuiSpec({ items: [{ type: 'h2', children: [{ type: 'text', content: '子节点' }] }] })
    expect((spec?.items[0] as { type: string }).type).toBe('h2')
  })

  it('regression: legal text/badge/callout specs repair identically (前后等价)', () => {
    const before = repairGenuiSpec({
      items: [
        text('纯文本'),
        { type: 'badge', label: '新', tone: 'success' },
        { type: 'callout', content: '提示', tone: 'info', title: 'T' },
      ],
    })
    expect(before).not.toBeNull()
    const after = repairGenuiSpec(before)
    expect(after).toEqual(before)
  })

  it('idempotent: a stitched heading repairs to itself on the second pass', () => {
    const once = repairGenuiSpec({ items: [{ type: 'h2', content: 'x' }] })
    const twice = repairGenuiSpec(once)
    expect(twice).toEqual(once)
  })
})

describe('repair/validate: common field-name aliases (batch)', () => {
  // 每个 [变体 spec 的 items[0], 期望修复后的 items[0]]
  const cases: Array<[unknown, unknown]> = [
    [{ type: 'button', text: '点我' }, { type: 'button', label: '点我' }],
    [{ type: 'select', choices: ['a', 'b'] }, { type: 'select', options: ['a', 'b'] }],
    [{ type: 'radio', label: 'Q', choices: ['a', 'b'] }, { type: 'radio', label: 'Q', options: ['a', 'b'] }],
    [{ type: 'quiz', question: 'Q', choices: [{ label: 'a' }] }, { type: 'quiz', question: 'Q', options: [{ label: 'a' }] }],
    [{ type: 'steps', items: [{ title: 's' }] }, { type: 'steps', steps: [{ title: 's' }] }],
    [{ type: 'keyvalue', items: [{ key: 'k', value: 'v' }] }, { type: 'keyvalue', pairs: [{ key: 'k', value: 'v' }] }],
    [{ type: 'keyvalue', data: [{ key: 'k', value: 'v' }] }, { type: 'keyvalue', pairs: [{ key: 'k', value: 'v' }] }],
    [{ type: 'list', children: ['a', 'b'] }, { type: 'list', items: ['a', 'b'] }],
    [{ type: 'progress', percent: 50 }, { type: 'progress', value: 50 }],
    [{ type: 'stat', label: 'L', val: '9' }, { type: 'stat', label: 'L', value: '9' }],
    [{ type: 'json', data: { a: 1 } }, { type: 'json', value: { a: 1 } }],
    [{ type: 'copy', content: 'x' }, { type: 'copy', text: 'x' }],
    [{ type: 'scene3d', objects: [{ shape: 'box' }] }, { type: 'scene3d', meshes: [{ shape: 'box' }] }],
    [{ type: 'chart', points: [{ label: 'a', value: 1 }] }, { type: 'chart', data: [{ label: 'a', value: 1 }], series: undefined }],
    [{ type: 'mermaid', source: 'graph TD' }, { type: 'mermaid', code: 'graph TD' }],
    [{ type: 'timeline', entries: [{ title: 'e' }] }, { type: 'timeline', items: [{ title: 'e' }] }],
    [{ type: 'audio', url: 'https://x/a.mp3' }, { type: 'audio', src: 'https://x/a.mp3' }],
    [{ type: 'video', url: 'https://x/a.mp4' }, { type: 'video', src: 'https://x/a.mp4' }],
  ]

  it('repairs every alias variant and validator stays silent', () => {
    for (const [variant, expected] of cases) {
      const rep = repairGenuiSpec({ items: [variant] })
      expect(rep, `repair ${JSON.stringify(variant)}`).not.toBeNull()
      expect(rep!.items[0], `repair ${JSON.stringify(variant)}`).toEqual(expected)
      const val = validateGenuiSpec({ items: [variant] })
      expect(val.ok, `validate ${JSON.stringify(variant)} -> ${JSON.stringify(val.errors)}`).toBe(true)
    }
  })

  it('canonical field wins when both present', () => {
    const rep = repairGenuiSpec({ items: [{ type: 'chart', data: [{ label: 'a', value: 1 }], points: [{ label: 'b', value: 2 }] }] })
    expect(rep?.items[0]).toEqual({ type: 'chart', data: [{ label: 'a', value: 1 }], series: undefined })
  })
})

describe('validate: divider/spacer no longer flagged unknown', () => {
  it('validator accepts divider and spacer (repair/validator parity)', () => {
    const r = validateGenuiSpec({ items: [{ type: 'divider' }, { type: 'spacer' }] })
    expect(r.ok).toBe(true)
    expect(r.errors).toEqual([])
  })
})

describe('GENUI_NODE_TYPES ↔ repair ↔ validator ↔ render 四方一致', () => {
  // 防 divider 类复发：白名单里的每个类型，repair/validator/渲染器都必须有 case。
  // 新增组件只改一处时，此测试当场红。
  const src = readFileSync(join(process.cwd(), 'src/client/guard.ts'), 'utf8')
  const renderSrc = readFileSync(join(process.cwd(), 'src/client/blocks/render-node.tsx'), 'utf8')
  const repairCases = new Set([...src.matchAll(/case '([a-z0-9-]+)'/g)].map(m => m[1]))
  const validatorCases = new Set([...src.matchAll(/case '([a-z0-9-]+)'/g)].map(m => m[1]))
  const renderCases = new Set([...renderSrc.matchAll(/case '([a-z0-9-]+)'/g)].map(m => m[1]))

  for (const t of GENUI_NODE_TYPES) {
    it(`type '${t}' has repair + validator + render cases`, () => {
      expect(repairCases.has(t), `repair 缺 case '${t}'`).toBe(true)
      expect(validatorCases.has(t), `validator 缺 case '${t}'`).toBe(true)
      expect(renderCases.has(t), `render-node 缺 case '${t}'`).toBe(true)
    })
  }

  it('repair 不处理白名单之外的 type', () => {
    for (const t of repairCases) expect(GENUI_NODE_TYPES.has(t), `repair 有白名单外 '${t}'`).toBe(true)
  })
})

describe('repair/validate: row columns→items & callout description→content', () => {
  it('row accepts columns as items alias', () => {
    const spec = repairGenuiSpec({ items: [{ type: 'row', columns: [{ type: 'text', content: 'a' }, { type: 'text', content: 'b' }], wrap: true }] })
    expect(spec?.items[0]).toEqual({ type: 'row', items: [{ type: 'text', content: 'a' }, { type: 'text', content: 'b' }], wrap: true })
    const v = validateGenuiSpec({ items: [{ type: 'row', columns: [{ type: 'text', content: 'a' }] }] })
    expect(v.ok).toBe(true)
  })

  it('grid accepts columns as items alias (cols 仍独立)', () => {
    const spec = repairGenuiSpec({ items: [{ type: 'grid', cols: 2, columns: [{ type: 'text', content: 'x' }] }] })
    expect(spec?.items[0]).toEqual({ type: 'grid', cols: 2, items: [{ type: 'text', content: 'x' }] })
  })

  it('callout accepts description as content alias', () => {
    const spec = repairGenuiSpec({ items: [{ type: 'callout', description: '分类依据', title: '标题' }] })
    expect(spec?.items[0]).toEqual({ type: 'callout', content: '分类依据', title: '标题' })
    const v = validateGenuiSpec({ items: [{ type: 'callout', description: 'x' }] })
    expect(v.ok).toBe(true)
  })

  it('canonical items wins when both items and columns present', () => {
    const spec = repairGenuiSpec({ items: [{ type: 'row', items: [{ type: 'text', content: 'A' }], columns: [{ type: 'text', content: 'B' }] }] })
    expect(spec?.items[0]).toEqual({ type: 'row', items: [{ type: 'text', content: 'A' }] })
  })
})

describe('repair: callout level→tone alias', () => {
  it('accepts level as tone', () => {
    const spec = repairGenuiSpec({ items: [{ type: 'callout', level: 'success', content: 'x' }] })
    expect(spec?.items[0]).toEqual({ type: 'callout', content: 'x', tone: 'success' })
  })
})

describe('repair/validate: badge content→label & callout items→content aliases', () => {
  it('badge heals content into label and records the rename', () => {
    const diag: GenuiRepairDiagnostic[] = []
    const spec = repairGenuiSpec({ items: [{ type: 'badge', content: '新增' }] }, diag)
    expect(spec?.items[0]).toEqual({ type: 'badge', label: '新增' })
    const renames = diag.filter((d) => d.kind === 'renamed')
    expect(renames).toHaveLength(1)
    expect(renames[0]!.path).toBe('items[0]')
    expect(renames[0]!.detail).toContain("'content'")
    expect(renames[0]!.detail).toContain('label')
  })

  it('badge still prefers label over the content alias without recording a rename', () => {
    const diag: GenuiRepairDiagnostic[] = []
    const spec = repairGenuiSpec({ items: [{ type: 'badge', label: 'L', content: 'C' }] }, diag)
    expect(spec?.items[0]).toEqual({ type: 'badge', label: 'L' })
    expect(diag.filter((d) => d.kind === 'renamed')).toHaveLength(0)
  })

  it('callout heals an items array into content (first string item wins)', () => {
    const diag: GenuiRepairDiagnostic[] = []
    const spec = repairGenuiSpec({ items: [{ type: 'callout', items: ['要点一', '要点二'] }] }, diag)
    expect(spec?.items[0]).toEqual({ type: 'callout', content: '要点一' })
    const renames = diag.filter((d) => d.kind === 'renamed')
    expect(renames).toHaveLength(1)
    expect(renames[0]!.path).toBe('items[0]')
    expect(renames[0]!.detail).toContain("'items'")
    expect(renames[0]!.detail).toContain('content')
  })

  it('callout serializes non-string items into content', () => {
    const items = [{ k: 'v' }, 2]
    const spec = repairGenuiSpec({ items: [{ type: 'callout', items }] })
    expect(spec?.items[0]).toEqual({ type: 'callout', content: JSON.stringify(items) })
  })

  it('callout keeps text ahead of the items alias', () => {
    const diag: GenuiRepairDiagnostic[] = []
    const spec = repairGenuiSpec({ items: [{ type: 'callout', text: '正文', items: ['备选'] }] }, diag)
    expect(spec?.items[0]).toEqual({ type: 'callout', content: '正文' })
    const renames = diag.filter((d) => d.kind === 'renamed')
    expect(renames).toHaveLength(1)
    expect(renames[0]!.detail).toContain("'text'")
  })

  it('validate agrees with repair on the new aliases', () => {
    expect(validateGenuiSpec({ items: [{ type: 'badge', content: 'x' }] }).ok).toBe(true)
    expect(validateGenuiSpec({ items: [{ type: 'callout', items: ['x'] }] }).ok).toBe(true)
    expect(validateGenuiSpec({ items: [{ type: 'badge' }] }).ok).toBe(false)
    expect(validateGenuiSpec({ items: [{ type: 'callout', title: 'x' }] }).ok).toBe(false)
  })
})

describe('repair/validate: code value→code alias', () => {
  it('accepts value as code', () => {
    const spec = repairGenuiSpec({ items: [{ type: 'code', lang: 'ts', value: 'const a = 1' }] })
    expect(spec?.items[0]).toEqual({ type: 'code', lang: 'ts', code: 'const a = 1' })
    const v = validateGenuiSpec({ items: [{ type: 'code', value: 'x' }] })
    expect(v.ok).toBe(true)
  })
})

describe('repairGenuiSpec: file-tree shares the 200-node budget', () => {
  // file-tree entries are rendered DOM rows at every depth; repairTree must
  // charge them against the SAME shared budget repairItems uses, else a huge
  // tree bypasses the cap and renders tens of thousands of nodes (long-thread).
  it('elides the tail after a huge file-tree exhausts the budget', () => {
    const dirs = Array.from({ length: 50 }, (_, i) => ({
      name: `dir${i}`, type: 'dir',
      children: Array.from({ length: 10 }, (_, j) => ({ name: `f${i}-${j}.ts`, type: 'file' })),
    }))
    const spec = repairGenuiSpec({ items: [{ type: 'file-tree', items: dirs }, text('tail')] })
    // Budget math: file-tree node costs 1, each dir 1, each file 1. The walk
    // stops at exactly 200 entries and the trailing text is elided.
    expect(spec?.items).toHaveLength(1)
    const tree = spec!.items[0] as { items: Array<{ name: string; children?: unknown[] }> }
    let entries = 0
    const count = (nodes: Array<{ name: string; children?: unknown[] }>): void => {
      for (const n of nodes) {
        entries += 1
        if (n.children !== undefined) count(n.children as Array<{ name: string; children?: unknown[] }>)
      }
    }
    count(tree.items)
    // 1 (file-tree node) + 199 entries = 200 exactly; the 50x10 input was 551.
    expect(entries).toBe(GENUI_LIMITS.maxNodes - 1)
  })

  it('keeps a small file-tree and preserves trailing siblings', () => {
    const spec = repairGenuiSpec({ items: [
      { type: 'file-tree', items: [
        { name: 'src', type: 'dir', children: [{ name: 'index.ts', type: 'file' }] },
        { name: 'README.md', type: 'file' },
      ] },
      text('tail'),
    ] })
    expect(spec?.items).toHaveLength(2)
    const tree = spec!.items[0] as { items: Array<{ name: string; type?: string }> }
    expect(tree.items).toEqual([
      { name: 'src', type: 'dir', children: [{ name: 'index.ts', type: 'file' }] },
      { name: 'README.md', type: 'file' },
    ])
    expect((spec!.items[1] as { content: string }).content).toBe('tail')
  })

  it('nameless junk entries do not consume the shared budget', () => {
    // walkTree charges only KEPT entries: a nameless entry is dropped BEFORE
    // the budget decrement, so junk never starves valid entries or trailing
    // siblings. (Previously the charge preceded the name check, so a wall of
    // junk drained the pool first.)
    const junk = Array.from({ length: GENUI_LIMITS.maxNodes }, () => ({ type: 'file' }))
    const dirs = Array.from({ length: 10 }, (_, i) => ({ name: `d${i}`, type: 'dir' }))
    const spec = repairGenuiSpec({ items: [
      { type: 'file-tree', items: [...junk, ...dirs] },
      text('tail'),
    ] })
    // Old behavior: 200 junk entries exhausted the whole pool before the
    // first named dir — the tree came back empty and the tail was elided.
    const tree = spec!.items[0] as { items: Array<{ name: string }> }
    expect(tree.items).toHaveLength(10)
    expect((spec!.items[1] as { content: string }).content).toBe('tail')
  })
})

describe('repairGenuiSpec: scene3d mesh colors are solid literals only', () => {
  // THREE.Color never throws on unparseable strings — it warns and renders
  // them as WHITE — so the guard must drop var(--dsw-*) mesh colors
  // (browser-only tokens) to keep meshes on the visible palette. Background
  // keeps `color()` (tokens allowed; unparseable ones degrade to white).
  it('drops var(--dsw-*) mesh colors but keeps hex / rgb / hsl', () => {
    const spec = repairGenuiSpec({
      items: [
        { type: 'scene3d', meshes: [
          { shape: 'box', color: 'var(--dsw-static-deepseek-400)' },
          { shape: 'sphere', color: '#ff8800' },
          { shape: 'cone', color: 'rgb(10, 20, 30)' },
          { shape: 'cylinder', color: 'hsl(210 50% 40%)' },
        ], background: 'var(--dsw-static-deepseek-400)' },
      ],
    })
    const scene = spec!.items[0] as { meshes: Array<{ color?: string }>; background?: string }
    expect(scene.meshes[0]!.color).toBeUndefined()
    expect(scene.meshes[1]!.color).toBe('#ff8800')
    expect(scene.meshes[2]!.color).toBe('rgb(10, 20, 30)')
    expect(scene.meshes[3]!.color).toBe('hsl(210 50% 40%)')
    // background is still allowed to carry design tokens.
    expect(scene.background).toBe('var(--dsw-static-deepseek-400)')
  })

  it('leaves mesh color absent when unset (renderer uses default)', () => {
    const spec = repairGenuiSpec({
      items: [{ type: 'scene3d', meshes: [{ shape: 'box' }] }],
    })
    const scene = spec!.items[0] as { meshes: Array<{ color?: string }> }
    expect(scene.meshes[0]!.color).toBeUndefined()
  })

  it('admits whitelisted CSS named colors (THREE.Color.NAMES), normalized to lowercase', () => {
    // THREE.Color.NAMES resolves CSS named colors like 'red'/'navy' — the
    // old hex/rgb/hsl-only gate rejected them and washed meshes to the
    // default palette. Whitelisted names pass (lowercase = the exact form
    // NAMES stores), including the 'grey' spelling variant.
    const spec = repairGenuiSpec({
      items: [{ type: 'scene3d', meshes: [
        { shape: 'box', color: 'red' },
        { shape: 'sphere', color: 'NAVY' },
        { shape: 'cone', color: 'grey' },
        { shape: 'cylinder', color: 'gold' },
      ] }],
    })
    const scene = spec!.items[0] as { meshes: Array<{ color?: string }> }
    expect(scene.meshes.map((m) => m.color)).toEqual(['red', 'navy', 'grey', 'gold'])
  })

  it('still rejects named colors outside the whitelist', () => {
    const spec = repairGenuiSpec({
      items: [{ type: 'scene3d', meshes: [
        { shape: 'box', color: 'rebeccapurple' },      // real CSS name, not whitelisted
        { shape: 'sphere', color: 'transparent' },     // CSS keyword, not a color literal
        { shape: 'cone', color: 'color(srgb 1 0 0)' }, // not in the accepted grammar
        { shape: 'cylinder', color: 'var(--dsw-accent)' }, // tokens stay rejected
      ] }],
    })
    const scene = spec!.items[0] as { meshes: Array<{ color?: string }> }
    expect(scene.meshes.map((m) => m.color)).toEqual([undefined, undefined, undefined, undefined])
  })
})

describe('repairGenuiSpec: scene3d nodes capped per spec', () => {
  // Browsers cap live WebGL contexts (~16) and a page that crosses it loses
  // EVERY context at once (collective context loss) — so the guard enforces
  // a total per-spec scene3d budget, nesting included.
  const scene = () => ({ type: 'scene3d', meshes: [{ shape: 'box', size: [1, 1, 1] }] })

  it('keeps at most maxScene3dNodes top-level scenes and drops the rest', () => {
    const spec = repairGenuiSpec({ items: Array.from({ length: GENUI_LIMITS.maxScene3dNodes + 3 }, scene) })
    expect(spec?.items).toHaveLength(GENUI_LIMITS.maxScene3dNodes)
    expect(spec!.items.every((n) => (n as { type: string }).type === 'scene3d')).toBe(true)
  })

  it('counts nested scenes against the same cap and reports the drop', () => {
    const diag: GenuiRepairDiagnostic[] = []
    const spec = repairGenuiSpec({ items: [
      { type: 'col', items: [scene(), scene()] },
      { type: 'card', items: [scene()] },
      scene(), scene(),   // 4th and 5th scenes
      scene(),            // 6th — over the cap, dropped (items[4])
    ] }, diag)
    expect(spec?.items).toHaveLength(4) // col, card, scene ×2 (5 scenes kept in total)
    const col = spec!.items[0] as { items: unknown[] }
    const card = spec!.items[1] as { items: unknown[] }
    expect(col.items).toHaveLength(2)
    expect(card.items).toHaveLength(1)
    const dropped = diag.filter((d) => d.kind === 'dropped-node')
    expect(dropped).toHaveLength(1)
    expect(dropped[0]!.path).toBe('items[4]')
    expect(dropped[0]!.detail).toContain("'scene3d'")
  })

  it('a scene that fails mesh repair does not burn a cap slot', () => {
    const spec = repairGenuiSpec({ items: [
      { type: 'scene3d' },                 // no meshes → dropped, slot kept
      { type: 'scene3d', meshes: 'nope' }, // non-array meshes → dropped
      scene(), scene(), scene(), scene(), scene(), // all five still fit
    ] })
    expect(spec?.items).toHaveLength(GENUI_LIMITS.maxScene3dNodes)
  })
})

