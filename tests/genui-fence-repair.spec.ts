// Fence JSON auto-repair: models writing HTML-style `key="value"` produce
// `"key"="value"` which is invalid JSON (the separator must be `:`). Both
// repair tiers must heal it — tier-1 alone, and tier-2 folded with a missing
// closer — and never adopt garbage.
import { describe, expect, it } from 'vitest'
import { completeFenceJson, redactJsonErrorSnippet, repairFenceJson } from '../src/shared/fence-repair.ts'

describe('repairFenceJson: `=` → `:` key-value separator', () => {
  it('heals a single `"key"="value"` mistake', () => {
    const r = repairFenceJson('{"type":"callout","tone"="info","content":"x"}')
    expect(r).not.toBeNull()
    expect(r!.text).toBe('{"type":"callout","tone":"info","content":"x"}')
    expect(r!.repairs).toBe(1)
    expect(JSON.parse(r!.text)).toEqual({ type: 'callout', tone: 'info', content: 'x' })
  })

  it('heals multiple occurrences in one body', () => {
    const r = repairFenceJson('{"a"="1","b"="2","c"="3"}')
    expect(r).not.toBeNull()
    expect(r!.text).toBe('{"a":"1","b":"2","c":"3"}')
    expect(r!.repairs).toBe(3)
  })

  it('handles whitespace around the `=`', () => {
    const r = repairFenceJson('{"tone" = "info","content" = "x"}')
    expect(r).not.toBeNull()
    expect(r!.text).toBe('{"tone" : "info","content" : "x"}')
    expect(JSON.parse(r!.text)).toEqual({ tone: 'info', content: 'x' })
  })

  it('does not corrupt valid JSON (returns null, no adoption)', () => {
    expect(repairFenceJson('{"a":"1","b":"2"}')).toBeNull()
  })

  it('does not adopt when healing cannot produce valid JSON', () => {
    // `=` inside a value context can't be healed to valid JSON.
    expect(repairFenceJson('{"a" = "1" = "2"}')).toBeNull()
  })
})

describe('completeFenceJson: `=` → `:` folded with missing closers', () => {
  it('heals `=` AND an unterminated body in one pass', () => {
    const r = completeFenceJson('{"tone"="info","content":"x"')
    expect(r).not.toBeNull()
    expect(JSON.parse(r!.text)).toEqual({ tone: 'info', content: 'x' })
  })

  it('heals `=` AND a stray mismatched closer', () => {
    const r = completeFenceJson('{"a"="1"]}')
    expect(r).not.toBeNull()
    expect(JSON.parse(r!.text)).toEqual({ a: '1' })
  })
})

describe('completeFenceJson: dangling "type" after root close (手写括号错位)', () => {
  it('moves a dangling type into the root object', () => {
    const r = completeFenceJson('{"items":[{"type":"text","content":"a"}]},"type":"list"')
    expect(r).not.toBeNull()
    expect(r!.text).toBe('{"type":"list","items":[{"type":"text","content":"a"}]}')
    expect(JSON.parse(r!.text)).toEqual({ type: 'list', items: [{ type: 'text', content: 'a' }] })
  })

  it('handles the no-comma and whitespace variants', () => {
    const r1 = completeFenceJson('{"items":[]} "type":"col"')
    expect(JSON.parse(r1!.text)).toEqual({ type: 'col', items: [] })
    const r2 = completeFenceJson('{"items":[]}"type":"card"')
    expect(JSON.parse(r2!.text)).toEqual({ type: 'card', items: [] })
  })

  it('does NOT inject when the root already has a leading type', () => {
    // Nested types are fine; a root-level first-key `type` means no heal.
    const nested = completeFenceJson('{"items":[{"type":"text","content":"a"}]},"type":"list"')
    expect(JSON.parse(nested!.text).type).toBe('list')
  })

  it('does not adopt when the result cannot parse', () => {
    expect(completeFenceJson('{"a":"1"},"type":"list",garbage')).toBeNull()
  })
})

