// The render_ui tool definition: schema shape, execute behavior (guard-backed
// repair + caps), and the presentation projections (call/result cards + meta
// spec for the browser toolview).
import { describe, expect, it, vi } from 'vitest'
import { createRenderUiTool, createValidateDshUiTool } from '../src/plugin/tool.ts'
import { GENUI_LIMITS } from '../src/client/guard.ts'

const tool = createRenderUiTool()

const text = (content: string) => ({ type: 'text', content })

describe('render_ui tool definition', () => {
  it('registers under the render_ui name with an open spec argument', () => {
    expect(tool.name).toBe('render_ui')
    expect(typeof tool.description).toBe('string')
    expect(tool.description.length).toBeGreaterThan(50)
    const parameters = tool.parameters as { required?: string[]; properties?: Record<string, unknown> }
    expect(parameters.required).toContain('spec')
    const spec = parameters.properties?.spec as { type?: string } | undefined
    expect(spec).toBeDefined()
    // spec must be schema-typed as an object: a serialized JSON string (the
    // model's observed failure mode) fails argument validation early instead
    // of reaching the guard, which could not repair it anyway.
    expect(spec!.type).toBe('object')
    // The spec object carries structural hints for the tool-call bridge so it
    // can serialize the tree directly instead of falling back to an
    // OpenAI-style { arguments: "<JSON>" } wrapper (observed in the live
    // harness bridge for bare-object parameters).
    const specProps = (spec as { properties?: Record<string, unknown> }).properties
    expect(specProps).toBeDefined()
    for (const key of ['title', 'gap', 'panel', 'items']) {
      expect(specProps![key]).toBeDefined()
    }
  })

  it('declares a string output schema and a render projection', () => {
    const schema = tool.output.schema as { type?: string }
    expect(schema.type).toBe('string')
    const blocks = tool.output.render({ spec: {} }, 'ok')
    expect(blocks).toHaveLength(1)
    expect(blocks[0]!.type).toBe('text')
  })
})

describe('render_ui execute', () => {
  it('returns a render summary for a valid spec', async () => {
    const value = await tool.execute({ spec: { title: '监控面板', items: [text('a'), { type: 'stat', label: 'CPU', value: '42%' }] } })
    expect(String(value)).toContain('监控面板')
    expect(String(value)).toContain('2 个组件')
  })

  it('repairs oversized specs before summarizing (caps apply)', async () => {
    const value = await tool.execute({ spec: { items: Array.from({ length: 500 }, (_, i) => text(`n${i}`)) } })
    expect(String(value)).toContain(`${GENUI_LIMITS.maxNodes} 个组件`)
  })

  it('returns a corrective message for an unusable spec', async () => {
    const value = await tool.execute({ spec: 'not a tree' })
    expect(String(value)).toContain('spec 无效')
  })

  it('unwraps bridge-wrapped spec shapes (transport compatibility)', async () => {
    const spec = { title: '桥接兼容', items: [text('a')] }
    // Observed live: the bridge nests the authored `spec` object inside a
    // wrapper — the serialized text carried by { arguments: "..." } is itself
    // `{ spec: { title, gap, items } }` — so test both with and without the
    // inner `spec` key at every wrapper level.
    const nested = { spec }
    const expectOk = async (args: unknown) => {
      const value = await tool.execute(args as never)
      expect(String(value)).toContain('桥接兼容')
    }
    // Authored shape
    await expectOk({ spec })
    // Spec serialized to text
    await expectOk({ spec: JSON.stringify(spec) })
    await expectOk({ spec: JSON.stringify(nested) })
    // {arguments} wrapper with a serialized or object spec
    await expectOk({ arguments: JSON.stringify(spec) })
    await expectOk({ arguments: JSON.stringify(nested) })
    await expectOk({ arguments: spec })
    await expectOk({ arguments: nested })
    // Bare double-encoded strings
    await expectOk(JSON.stringify(spec))
    await expectOk(JSON.stringify(nested))
  })

  it('reports broken wrapped JSON as unusable instead of misparsing', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      // Corrupted mid-stream JSON (observed with large specs): the bridge
      // passed the raw broken text through; it must not crash and must not
      // pretend the spec is valid.
      const value = await tool.execute({ arguments: '{"spec": {"items": [' } as never)
      expect(String(value)).toContain('spec 无效')
      expect(spy).toHaveBeenCalledOnce()
      expect(String(spy.mock.calls[0]![0])).toContain('[genui-tool] spec wrapped as arguments-string')
    } finally {
      spy.mockRestore()
    }
  })
})

