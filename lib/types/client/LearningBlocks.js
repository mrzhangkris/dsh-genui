import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import katex from 'katex';
import { useEffect, useMemo, useState } from 'react';
import css from './GenuiBlock.module.css';
function FormulaText({ expression }) {
    const html = useMemo(() => katex.renderToString(expression, {
        displayMode: true,
        output: 'mathml',
        strict: 'ignore',
        throwOnError: false,
    }), [expression]);
    return _jsx("div", { className: css.formulaMath, dangerouslySetInnerHTML: { __html: html } });
}
export function SliderNode({ node, onAction }) {
    const [value, setValue] = useState(node.value);
    useEffect(() => setValue(node.value), [node.value]);
    return (_jsxs("label", { className: css.learningSlider, "data-genui-slider": true, children: [_jsxs("span", { className: css.learningHead, children: [_jsx("span", { children: node.label }), _jsxs("output", { children: [value, node.unit ?? ''] })] }), _jsx("input", { type: "range", min: node.min, max: node.max, step: node.step ?? (node.max - node.min) / 100, value: value, onChange: event => setValue(Number(event.currentTarget.value)), onPointerUp: () => node.action !== undefined && onAction?.(node.action, { type: 'slider', value }), onKeyUp: () => node.action !== undefined && onAction?.(node.action, { type: 'slider', value }) })] }));
}
export function FormulaNode({ node }) {
    const [visible, setVisible] = useState(node.steps?.length ?? 0);
    const steps = node.steps ?? [];
    return (_jsxs("section", { className: css.formula, "data-genui-formula": true, "data-visible": visible, children: [node.label !== undefined && _jsx("div", { className: css.learningTitle, children: node.label }), _jsx(FormulaText, { expression: node.expression }), steps.length > 0 && (_jsxs(_Fragment, { children: [_jsx("ol", { className: css.formulaSteps, children: steps.slice(0, visible).map((step, index) => (_jsxs("li", { children: [_jsx(FormulaText, { expression: step.expression }), step.explanation !== undefined && _jsx("p", { children: step.explanation })] }, index))) }), _jsxs("div", { className: css.learningControls, children: [_jsx("button", { type: "button", onClick: () => setVisible(value => Math.max(0, value - 1)), disabled: visible === 0, children: "\u4E0A\u4E00\u6B65" }), _jsx("button", { type: "button", onClick: () => setVisible(value => Math.min(steps.length, value + 1)), disabled: visible === steps.length, children: "\u4E0B\u4E00\u6B65" })] })] }))] }));
}
function move(items, from, to) {
    if (from === to || from < 0 || to < 0 || from >= items.length || to >= items.length)
        return items;
    const next = [...items];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
    return next;
}
export function SortNode({ node, onAction }) {
    const [items, setItems] = useState(node.items);
    const [result, setResult] = useState(null);
    useEffect(() => { setItems(node.items); setResult(null); }, [node.items, node.answer]);
    const reorder = (from, to) => { setItems(move(items, from, to)); setResult(null); };
    const check = () => {
        const correct = items.every((item, index) => item === node.answer[index]);
        setResult(correct);
        if (node.action !== undefined)
            onAction?.(node.action, { type: 'sort', items, correct });
    };
    return (_jsxs("section", { className: css.practice, "data-genui-sort": true, children: [node.prompt !== undefined && _jsx("div", { className: css.learningTitle, children: node.prompt }), _jsx("ol", { className: css.sortList, children: items.map((item, index) => (_jsxs("li", { "data-item": item, draggable: true, onDragStart: event => event.dataTransfer.setData('text/plain', String(index)), onDragOver: event => event.preventDefault(), onDrop: event => reorder(Number(event.dataTransfer.getData('text/plain')), index), children: [_jsx("span", { className: css.dragHandle, "aria-hidden": true, children: "\u2261" }), _jsx("span", { children: item }), _jsxs("span", { className: css.sortButtons, children: [_jsx("button", { type: "button", "aria-label": `上移 ${item}`, onClick: () => reorder(index, index - 1), disabled: index === 0, children: "\u2191" }), _jsx("button", { type: "button", "aria-label": `下移 ${item}`, onClick: () => reorder(index, index + 1), disabled: index === items.length - 1, children: "\u2193" })] })] }, `${item}-${index}`))) }), _jsx(PracticeFooter, { result: result, onCheck: check })] }));
}
export function MatchNode({ node, onAction }) {
    const left = node.pairs.map(pair => pair.left);
    const right = useMemo(() => node.pairs.map(pair => pair.right).reverse(), [node.pairs]);
    const [matches, setMatches] = useState({});
    const [selected, setSelected] = useState(null);
    const [result, setResult] = useState(null);
    useEffect(() => { setMatches({}); setSelected(null); setResult(null); }, [node.pairs]);
    const pair = (source, target) => { setMatches({ ...matches, [source]: target }); setSelected(null); setResult(null); };
    const check = () => {
        const correct = node.pairs.every(item => matches[item.left] === item.right);
        setResult(correct);
        if (node.action !== undefined)
            onAction?.(node.action, { type: 'match', matches, correct });
    };
    const drop = (event, target) => pair(event.dataTransfer.getData('text/plain'), target);
    return (_jsxs("section", { className: css.practice, "data-genui-match": true, children: [node.prompt !== undefined && _jsx("div", { className: css.learningTitle, children: node.prompt }), _jsxs("div", { className: css.matchGrid, children: [_jsx("div", { children: left.map(item => _jsx("button", { type: "button", draggable: true, "data-side": "left", "data-value": item, className: selected === item ? css.selected : '', onClick: () => setSelected(item), onDragStart: event => event.dataTransfer.setData('text/plain', item), children: item }, item)) }), _jsx("div", { children: right.map(item => _jsxs("button", { type: "button", "data-side": "right", "data-value": item, onDragOver: event => event.preventDefault(), onDrop: event => drop(event, item), onClick: () => selected !== null && pair(selected, item), children: [item, _jsx("small", { children: Object.entries(matches).find(([, value]) => value === item)?.[0] ?? '' })] }, item)) })] }), _jsx(PracticeFooter, { result: result, onCheck: check })] }));
}
export function ClassifyNode({ node, onAction }) {
    const allItems = useMemo(() => node.groups.flatMap(group => group.items), [node.groups]);
    const [placed, setPlaced] = useState({});
    const [selected, setSelected] = useState(null);
    const [result, setResult] = useState(null);
    useEffect(() => { setPlaced({}); setSelected(null); setResult(null); }, [node.groups]);
    const place = (item, group) => { setPlaced({ ...placed, [item]: group }); setSelected(null); setResult(null); };
    const check = () => {
        const correct = node.groups.every(group => group.items.every(item => placed[item] === group.label));
        setResult(correct);
        if (node.action !== undefined)
            onAction?.(node.action, { type: 'classify', groups: placed, correct });
    };
    return (_jsxs("section", { className: css.practice, "data-genui-classify": true, children: [node.prompt !== undefined && _jsx("div", { className: css.learningTitle, children: node.prompt }), _jsx("div", { className: css.itemBank, children: allItems.filter(item => placed[item] === undefined).map(item => _jsx("button", { type: "button", draggable: true, "data-item": item, className: selected === item ? css.selected : '', onClick: () => setSelected(item), onDragStart: event => event.dataTransfer.setData('text/plain', item), children: item }, item)) }), _jsx("div", { className: css.classifyGrid, children: node.groups.map(group => (_jsxs("div", { "data-group": group.label, onDragOver: event => event.preventDefault(), onDrop: event => place(event.dataTransfer.getData('text/plain'), group.label), onClick: () => selected !== null && place(selected, group.label), children: [_jsx("strong", { children: group.label }), Object.entries(placed).filter(([, label]) => label === group.label).map(([item]) => _jsx("button", { type: "button", "data-item": item, onClick: event => { event.stopPropagation(); const next = { ...placed }; delete next[item]; setPlaced(next); setResult(null); }, children: item }, item))] }, group.label))) }), _jsx(PracticeFooter, { result: result, onCheck: check })] }));
}
function PracticeFooter({ result, onCheck }) {
    return _jsxs("div", { className: css.practiceFooter, children: [_jsx("button", { type: "button", onClick: onCheck, children: "\u68C0\u67E5" }), result !== null && _jsx("span", { className: result ? css.correct : css.incorrect, children: result ? '正确' : '再调整一下' })] });
}
export function SimulationNode({ node, onAction }) {
    const [current, setCurrent] = useState(node.current ?? 0);
    const [playing, setPlaying] = useState(false);
    const last = node.steps.length - 1;
    useEffect(() => { setCurrent(node.current ?? 0); setPlaying(false); }, [node.current, node.steps]);
    useEffect(() => {
        if (!playing)
            return;
        const timer = setInterval(() => setCurrent(value => {
            if (value < last)
                return value + 1;
            if (node.loop === true)
                return 0;
            setPlaying(false);
            return value;
        }), node.intervalMs ?? 1200);
        return () => clearInterval(timer);
    }, [playing, last, node.intervalMs, node.loop]);
    const setStep = (next) => {
        const value = Math.max(0, Math.min(last, next));
        setCurrent(value);
        if (node.action !== undefined)
            onAction?.(node.action, { type: 'simulation', current: value, step: node.steps[value]?.label });
    };
    const step = node.steps[current];
    return (_jsxs("section", { className: css.simulation, "data-genui-simulation": true, "data-current": current, "data-playing": playing, children: [node.title !== undefined && _jsx("div", { className: css.learningTitle, children: node.title }), _jsxs("div", { className: css.simulationStage, children: [_jsx("strong", { children: step.label }), _jsx("p", { children: step.content })] }), _jsx("div", { className: css.simulationTrack, children: node.steps.map((_, index) => _jsx("button", { type: "button", className: index === current ? css.activeStep : '', onClick: () => setStep(index), "aria-label": `第 ${index + 1} 步` }, index)) }), _jsxs("div", { className: css.learningControls, children: [_jsx("button", { type: "button", onClick: () => setStep(current - 1), disabled: current === 0, children: "\u4E0A\u4E00\u6B65" }), _jsx("button", { type: "button", onClick: () => setPlaying(!playing), children: playing ? '暂停' : '播放' }), _jsx("button", { type: "button", onClick: () => setStep(current + 1), disabled: current === last, children: "\u4E0B\u4E00\u6B65" })] })] }));
}
//# sourceMappingURL=LearningBlocks.js.map