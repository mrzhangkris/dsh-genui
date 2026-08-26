// @vitest-environment jsdom
// Durable interaction state regressions:
// 1) a graded (locked) paper must restore its FULL grade after a refresh —
//    `meta` used to be dropped from persistence, so the restored submit view
//    rendered a hollow "0 / 0" with empty per-question details;
// 2) input/textarea must prefer the RESTORED user value over the spec
//    default (same precedence as select/slider) — the old order reverted
//    every refresh back to the model-authored value.
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GenuiBlock } from '../src/client/GenuiBlock.tsx'
import { loadBlockState, saveBlockState } from '../src/client/interaction-store.ts'
import type { GenuiSpec } from '../src/client/spec.ts'

beforeEach(() => {
  vi.useFakeTimers()
  localStorage.clear()
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

const paper = {
  title: '小测',
  items: [
    { type: 'radio', label: '1. 9+6=？', group: 'q1', answer: 1, explanation: '9+6=15，个位相加', options: ['14', '15', '16'] },
    { type: 'submit', label: '交卷', groups: ['q1'] },
  ],
} as unknown as GenuiSpec

function renderBlock(spec: GenuiSpec, stateKey: string) {
  return render(<GenuiBlock spec={spec} stateKey={stateKey} />)
}

describe('durable grading state', () => {
  it('persists meta together with locked and restores the full grade', async () => {
    const KEY = 'session-a::grade'
    const first = renderBlock(paper, KEY)
    const group = first.container.querySelector('[role="radiogroup"]')!
    fireEvent.click(group.querySelectorAll('input')[1]!) // 答对：15
    fireEvent.click(first.container.querySelector('[class*="submitRow"] button')!)
    expect(first.container.querySelector('[data-genui-grade]')!.textContent).toContain('1 / 1')

    // Flush the 300ms debounced save, then inspect the persisted shape.
    await act(() => vi.advanceTimersByTimeAsync(400))
    const saved = loadBlockState(KEY)
    expect(saved?.locked).toBe(true)
    expect(saved?.answers?.q1).toBe('15')
    // THE fix: meta rides along with locked.
    expect(saved?.meta?.q1?.answer).toBe(1)
    expect(saved?.meta?.q1?.explanation).toContain('个位相加')

    // Refresh simulation: a fresh mount with the same key restores the
    // graded view WITH score + explanation (pre-fix: hollow "0 / 0").
    first.unmount()
    const second = renderBlock(paper, KEY)
    const grade = second.container.querySelector('[data-genui-grade]')
    expect(grade).not.toBeNull()
    expect(grade!.textContent).toContain('1 / 1')
    expect(grade!.textContent).not.toContain('0 / 0')
    expect(grade!.textContent).toContain('9+6=15')
  })

  it('a locked restore WITHOUT meta degrades gracefully instead of crashing', () => {
    // Legacy entries written before meta persistence exist in the wild.
    saveBlockState('session-a::legacy', {
      answers: { q1: '14' },
      locked: true,
    })
    const { container } = renderBlock(paper, 'session-a::legacy')
    expect(container.querySelector('[data-genui-grade]')).not.toBeNull()
  })
})

describe('durable field value precedence (input/textarea)', () => {
  it('restored user edit wins over the spec default', async () => {
    const KEY = 'session-b::fields'
    saveBlockState(KEY, { fields: { f1: '用户输入', f2: '用户长文' } })
    const spec = {
      items: [
        { type: 'input', id: 'f1', value: '模型默认', label: '名称' },
        { type: 'textarea', id: 'f2', value: '默认文本', label: '备注' },
        { type: 'input', id: 'f3', value: '无持久化默认', label: '新字段' },
      ],
    } as unknown as GenuiSpec
    const { container } = renderBlock(spec, KEY)
    const inputs = Array.from(container.querySelectorAll('input'))
    const textarea = container.querySelector('textarea')
    // f1: durable value beats the model default (pre-fix: showed 模型默认).
    expect(inputs.find(i => (i as HTMLInputElement).value === '用户输入')).toBeDefined()
    expect(inputs.find(i => (i as HTMLInputElement).value === '模型默认')).toBeUndefined()
    // f2: same precedence for textarea.
    expect(textarea!.value).toBe('用户长文')
    // f3: no durable value → the spec default still applies.
    expect(inputs.find(i => (i as HTMLInputElement).value === '无持久化默认')).toBeDefined()

    // And the mount effect must NOT clobber the registry with defaults:
    // after the debounced save the stored values are unchanged.
    await act(() => vi.advanceTimersByTimeAsync(400))
    const saved = loadBlockState(KEY)
    expect(saved?.fields?.f1).toBe('用户输入')
    expect(saved?.fields?.f2).toBe('用户长文')
  })
})
