// SafeMath regression: the number lexer used to scan `[0-9.eE+\-]`
// greedily, so a BINARY +/- directly after a number was swallowed into the
// literal ("2+1" → Number("2+1")=NaN → parse error). Every spaceless plot
// expression like `x^2+1` failed and rendered an empty chart.
import { describe, expect, it } from 'vitest'
import { compileMathExpr, sampleExpr } from '../src/client/safe-math.ts'

describe('SafeMath: binary +/- adjacent to number literals', () => {
  it('parses spaceless expressions like x^2+1', () => {
    const fn = compileMathExpr('x^2+1')
    expect(fn).not.toBeNull()
    expect(fn!(0)).toBe(1)
    expect(fn!(2)).toBe(5)
    expect(fn!(-3)).toBe(10)
  })

  it('parses chained spaceless operators like sin(x)*2+1', () => {
    const fn = compileMathExpr('sin(x)*2+1')
    expect(fn).not.toBeNull()
    expect(fn!(Math.PI / 2)).toBeCloseTo(3)
    // End-to-end through the sampler: pre-fix this returned zero points.
    const pts = sampleExpr('sin(x)*2+1', -6, 6, 50)
    expect(pts.length).toBe(50)
  })

  it('subtraction without spaces works too', () => {
    expect(compileMathExpr('x^2 - 1')!(3)).toBe(8)
    expect(compileMathExpr('10-x')!(4)).toBe(6)
  })

  it('keeps exponent notation and unary minus working', () => {
    expect(compileMathExpr('1e-2*x')!(100)).toBeCloseTo(1)
    expect(compileMathExpr('2E+3')!(0)).toBe(2000)
    expect(compileMathExpr('-x+1')!(3)).toBe(-2)
    expect(compileMathExpr('x*-2')!(3)).toBe(-6)
    expect(compileMathExpr('.5*x+2')!(2)).toBe(3)
  })

  it('still rejects malformed input and non-whitelisted identifiers', () => {
    expect(compileMathExpr('2+')).toBeNull()
    expect(compileMathExpr('2..1')).toBeNull()
    expect(compileMathExpr('constructor()')).toBeNull()
    expect(compileMathExpr('toString()')).toBeNull()
    expect(compileMathExpr('eval("1")')).toBeNull()
  })
})
