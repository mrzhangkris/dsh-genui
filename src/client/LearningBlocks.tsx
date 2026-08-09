import katex from 'katex'
import { useEffect, useMemo, useState, type DragEvent } from 'react'
import type {
  GenuiClassify, GenuiFormula, GenuiMatch, GenuiSimulation, GenuiSlider, GenuiSort,
} from './spec.ts'
import css from './GenuiBlock.module.css'

type Action = ((action: string, payload: Record<string, unknown>) => void) | undefined

function FormulaText({ expression }: { expression: string }) {
  const html = useMemo(() => katex.renderToString(expression, {
    displayMode: true,
    output: 'mathml',
    strict: 'ignore',
    throwOnError: false,
  }), [expression])
  return <div className={css.formulaMath} dangerouslySetInnerHTML={{ __html: html }} />
}

export function SliderNode({ node, onAction }: { node: GenuiSlider; onAction: Action }) {
  const [value, setValue] = useState(node.value)
  useEffect(() => setValue(node.value), [node.value])
  return (
    <label className={css.learningSlider} data-genui-slider>
      <span className={css.learningHead}>
        <span>{node.label}</span>
        <output>{value}{node.unit ?? ''}</output>
      </span>
      <input
        type="range"
        min={node.min}
        max={node.max}
        step={node.step ?? (node.max - node.min) / 100}
        value={value}
        onChange={event => setValue(Number(event.currentTarget.value))}
        onPointerUp={() => node.action !== undefined && onAction?.(node.action, { type: 'slider', value })}
        onKeyUp={() => node.action !== undefined && onAction?.(node.action, { type: 'slider', value })}
      />
    </label>
  )
}

export function FormulaNode({ node }: { node: GenuiFormula }) {
  const [visible, setVisible] = useState(node.steps?.length ?? 0)
  const steps = node.steps ?? []
  return (
    <section className={css.formula} data-genui-formula data-visible={visible}>
      {node.label !== undefined && <div className={css.learningTitle}>{node.label}</div>}
      <FormulaText expression={node.expression} />
      {steps.length > 0 && (
        <>
          <ol className={css.formulaSteps}>
            {steps.slice(0, visible).map((step, index) => (
              <li key={index}>
                <FormulaText expression={step.expression} />
                {step.explanation !== undefined && <p>{step.explanation}</p>}
              </li>
            ))}
          </ol>
          <div className={css.learningControls}>
            <button type="button" onClick={() => setVisible(value => Math.max(0, value - 1))} disabled={visible === 0}>上一步</button>
            <button type="button" onClick={() => setVisible(value => Math.min(steps.length, value + 1))} disabled={visible === steps.length}>下一步</button>
          </div>
        </>
      )}
    </section>
  )
}

function move<T>(items: T[], from: number, to: number): T[] {
  if (from === to || from < 0 || to < 0 || from >= items.length || to >= items.length) return items
  const next = [...items]
  const [item] = next.splice(from, 1)
  next.splice(to, 0, item!)
  return next
}

export function SortNode({ node, onAction }: { node: GenuiSort; onAction: Action }) {
  const [items, setItems] = useState(node.items)
  const [result, setResult] = useState<boolean | null>(null)
  useEffect(() => { setItems(node.items); setResult(null) }, [node.items, node.answer])
  const reorder = (from: number, to: number) => { setItems(move(items, from, to)); setResult(null) }
  const check = () => {
    const correct = items.every((item, index) => item === node.answer[index])
    setResult(correct)
    if (node.action !== undefined) onAction?.(node.action, { type: 'sort', items, correct })
  }
  return (
    <section className={css.practice} data-genui-sort>
      {node.prompt !== undefined && <div className={css.learningTitle}>{node.prompt}</div>}
      <ol className={css.sortList}>
        {items.map((item, index) => (
          <li
            key={`${item}-${index}`}
            data-item={item}
            draggable
            onDragStart={event => event.dataTransfer.setData('text/plain', String(index))}
            onDragOver={event => event.preventDefault()}
            onDrop={event => reorder(Number(event.dataTransfer.getData('text/plain')), index)}
          >
            <span className={css.dragHandle} aria-hidden>≡</span><span>{item}</span>
            <span className={css.sortButtons}>
              <button type="button" aria-label={`上移 ${item}`} onClick={() => reorder(index, index - 1)} disabled={index === 0}>↑</button>
              <button type="button" aria-label={`下移 ${item}`} onClick={() => reorder(index, index + 1)} disabled={index === items.length - 1}>↓</button>
            </span>
          </li>
        ))}
      </ol>
      <PracticeFooter result={result} onCheck={check} />
    </section>
  )
}