describe('repair: `"key="value"` (unclosed key quote before =)', () => {
  it('heals the user-typed HTML form via tier-1', () => {
    const r = repairFenceJson('{"type":"callout","tone="info","content":"x"}')
    expect(r).not.toBeNull()
    expect(JSON.parse(r!.text)).toEqual({ type: 'callout', tone: 'info', content: 'x' })
  })

  it('heals it via tier-2 with a missing closer too', () => {
    const r = completeFenceJson('{"type":"callout","tone="info","content":"x"')
    expect(r).not.toBeNull()
    expect(JSON.parse(r!.text)).toEqual({ type: 'callout', tone: 'info', content: 'x' })
  })

  it('leaves `=` inside VALUE strings untouched', () => {
    const r = repairFenceJson('{"a":"x=y","b" = "z"}')
    expect(r).not.toBeNull()
    expect(JSON.parse(r!.text)).toEqual({ a: 'x=y', b: 'z' })
  })

  it('does not corrupt valid JSON (returns null)', () => {
    expect(repairFenceJson('{"a":"x=y","b":"z"}')).toBeNull()
  })
})

describe('completeFenceJson: orphan array sibling merged back (孤儿数组元素并回前一个数组)', () => {
  it('merges an orphan array sibling into the just-closed member value array', () => {
    const r = completeFenceJson('{"rows":[[1],[2]],["c","d"]}')
    expect(r).not.toBeNull()
    expect(r!.text).toBe('{"rows":[[1],[2],["c","d"]]}')
    expect(JSON.parse(r!.text)).toEqual({ rows: [[1], [2], ['c', 'd']] })
  })

  it('merges an orphan OBJECT sibling too (arrays accept any value)', () => {
    const r = completeFenceJson('{"rows":[[1]],{"a":1}}')
    expect(r).not.toBeNull()
    expect(JSON.parse(r!.text)).toEqual({ rows: [[1], { a: 1 }] })
  })

  it('composes with unterminated string + missing closers in one pass', () => {
    const r = completeFenceJson('{"rows":[[1],[2]],["c"')
    expect(r).not.toBeNull()
    expect(JSON.parse(r!.text)).toEqual({ rows: [[1], [2], ['c']] })
  })

  it('tolerates whitespace between the closer, comma, and orphan', () => {
    const r = completeFenceJson('{"rows":[[1],[2]] ,  ["c","d"]}')
    expect(r).not.toBeNull()
    expect(JSON.parse(r!.text)).toEqual({ rows: [[1], [2], ['c', 'd']] })
  })

  it('does NOT merge when the stale closer is followed by other members', () => {
    // The ] after [0] is long closed-over: "b":1 sits between it and the
    // orphan, so merging would steal ["x"] into the "a" array. Must not adopt.
    expect(completeFenceJson('{"a":[0],"b":1,["x"]}')).toBeNull()
  })

  it('does NOT heal a value OBJECT closed early (no single deletion helps)', () => {
    expect(completeFenceJson('{"a":{"x":1},{"b":2}}')).toBeNull()
  })

  it('does NOT merge at the root array level (object-context-only heal)', () => {
    expect(completeFenceJson('[[1],[2]],["c"]')).toBeNull()
  })

  it('does not corrupt VALID JSON that has commas before [ / { literals', () => {
    // Legal member list commas are always followed by "key" strings, and a
    // legal array-context comma before [ must stay untouched.
    expect(repairFenceJson('{"a":[1],"b":[2]}')).toBeNull()
    expect(repairFenceJson('{"m":[[1],[2]],"k":1}')).toBeNull()
    expect(completeFenceJson('{"a":[1],"b":[2]}')).toBeNull()
  })
})

