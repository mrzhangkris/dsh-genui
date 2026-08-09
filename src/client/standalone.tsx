import { createRoot, type Root } from 'react-dom/client'
import { GenuiBlock } from './GenuiBlock.tsx'
import { repairGenuiSpec } from './guard.ts'
import type { GenuiSpec } from './spec.ts'

export interface GenuiHostState {
  inputs?: Array<string | number | boolean>
  tabs?: number[]
  switches?: boolean[]
  accordions?: Array<number | null>
  quizzes?: Array<number | null>
  formulas?: number[]
  simulations?: number[]
}

export interface GenuiMountOptions {
  initialState?: GenuiHostState
  onAction?: (action: string, payload: Record<string, unknown>) => void
  onStateChange?: (state: GenuiHostState) => void
}

export interface GenuiMount {
  update(spec: unknown): void
  snapshot(): GenuiHostState
  dispose(): void
}

function numbers(root: Element, selector: string, attribute: string): number[] {
  return [...root.querySelectorAll(selector)].map(item => Number(item.getAttribute(attribute) ?? 0))
}

export function snapshotGenuiState(root: Element): GenuiHostState {
  const inputs = [...root.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>('input, select, textarea')]
    .filter(input => input.type !== 'radio')
    .map(input => input instanceof HTMLInputElement && (input.type === 'checkbox' || input.type === 'range')
      ? input.type === 'checkbox' ? input.checked : Number(input.value)
      : input.value)
  return {
    inputs,
    tabs: numbers(root, '[data-genui-tabs]', 'data-active'),
    switches: [...root.querySelectorAll('[role="switch"]')].map(item => item.getAttribute('aria-checked') === 'true'),
    accordions: [...root.querySelectorAll('[data-genui-accordion]')].map(item => {
      const value = item.getAttribute('data-open')
      return value === null || value === '' ? null : Number(value)
    }),
    quizzes: [...root.querySelectorAll('[data-genui-quiz]')].map(item => {
      const value = item.getAttribute('data-selected')
      return value === null || value === '' ? null : Number(value)
    }),
    formulas: numbers(root, '[data-genui-formula]', 'data-visible'),
    simulations: numbers(root, '[data-genui-simulation]', 'data-current'),
  }
}

function clickAt(nodes: NodeListOf<Element>, values: Array<number | null> | undefined, childSelector: string): void {
  values?.forEach((value, index) => {
    const parent = nodes[index]
    if (parent === undefined || value === null) return
    parent.querySelectorAll<HTMLElement>(childSelector)[value]?.click()
  })
}

export function restoreGenuiState(root: Element, state: GenuiHostState): void {
  const fields = [...root.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>('input, select, textarea')]
    .filter(input => input.type !== 'radio')
  state.inputs?.forEach((value, index) => {
    const field = fields[index]
    if (field === undefined) return
    if (field instanceof HTMLInputElement && field.type === 'checkbox') field.checked = Boolean(value)
    else field.value = String(value)
    field.dispatchEvent(new Event('input', { bubbles: true }))
    field.dispatchEvent(new Event('change', { bubbles: true }))
  })
  clickAt(root.querySelectorAll('[data-genui-tabs]'), state.tabs, '[role="tab"]')
  state.switches?.forEach((value, index) => {
    const item = root.querySelectorAll<HTMLElement>('[role="switch"]')[index]
    if (item !== undefined && (item.getAttribute('aria-checked') === 'true') !== value) item.click()
  })
  state.accordions?.forEach((value, index) => {
    const item = root.querySelectorAll('[data-genui-accordion]')[index]
    if (item === undefined) return
    const currentText = item.getAttribute('data-open')
    const current = currentText === null || currentText === '' ? null : Number(currentText)
    if (current === value) return
    const buttons = item.querySelectorAll<HTMLElement>('button[aria-expanded]')
    if (value === null) buttons[current ?? -1]?.click()
    else buttons[value]?.click()
  })
  clickAt(root.querySelectorAll('[data-genui-quiz]'), state.quizzes, 'button:not([class*="Retry"])')
  state.formulas?.forEach((value, index) => {
    const item = root.querySelectorAll('[data-genui-formula]')[index]
    if (item === undefined) return
    const current = Number(item.getAttribute('data-visible') ?? 0)
    const buttons = item.querySelectorAll<HTMLElement>('button')
    const button = value > current ? buttons[1] : buttons[0]
    for (let count = 0; button !== undefined && count < Math.abs(value - current); count += 1) button.click()
  })
  clickAt(root.querySelectorAll('[data-genui-simulation]'), state.simulations, '[class*="simulationTrack"] button')
}

export function mountGenui(target: HTMLElement, rawSpec: unknown, options: GenuiMountOptions = {}): GenuiMount {
  const root: Root = createRoot(target)
  let spec: GenuiSpec | null = repairGenuiSpec(rawSpec)
  let savedState = options.initialState
  let observer: MutationObserver | null = null
  let notifyTimer: ReturnType<typeof setTimeout> | undefined
  const notify = (): void => {
    if (options.onStateChange === undefined) return
    if (notifyTimer !== undefined) clearTimeout(notifyTimer)
    notifyTimer = setTimeout(() => {
      savedState = snapshotGenuiState(target)
      options.onStateChange?.(savedState)
    }, 80)
  }
  const render = (): void => {
    root.render(spec === null ? null : <GenuiBlock spec={spec} onAction={options.onAction} />)
    setTimeout(() => {
      if (savedState !== undefined) restoreGenuiState(target, savedState)
      observer ??= new MutationObserver(notify)
      observer.observe(target, { attributes: true, childList: true, subtree: true })
      target.addEventListener('input', notify)
      target.addEventListener('change', notify)
      target.addEventListener('click', notify)
    })
  }
  render()
  return {
    update(next) { savedState = snapshotGenuiState(target); spec = repairGenuiSpec(next); render() },
    snapshot() { return snapshotGenuiState(target) },
    dispose() {
      observer?.disconnect()
      if (notifyTimer !== undefined) clearTimeout(notifyTimer)
      target.removeEventListener('input', notify)
      target.removeEventListener('change', notify)
      target.removeEventListener('click', notify)
      root.unmount()
    },
  }
}
