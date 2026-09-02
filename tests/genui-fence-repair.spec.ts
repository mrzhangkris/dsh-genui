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
