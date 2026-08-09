// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { GenuiBlock } from '../src/client/GenuiBlock.tsx'
import { repairGenuiSpec } from '../src/client/guard.ts'
import { mountGenui } from '../src/client/standalone.tsx'

afterEach(cleanup)

describe('learning controls', () => {
  it('repairs and renders the complete learning component pack', () => {
    const spec = repairGenuiSpec({ items: [
      { type: 'slider', label: '速度', value: 2, min: 0, max: 5, step: 1 },
      { type: 'formula', label: '勾股定理', expression: 'a^2+b^2=c^2', steps: [{ expression: 'c=\\sqrt{a^2+b^2}', explanation: '移项并开方' }] },
      { type: 'sort', prompt: '按先后排序', items: ['巡航', '点火'], answer: ['点火', '巡航'] },
      { type: 'match', prompt: '配对', pairs: [{ left: 'H₂O', right: '水' }] },
      { type: 'classify', prompt: '归类', groups: [{ label: '哺乳类', items: ['鲸'] }, { label: '鱼类', items: ['鲫鱼'] }] },
      { type: 'simulation', title: '星舟协议', steps: [{ label: '点火', content: '消耗令牌' }, { label: '巡航', content: '产生能量' }] },
    ] })
    expect(spec).not.toBeNull()
    render(<GenuiBlock spec={spec!} />)
    expect(screen.getByRole('slider')).toBeTruthy()
    expect(document.querySelector('math')).not.toBeNull()
    expect(screen.getByText('按先后排序')).toBeTruthy()
    expect(screen.getByText('配对')).toBeTruthy()
    expect(screen.getByText('哺乳类')).toBeTruthy()
    expect(screen.getByText('消耗令牌')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '播放' }))
    expect(screen.getByRole('button', { name: '暂停' })).toBeTruthy()
  })

  it('restores host state after remount', async () => {
    const spec = { items: [
      { type: 'slider', label: '速度', value: 1, min: 0, max: 5 },
      { type: 'tabs', tabs: [{ label: '一', items: [{ type: 'text', content: '甲' }] }, { label: '二', items: [{ type: 'text', content: '乙' }] }] },
      { type: 'simulation', steps: [{ label: '点火', content: 'A' }, { label: '巡航', content: 'B' }] },
    ] }
    const first = document.createElement('div')
    document.body.append(first)
    const mounted = mountGenui(first, spec)
    await waitFor(() => expect(first.querySelector('[data-genui]')).not.toBeNull())
    fireEvent.change(first.querySelector('input[type="range"]')!, { target: { value: '4' } })
    ;(first.querySelectorAll('[role="tab"]')[1] as HTMLElement).click()
    ;(first.querySelectorAll('[class*="simulationTrack"] button')[1] as HTMLElement).click()
    await waitFor(() => expect(first.querySelector('[data-genui-simulation]')?.getAttribute('data-current')).toBe('1'))
    const state = mounted.snapshot()
    mounted.dispose()
    first.remove()

    const second = document.createElement('div')
    document.body.append(second)
    const restored = mountGenui(second, spec, { initialState: state })
    await waitFor(() => expect(second.querySelector('[data-genui-simulation]')?.getAttribute('data-current')).toBe('1'))
    expect((second.querySelector('input[type="range"]') as HTMLInputElement).value).toBe('4')
    expect(second.querySelectorAll('[role="tab"]')[1]?.getAttribute('aria-selected')).toBe('true')
    restored.dispose()
    second.remove()
  })
})