describe('completeFenceJson: bare-bracket orphan at object position (P2: 缺逗号并回键值数组)', () => {
  it('merges a bare array orphan separated by whitespace only (author dropped the comma)', () => {
    const r = completeFenceJson('{"rows":[[1],[2]] ["c","d"]}')
    expect(r).not.toBeNull()
    expect(JSON.parse(r!.text)).toEqual({ rows: [[1], [2], ['c', 'd']] })
  })

  it('merges with no separator at all', () => {
    const r = completeFenceJson('{"rows":[[1],[2]]["c","d"]}')
    expect(r).not.toBeNull()
    expect(r!.text).toBe('{"rows":[[1],[2],["c","d"]]}')
    expect(JSON.parse(r!.text)).toEqual({ rows: [[1], [2], ['c', 'd']] })
  })

  it('merges across newlines/tabs (whitespace-only gap stays fresh)', () => {
    const r = completeFenceJson('{"rows":[[1],[2]]\n\t["c"]}')
    expect(r).not.toBeNull()
    expect(JSON.parse(r!.text)).toEqual({ rows: [[1], [2], ['c']] })
  })

  it('merges a bare OBJECT orphan the same way (arrays accept any value)', () => {
    const r = completeFenceJson('{"rows":[[1]] {"a":1}}')
    expect(r).not.toBeNull()
    expect(JSON.parse(r!.text)).toEqual({ rows: [[1], { a: 1 }] })
  })

  it('composes with a still-missing closer in one pass', () => {
    const r = completeFenceJson('{"rows":[[1],[2]] ["c"')
    expect(r).not.toBeNull()
    expect(JSON.parse(r!.text)).toEqual({ rows: [[1], [2], ['c']] })
  })

  it('does NOT merge after a value-OBJECT closer (key-value ARRAYS only)', () => {
    // Deleting the } of {"x":1} cannot produce valid JSON — same rationale
    // as the comma variant; no closer to reopen, nothing adopted.
    expect(completeFenceJson('{"a":{"x":1} ["b"]}')).toBeNull()
  })

  it('does NOT fire at root level (object member lists only)', () => {
    expect(completeFenceJson('[[1],[2]] ["c"]')).toBeNull()
  })

  it('does NOT merge over intermediate members (closer must be fresh)', () => {
    // "k":1 sits between the "rows" closer and the bare [ — backtracking
    // over it would steal the orphan into "rows" while corrupting "k".
    expect(completeFenceJson('{"rows":[[1],[2]],"k":1 ["c"]}')).toBeNull()
  })
})

describe('completeFenceJson: truncated degradation when full repair fails (P3: 截断降级)', () => {
  it('drops an unmergeable orphan tail and keeps the repaired prefix', () => {
    // The orphan ["x" cannot merge (stale closer — "k":1 intervened) and the
    // body needs appended closers, so the full result cannot parse. Degrade:
    // drop the orphan, keep rows + k.
    const r = completeFenceJson('{"rows":[[1],[2]],"k":1,["x"')
    expect(r).not.toBeNull()
    expect(r!.text).toBe('{"rows":[[1],[2]],"k":1}')
    expect(JSON.parse(r!.text)).toEqual({ rows: [[1], [2]], k: 1 })
    expect(r!.repairs).toBe(3) // 2 appended closers + 1 truncation
  })

  it('prefers the LONGEST repaired prefix (keeps later legal members)', () => {
    // Two orphan members; cutting at the last orphan keeps ["x"] which still
    // cannot parse on its own — the gate rejects it and the fallback settles
    // on the earlier cut, preserving "b".
    const r = completeFenceJson('{"a":[0],"b":1,["x"],"c":2,["y"]')
    expect(r).not.toBeNull()
    expect(JSON.parse(r!.text)).toEqual({ a: [0], b: 1 })
  })

  it('degrades to the pre-orphan structure when a MERGED orphan tail stays broken', () => {
    // The orphan merges fine, but its own "c": is damaged (stray :) so the
    // whole body still fails the gate. Fall back to the pre-orphan cut taken
    // at merge time: rows closes where the author had closed it.
    const r = completeFenceJson('{"rows":[[1],[2]],["c":}')
    expect(r).not.toBeNull()
    expect(r!.text).toBe('{"rows":[[1],[2]]}')
  })

  it('never degrades to an empty shell', () => {
    // The only cut would leave {} — an empty UI is not a recovery; fail
    // honestly instead.
    expect(completeFenceJson('{{"a":1}')).toBeNull()
  })

  it('still returns null when no orphan truncation point exists', () => {
    // Bare garbage has no bracket-orphan cut candidate; nothing to degrade.
    expect(completeFenceJson('{"title": "x", garbage')).toBeNull()
  })

  it('does not engage when the scan repaired nothing (repairs=0 gate)', () => {
    // Balanced-but-orphaned bodies must keep failing honestly — degradation
    // only rides on an otherwise-active repair pass.
    expect(completeFenceJson('{"a":[0],"b":1,["x"]}')).toBeNull()
  })

  it('flags every truncated adoption with truncated: true (P3 可见性)', () => {
    // A degraded result silently rendered as if nothing was lost — the flag
    // is how the renderer/validate tool learn content was DROPPED.
    const r = completeFenceJson('{"rows":[[1],[2]],"k":1,["x"')
    expect(r).not.toBeNull()
    expect(r!.truncated).toBe(true)
  })

  it('does NOT flag full repairs (no truncation, nothing dropped)', () => {
    // Tier-2 healing that parses on its own keeps the plain outcome shape.
    const healed = completeFenceJson('{"tone"="info","content":"x"')
    expect(healed).not.toBeNull()
    expect(healed!.truncated).not.toBe(true)
    // Tier-1 outcomes never carry the flag either.
    const tier1 = repairFenceJson('{"type":"callout","tone"="info","content":"x"}')
    expect(tier1).not.toBeNull()
    expect(tier1!.truncated).not.toBe(true)
  })
})

