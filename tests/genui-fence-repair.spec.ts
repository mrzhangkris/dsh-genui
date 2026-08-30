// Fence JSON auto-repair: models writing HTML-style `key="value"` produce
// `"key"="value"` which is invalid JSON (the separator must be `:`). Both
// repair tiers must heal it — tier-1 alone, and tier-2 folded with a missing
// closer — and never adopt garbage.
import { describe, expect, it } from 'vitest'
import { completeFenceJson, repairFenceJson } from '../src/shared/fence-repair.ts'

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
