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