describe('redactJsonErrorSnippet: strip the V8 body excerpt from diagnostics', () => {
  it('keeps only position and error type for V8 token errors', () => {
    // The exact V8 shape (Node 20+/Chrome): the message embeds a 20–30 char
    // quoted excerpt of the fence BODY after the error type.
    const diagnostic = '（字符 9 附近）Unexpected token \'模\', "{\"a\":模}" is not valid JSON'
    expect(redactJsonErrorSnippet(diagnostic)).toBe('（字符 9 附近）Unexpected token \'模\'')
  })

  it('removes the body excerpt from a REAL JSON.parse error', () => {
    let message = ''
    try {
      JSON.parse('{"content":"秘密正文不应外泄"} 坏')
    } catch (err) {
      message = (err as Error).message
    }
    expect(message).not.toBe('')
    const redacted = redactJsonErrorSnippet(`（字符 30 附近）${message}`)
    expect(redacted).not.toContain('秘密正文')
    expect(redacted.length).toBeGreaterThan(0)
  })

  it('passes snippet-free messages through unchanged', () => {
    expect(redactJsonErrorSnippet('Unexpected end of JSON input')).toBe('Unexpected end of JSON input')
    expect(redactJsonErrorSnippet('（字符 51 附近）Expected ',' or \'}\'' + ' after property value in JSON at position 51'))
      .toBe('（字符 51 附近）Expected ',' or \'}\'' + ' after property value in JSON at position 51')
  })

  it('falls back to a generic label when only the snippet remains', () => {
    expect(redactJsonErrorSnippet('"只有片段"')).toBe('JSON 语法错误')
  })
})

describe('repairFenceJson: string-internal commas are never trailing commas', () => {
  it('keeps a `,` inside a string value whose next char is `]` (甲,]乙)', () => {
    // The trailing-comma scan used to lack the inString guard: a `,` inside
    // "甲,]乙" was dropped as a trailing comma, silently rewriting content
    // into "甲]乙" — and the healed body still parsed, so it was ADOPTED.
    const r = repairFenceJson('{"type":"text","text":"甲,]乙","title":"t",}')
    expect(r).not.toBeNull()
    expect(JSON.parse(r!.text)).toEqual({ type: 'text', text: '甲,]乙', title: 't' })
  })

  it('keeps a `, }` inside a string value', () => {
    const r = repairFenceJson('{"type":"callout","content":"一, }二","tone":"info",}')
    expect(r).not.toBeNull()
    expect(JSON.parse(r!.text)).toEqual({ type: 'callout', content: '一, }二', tone: 'info' })
  })

  it('keeps a `,]` inside an array-element string', () => {
    const r = repairFenceJson('["a,]b",]')
    expect(r).not.toBeNull()
    expect(JSON.parse(r!.text)).toEqual(['a,]b'])
  })

  it('still drops REAL trailing commas after strings', () => {
    const r = repairFenceJson('{"a":"x",}')
    expect(r).not.toBeNull()
    expect(JSON.parse(r!.text)).toEqual({ a: 'x' })
  })

  it('agrees with completeFenceJson on the same body (tier-2 has the guard structurally)', () => {
    const body = '{"type":"text","text":"甲,]乙","title":"t",}'
    const t1 = repairFenceJson(body)
    const t2 = completeFenceJson(body)
    expect(t1).not.toBeNull()
    expect(t2).not.toBeNull()
    expect(JSON.parse(t1!.text)).toEqual(JSON.parse(t2!.text))
  })
})