describe('render_ui projections', () => {
  it('projects the repaired spec into result meta for the toolview', () => {
    const meta = tool.output.presentationMeta!({ spec: { items: [text('x'), { type: 'progress', value: 150 }] } })
    const spec = meta as { items: Array<{ type: string }> }
    expect(spec.items).toHaveLength(2)
    expect((spec.items[1] as { value: number }).value).toBe(100) // clamped
  })

  it('presents pending and completed cards with the spec title', () => {
    const args = { spec: { title: '订单', items: [text('a')] } }
    const call = tool.presentCall!(args)
    expect(call).not.toBeUndefined()
    expect(call!.card).toBe('generic')
    expect((call as { title: string }).title).toContain('订单')
    const result = tool.presentResult!(args, { isError: false } as never)
    expect(result).not.toBeUndefined()
    expect((result as { title: string }).title).toContain('订单')
  })

  it('falls back to generic presentation for invalid args (replay safety)', () => {
    expect(tool.presentCall!({ spec: 42 })).toBeUndefined()
    expect(tool.presentResult!({ spec: null }, { isError: false } as never)).toBeUndefined()
  })
})


describe('validate_dsh_ui tool', () => {
  const vtool = createValidateDshUiTool()

  // The verdict is an OBJECT since the output-structure change: `ok` plus
  // a model-facing `message`, plus a `diagnostics` list (renamed /
  // dropped-unknown-key / dropped-node) whenever repair had to stitch or drop
  // anything. A fully silent repair carries NO diagnostics key.
  type Verdict = {
    ok: boolean
    message: string
    diagnostics?: Array<{ kind: string; path: string; detail: string }>
  }
  const verdictOf = async (args: unknown): Promise<Verdict> =>
    (await vtool.execute(args)) as Verdict

  it('registers under the validate_dsh_ui name with a spec argument', () => {
    expect(vtool.name).toBe('validate_dsh_ui')
    expect(vtool.description).toContain('dsh-ui fence')
    const parameters = vtool.parameters as { required?: string[] }
    expect(parameters.required).toContain('spec')
    // The output schema declares the object verdict shape (ok + message).
    const schema = vtool.output.schema as { type?: string }
    expect(schema.type).toBe('object')
  })

  it('approves a valid fence body (string or object)', async () => {
    const good = '{"title":"x","items":[{"type":"text","content":"好"}]}'
    for (const args of [{ spec: good }, { spec: JSON.parse(good) }, good]) {
      const verdict = await verdictOf(args)
      expect(verdict.ok).toBe(true)
      expect(verdict.message).toContain('✅')
      expect(verdict.message).toContain('1 个组件')
    }
    // A fully silent repair must NOT carry a diagnostics list.
    const verdict = await verdictOf({ spec: good })
    expect(verdict.diagnostics).toBeUndefined()
  })

  it('warns when declared components were silently dropped (issue #42)', async () => {
    // The table has no recognizable rows/columns at all: repair drops it and
    // the tool must not green-light a half-empty tree.
    const dropping = '{"items":[{"type":"table","columns":{},"rows":42},{"type":"text","content":"好"}]}'
    const verdict = await verdictOf({ spec: dropping })
    expect(verdict.ok).toBe(false)
    expect(verdict.message).toContain('❌')
    expect(verdict.message).toContain('声明了 2 个组件')
    expect(verdict.message).toContain('仅成功解析出 1 个')
    // The dropped node is NAMED in the diagnostics list, not hidden.
    expect(verdict.diagnostics).toHaveLength(1)
    expect(verdict.diagnostics![0]).toMatchObject({ kind: 'dropped-node', path: 'items[0]' })
  })

  it('stays green when object-shaped tables heal instead of dropping', async () => {
    const healed = '{"items":[{"type":"table","columns":[{"title":"a","key":"k"}],"data":[{"k":"v"}]}]}'
    const verdict = await verdictOf({ spec: healed })
    expect(verdict.ok).toBe(true)
    expect(verdict.message).toContain('✅')
    // The heal is an alias stitch (`data` → `rows`), and the object
    // verdict surfaces it as a renamed diagnostic instead of staying silent.
    expect(verdict.message).toContain('别名键已自动缝补')
    expect(verdict.diagnostics).toHaveLength(1)
    expect(verdict.diagnostics![0]!.kind).toBe('renamed')
  })

  it('does not mistake file-tree children for dropped components', async () => {
    const tree = '{"items":[{"type":"file-tree","items":[{"name":"src","type":"dir","children":[{"name":"a.ts","type":"file"}]}]}]}'
    const verdict = await verdictOf({ spec: tree })
    expect(verdict.ok).toBe(true)
    expect(verdict.message).toContain('✅')
  })

  it('reports parse failures with position and bracket counts', async () => {
    // The real-world failure: rows-array `]` emitted as `}` (stray closer).
    const bad = '{"title":"x","items":[{"type":"table","columns":["a"],"rows":[["1"]}]}]}]}'
    const verdict = await verdictOf({ spec: bad })
    expect(verdict.ok).toBe(false)
    expect(verdict.message).toContain('❌')
    expect(verdict.message).toContain('解析失败')
    // Bracket-count diagnostic points at the stray `}`.
    expect(verdict.message).toContain('括号计数')
    expect(verdict.message).toContain(']}')
    // Repairable: the reply hands the model the fixed JSON instead of
    // asking it to re-author the fix by hand.
    expect(verdict.message).toContain('已自动修复')
    // The fixed body sits in a fence block: the opener is three backticks,
    // the close is TWO — anchor the capture at the end of the message.
    const match = /```\n([\s\S]*)\n``$/.exec(verdict.message)
    expect(match).not.toBeNull()
    expect(() => JSON.parse(match![1]!)).not.toThrow()
  })

  it('rejects JSON that parses but is not a GenUI spec', async () => {
    const verdict = await verdictOf({ spec: '{"a":1}' })
    expect(verdict.ok).toBe(false)
    expect(verdict.message).toContain('❌')
    expect(verdict.message).toContain('items')
  })

  it('rejects a missing spec argument', async () => {
    const verdict = await verdictOf({})
    expect(verdict.ok).toBe(false)
    expect(verdict.message).toContain('❌')
    expect(verdict.message).toContain('缺少 spec')
  })

  it('reports MISSING closers in the right direction (缺 not 多)', async () => {
    const verdict = await verdictOf({ spec: '{"items": [{"type": "text"' })
    expect(verdict.ok).toBe(false)
    expect(verdict.message).toContain('缺')
    // exactly two unclosed braces: {×2 vs }×0
    expect(verdict.message).toContain('缺 2 个 }')
    expect(verdict.message).not.toContain('多 1 个 }')
  })

  it('reports EXTRA closers in the right direction (多 not 缺)', async () => {
    const verdict = await verdictOf({ spec: '{"items": []}}' })
    expect(verdict.ok).toBe(false)
    expect(verdict.message).toContain('多 1 个 }')
    expect(verdict.message).not.toContain('缺 1 个 }')
  })

  it('counts nodes inside tabs like the panel fold does', async () => {
    const spec = {
      items: [{ type: 'tabs', tabs: [
        { label: 'A', items: [text('a1'), text('a2')] },
        { label: 'B', items: [text('b1')] },
      ] }],
    }
    // 1 tabs node + 3 inner nodes = 4 (the old local counter said 1).
    const value = await tool.execute({ spec })
    expect(String(value)).toContain('4 个组件')
    const verdict = await verdictOf({ spec: JSON.stringify(spec) })
    expect(verdict.ok).toBe(true)
    expect(verdict.message).toContain('4 个组件')
  })

  it('returns the AUTO-REPAIRED JSON when the body is repairable', async () => {
    // trailing comma + missing closing brackets — tier-1/tier-2 heal it.
    const bad = '{"items":[{"type":"text","content":"你好"},],'
    const verdict = await verdictOf({ spec: bad })
    expect(verdict.ok).toBe(false)
    expect(verdict.message).toContain('已自动修复')
    expect(verdict.message).toContain('直接作为围栏正文发出即可')
    // the repaired body appears verbatim inside the fence block and parses
    const match = /```\n([\s\S]*)\n``$/.exec(verdict.message)
    expect(match).not.toBeNull()
    const repaired = match![1]!
    expect(() => JSON.parse(repaired)).not.toThrow()
    expect(repaired).toContain('"content":"你好"')
    expect(repaired).not.toMatch(/,\]/)
  })

  it('keeps the diagnostics-only reply when the body cannot be repaired', async () => {
    const bad = '{"title": "x", garbage'
    const verdict = await verdictOf({ spec: bad })
    expect(verdict.ok).toBe(false)
    expect(verdict.message).toContain('解析失败')
    expect(verdict.message).toContain('自动修复未能恢复')
    expect(verdict.message).toContain('常见原因')
    // This path offers NO auto-fixed fence and carries no diagnostics.
    expect(verdict.message).not.toContain('已自动修复')
    expect(verdict.diagnostics).toBeUndefined()
  })

  it('surfaces alias stitches as renamed diagnostics on a valid spec', async () => {
    const alias = '{"items":[{"type":"callout","content":"hi","type_":"info"}]}'
    const verdict = await verdictOf({ spec: alias })
    expect(verdict.ok).toBe(true)
    expect(verdict.message).toContain('✅')
    expect(verdict.message).toContain('⚠️ 1 处别名键已自动缝补——能用但请改用正名')
    expect(verdict.diagnostics).toHaveLength(1)
    expect(verdict.diagnostics![0]!.kind).toBe('renamed')
    expect(verdict.diagnostics![0]!.path).toBe('items[0]')
    expect(verdict.diagnostics![0]!.detail).toContain("'tone'")
  })

  it('reports unknown keys as dropped-unknown-key diagnostics', async () => {
    const verdict = await verdictOf({ spec: '{"items":[{"type":"text","content":"a","foo":1}]}' })
    expect(verdict.ok).toBe(true)
    expect(verdict.message).toContain('1 处非法/多余键被无声丢弃——逐键比对字段表')
    expect(verdict.diagnostics).toHaveLength(1)
    expect(verdict.diagnostics![0]!.kind).toBe('dropped-unknown-key')
    expect(verdict.diagnostics![0]!.path).toBe('items[0]')
  })

  it('warns when the auto-repaired JSON still carries alias keys', async () => {
    // The fence is repairable, but the FIXED body still uses an alias key:
    // the reply must warn, or the model re-emits alias-keyed JSON forever.
    const bad = '{"items":[{"type":"callout","content":"你好","type_":"info"},],'
    const verdict = await verdictOf({ spec: bad })
    expect(verdict.ok).toBe(false)
    expect(verdict.message).toContain('已自动修复')
    expect(verdict.message).toContain('修复后的 JSON 仍含 1 处别名键：能用但请改用正名')
    expect(verdict.diagnostics).toHaveLength(1)
    expect(verdict.diagnostics![0]!.kind).toBe('renamed')
  })

  it('flags a truncated repair so partial content is not shipped silently (P3)', async () => {
    // The orphan member cannot merge back ("k":1 intervened): the full
    // repair cannot parse, so completeFenceJson degrades to the truncated
    // prefix. The verdict must TELL the model content was dropped instead
    // of handing over the prefix as if it were the whole fence.
    const truncated = '{"type":"table","columns":["a"],"rows":[["留一"],["留二"]],"k":1,["尾巴"'
    const verdict = await verdictOf({ spec: truncated })
    expect(verdict.ok).toBe(false)
    expect(verdict.message).toContain('已自动修复')
    expect(verdict.message).toContain('截断降级')
    expect(verdict.message).toContain('部分内容因格式错误被丢弃')
    // The handed-back JSON is the (parseable) truncated prefix.
    const match = /```\n([\s\S]*)\n``$/.exec(verdict.message)
    expect(match).not.toBeNull()
    expect(() => JSON.parse(match![1]!)).not.toThrow()
    expect(match![1]!).not.toContain('尾巴')
  })
})