export function MatchNode({ node, onAction }: { node: GenuiMatch; onAction: Action }) {
  const left = node.pairs.map(pair => pair.left)
  const right = useMemo(() => node.pairs.map(pair => pair.right).reverse(), [node.pairs])
  const [matches, setMatches] = useState<Record<string, string>>({})
  const [selected, setSelected] = useState<string | null>(null)
  const [result, setResult] = useState<boolean | null>(null)
  useEffect(() => { setMatches({}); setSelected(null); setResult(null) }, [node.pairs])
  const pair = (source: string, target: string) => { setMatches({ ...matches, [source]: target }); setSelected(null); setResult(null) }
  const check = () => {
    const correct = node.pairs.every(item => matches[item.left] === item.right)
    setResult(correct)
    if (node.action !== undefined) onAction?.(node.action, { type: 'match', matches, correct })
  }
  const drop = (event: DragEvent, target: string) => pair(event.dataTransfer.getData('text/plain'), target)
  return (
    <section className={css.practice} data-genui-match>
      {node.prompt !== undefined && <div className={css.learningTitle}>{node.prompt}</div>}
      <div className={css.matchGrid}>
        <div>{left.map(item => <button key={item} type="button" draggable data-side="left" data-value={item} className={selected === item ? css.selected : ''} onClick={() => setSelected(item)} onDragStart={event => event.dataTransfer.setData('text/plain', item)}>{item}</button>)}</div>
        <div>{right.map(item => <button key={item} type="button" data-side="right" data-value={item} onDragOver={event => event.preventDefault()} onDrop={event => drop(event, item)} onClick={() => selected !== null && pair(selected, item)}>{item}<small>{Object.entries(matches).find(([, value]) => value === item)?.[0] ?? ''}</small></button>)}</div>
      </div>
      <PracticeFooter result={result} onCheck={check} />
    </section>
  )
}

export function ClassifyNode({ node, onAction }: { node: GenuiClassify; onAction: Action }) {
  const allItems = useMemo(() => node.groups.flatMap(group => group.items), [node.groups])
  const [placed, setPlaced] = useState<Record<string, string>>({})
  const [selected, setSelected] = useState<string | null>(null)
  const [result, setResult] = useState<boolean | null>(null)
  useEffect(() => { setPlaced({}); setSelected(null); setResult(null) }, [node.groups])
  const place = (item: string, group: string) => { setPlaced({ ...placed, [item]: group }); setSelected(null); setResult(null) }
  const check = () => {
    const correct = node.groups.every(group => group.items.every(item => placed[item] === group.label))
    setResult(correct)
    if (node.action !== undefined) onAction?.(node.action, { type: 'classify', groups: placed, correct })
  }
  return (
    <section className={css.practice} data-genui-classify>
      {node.prompt !== undefined && <div className={css.learningTitle}>{node.prompt}</div>}
      <div className={css.itemBank}>{allItems.filter(item => placed[item] === undefined).map(item => <button key={item} type="button" draggable data-item={item} className={selected === item ? css.selected : ''} onClick={() => setSelected(item)} onDragStart={event => event.dataTransfer.setData('text/plain', item)}>{item}</button>)}</div>
      <div className={css.classifyGrid}>
        {node.groups.map(group => (
          <div key={group.label} data-group={group.label} onDragOver={event => event.preventDefault()} onDrop={event => place(event.dataTransfer.getData('text/plain'), group.label)} onClick={() => selected !== null && place(selected, group.label)}>
            <strong>{group.label}</strong>
            {Object.entries(placed).filter(([, label]) => label === group.label).map(([item]) => <button key={item} type="button" data-item={item} onClick={event => { event.stopPropagation(); const next = { ...placed }; delete next[item]; setPlaced(next); setResult(null) }}>{item}</button>)}
          </div>
        ))}
      </div>
      <PracticeFooter result={result} onCheck={check} />
    </section>
  )
}

function PracticeFooter({ result, onCheck }: { result: boolean | null; onCheck: () => void }) {
  return <div className={css.practiceFooter}><button type="button" onClick={onCheck}>检查</button>{result !== null && <span className={result ? css.correct : css.incorrect}>{result ? '正确' : '再调整一下'}</span>}</div>
}

export function SimulationNode({ node, onAction }: { node: GenuiSimulation; onAction: Action }) {
  const [current, setCurrent] = useState(node.current ?? 0)
  const [playing, setPlaying] = useState(false)
  const last = node.steps.length - 1
  useEffect(() => { setCurrent(node.current ?? 0); setPlaying(false) }, [node.current, node.steps])
  useEffect(() => {
    if (!playing) return
    const timer = setInterval(() => setCurrent(value => {
      if (value < last) return value + 1
      if (node.loop === true) return 0
      setPlaying(false)
      return value
    }), node.intervalMs ?? 1200)
    return () => clearInterval(timer)
  }, [playing, last, node.intervalMs, node.loop])
  const setStep = (next: number) => {
    const value = Math.max(0, Math.min(last, next))
    setCurrent(value)
    if (node.action !== undefined) onAction?.(node.action, { type: 'simulation', current: value, step: node.steps[value]?.label })
  }
  const step = node.steps[current]!
  return (
    <section className={css.simulation} data-genui-simulation data-current={current} data-playing={playing}>
      {node.title !== undefined && <div className={css.learningTitle}>{node.title}</div>}
      <div className={css.simulationStage}><strong>{step.label}</strong><p>{step.content}</p></div>
      <div className={css.simulationTrack}>{node.steps.map((_, index) => <button key={index} type="button" className={index === current ? css.activeStep : ''} onClick={() => setStep(index)} aria-label={`第 ${index + 1} 步`} />)}</div>
      <div className={css.learningControls}>
        <button type="button" onClick={() => setStep(current - 1)} disabled={current === 0}>上一步</button>
        <button type="button" onClick={() => setPlaying(!playing)}>{playing ? '暂停' : '播放'}</button>
        <button type="button" onClick={() => setStep(current + 1)} disabled={current === last}>下一步</button>
      </div>
    </section>
  )
}
