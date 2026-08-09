import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
/**
 * GenuiBlock: renders a declarative GenUI spec (from a ```dsh-ui fence in an
 * assistant reply) as real interactive components inline in the conversation.
 * The component tree is white-listed and mapped to DOM directly — no raw HTML.
 * v1 interactivity is client-side only (buttons, tabs, checkboxes, and inputs
 * are operable; events do not flow back to the model).
 */
import { memo, useEffect, useId, useMemo, useRef, useState } from 'react';
import { DiffBlock, JsonTree, CodeBlock } from '@deepseek-ai/dsh-client-ui-primitives';
import { useGenuiAction, getGenuiComponent } from '@deepseek-ai/dsh-client-ui-primitives';
import { GENUI_LIMITS } from "./guard.js";
import { ClassifyNode, FormulaNode, MatchNode, SimulationNode, SliderNode, SortNode } from "./LearningBlocks.js";
import { PlotBlock } from "./PlotBlock.js";
import css from './GenuiBlock.module.css';
/** Deterministic avatar color by name hash. */
const AVATAR_COLORS = ['#4f8ef7', '#5b8def', '#3d9e8f', '#c9a24b', '#c96a5b', '#8a7bb8', '#6b8fa3', '#7d9e6b'];
/** Categorical palette for multi-series charts: muted, dark-theme friendly,
 * high separation (not a rainbow). Single series keep the brand accent. */
const CHART_COLORS = ['#4f8ef7', '#3ecf8e', '#e0a458', '#e07b6a', '#9a86d8', '#5cb8b8', '#d487b6', '#8aaa6e'];
/** Series color: explicit color wins; multi-series auto-assign from the palette. */
const seriesColor = (i, n, c) => c ?? (n > 1 ? CHART_COLORS[i % CHART_COLORS.length] : undefined);
function avatarColor(name) {
    let h = 0;
    for (let i = 0; i < name.length; i++)
        h = (h * 31 + name.charCodeAt(i)) >>> 0;
    // The array is a literal with 8 entries; the index is always in range.
    return AVATAR_COLORS[h % AVATAR_COLORS.length];
}
function renderNode(node, key, onAction, depth = 0) {
    // Depth guard: a pathological spec must never recurse past the limit
    // (stack overflow / DOM explosion). The fence path already repairs specs
    // against the same limit; this is the belt-and-suspenders for direct
    // GenuiBlock use and plugin-registered custom renderers.
    if (depth > GENUI_LIMITS.maxDepth)
        return null;
    switch (node.type) {
        case 'text': {
            const size = node.size ?? 'body';
            return (_jsx("div", { className: `${css.text} ${css[size]}` + (node.center ? ` ${css.center}` : ''), children: node.content }, key));
        }
        case 'row': {
            return (_jsxs("div", { className: css.row + (node.wrap ? ` ${css.wrap}` : ''), children: [node.items.map((c, i) => renderNode(c, i, onAction, depth + 1)), node.spacer && _jsx("div", { className: css.spacer })] }, key));
        }
        case 'col': {
            return (_jsx("div", { className: css.col, style: node.gap !== undefined ? { gap: `${node.gap}px` } : undefined, children: node.items.map((c, i) => renderNode(c, i, onAction, depth + 1)) }, key));
        }
        case 'grid': {
            return (_jsx("div", { className: css.grid, style: { gridTemplateColumns: `repeat(${Math.max(1, node.cols)}, 1fr)` }, children: node.items.map((c, i) => renderNode(c, i, onAction, depth + 1)) }, key));
        }
        case 'card': {
            return (_jsxs("div", { className: css.card, children: [node.title !== undefined && _jsx("div", { className: css.cardTitle, children: node.title }), node.items.map((c, i) => renderNode(c, i, onAction, depth + 1))] }, key));
        }
        case 'button': {
            const tone = node.tone ?? '';
            const cls = `${css.button} ${css[tone] || ''}` + (node.full ? ` ${css.full}` : '') + (node.small ? ` ${css.small}` : '');
            const action = node.action;
            return (_jsxs("button", { type: "button", className: cls, onClick: action !== undefined && onAction !== undefined
                    ? () => onAction(action, { type: 'button', label: node.label })
                    : undefined, children: [node.icon !== undefined && _jsxs("span", { "aria-hidden": true, children: [node.icon, " "] }), node.label] }, key));
        }
        case 'input': {
            const action = node.action;
            return (_jsxs("label", { className: css.field, children: [node.label !== undefined && _jsx("span", { children: node.label }), _jsx("input", { className: css.input, type: node.inputType ?? 'text', placeholder: node.placeholder, defaultValue: node.value, onBlur: action !== undefined && onAction !== undefined
                            ? e => onAction(action, { type: 'input', value: e.currentTarget.value })
                            : undefined })] }, key));
        }
        case 'select': {
            const action = node.action;
            return (_jsxs("label", { className: css.field, children: [node.label !== undefined && _jsx("span", { children: node.label }), _jsx("select", { className: css.select, onChange: action !== undefined && onAction !== undefined
                            ? e => onAction(action, { type: 'select', value: e.currentTarget.value })
                            : undefined, children: node.options.slice(0, GENUI_LIMITS.maxOptions).map((o, i) => _jsx("option", { children: o }, i)) })] }, key));
        }
        case 'checkbox': {
            const action = node.action;
            return (_jsxs("label", { className: css.checkbox, children: [_jsx("input", { type: "checkbox", defaultChecked: node.checked === true, onChange: action !== undefined && onAction !== undefined
                            ? e => onAction(action, { type: 'checkbox', checked: e.currentTarget.checked })
                            : undefined }), _jsx("span", { children: node.label })] }, key));
        }
        case 'link': {
            return _jsx("button", { type: "button", className: css.link, children: node.label }, key);
        }
        case 'badge': {
            const tone = node.tone ?? '';
            return (_jsxs("span", { className: `${css.badge} ${css[tone] || ''}`, children: [node.icon !== undefined && _jsxs("span", { "aria-hidden": true, children: [node.icon, " "] }), node.label] }, key));
        }
        case 'stat': {
            const down = node.delta !== undefined && node.delta.startsWith('-');
            return (_jsxs("div", { className: css.stat, children: [_jsx("span", { className: css.statLabel, children: node.label }), _jsx("span", { className: css.statValue, children: node.value }), node.delta !== undefined && _jsx("span", { className: `${css.statDelta} ${down ? css.down : css.up}`, children: node.delta })] }, key));
        }
        case 'progress': {
            const v = Math.max(0, Math.min(100, Number(node.value) || 0));
            return (_jsxs("div", { className: css.progress, role: "progressbar", "aria-valuemin": 0, "aria-valuemax": 100, "aria-valuenow": v, "aria-label": node.label ?? node.valueLabel ?? undefined, children: [(node.label !== undefined || node.valueLabel !== undefined) && (_jsxs("div", { className: css.progressRow, children: [_jsx("span", { children: node.label }), node.valueLabel !== undefined && _jsx("span", { children: node.valueLabel })] })), _jsx("div", { className: css.track, children: _jsx("div", { className: css.fill, style: { width: `${v}%` } }) })] }, key));
        }
        case 'divider': return _jsx("hr", { className: css.divider }, key);
        case 'list': {
            const items = node.items.slice(0, GENUI_LIMITS.maxListItems);
            return (_jsx("div", { className: css.list, children: items.map((item, i) => (_jsx("div", { className: css.li, children: typeof item === 'string'
                        ? _jsx("span", { className: css.liTitle, children: item })
                        : _jsxs(_Fragment, { children: [_jsx("span", { className: css.liTitle, children: item.title }), item.desc !== undefined && _jsx("span", { className: css.liDesc, children: item.desc })] }) }, i))) }, key));
        }
        case 'table': {
            const columns = node.columns.slice(0, GENUI_LIMITS.maxTableCols);
            const rows = node.rows.slice(0, GENUI_LIMITS.maxTableRows);
            return (_jsx("div", { className: css.tableWrap, children: _jsxs("table", { className: css.table, children: [_jsx("thead", { children: _jsx("tr", { children: columns.map((c, i) => _jsx("th", { children: c }, i)) }) }), _jsx("tbody", { children: rows.map((row, i) => (_jsx("tr", { children: row.slice(0, columns.length).map((cell, j) => _jsx("td", { children: String(cell) }, j)) }, i))) })] }) }, key));
        }
        case 'chart': return _jsx(ChartNode, { chart: node }, key);
        case 'tabs': return _jsx(TabsNode, { tabs: node, onAction: onAction, depth: depth + 1 }, key);
        case 'avatar': {
            return (_jsx("div", { className: css.avatar, style: { background: node.color ?? avatarColor(node.name) }, children: node.name.slice(0, 1).toUpperCase() }, key));
        }
        case 'spacer': return _jsx("div", { className: css.spacer }, key);
        case 'plot': return _jsx(PlotNode, { plot: node }, key);
        case 'callout': return _jsx(CalloutNode, { node: node }, key);
        case 'steps': return _jsx(StepsNode, { steps: node }, key);
        case 'keyvalue': return _jsx(KeyValueNode, { node: node }, key);
        case 'diff': return _jsx(DiffNode, { node: node }, key);
        case 'json': return _jsx(JsonNode, { node: node }, key);
        case 'code': return _jsx(CodeNode, { node: node }, key);
        case 'radio': return _jsx(RadioNode, { node: node, onAction: onAction }, key);
        case 'switch': return _jsx(SwitchNode, { node: node, onAction: onAction }, key);
        case 'textarea': return _jsx(TextareaNode, { node: node }, key);
        case 'accordion': return _jsx(AccordionNode, { node: node, onAction: onAction, depth: depth + 1 }, key);
        case 'copy': return _jsx(CopyNode, { node: node }, key);
        case 'mermaid': return _jsx(MermaidNode, { node: node }, key);
        case 'scene3d': return _jsx(Scene3DNode, { node: node }, key);
        case 'timeline': return _jsx(TimelineNode, { node: node }, key);
        case 'file-tree': return _jsx(FileTreeNode, { node: node }, key);
        case 'breadcrumb': return _jsx(BreadcrumbNode, { node: node }, key);
        case 'quiz': return _jsx(QuizNode, { node: node }, key);
        case 'slider': return _jsx(SliderNode, { node: node, onAction: onAction }, key);
        case 'formula': return _jsx(FormulaNode, { node: node }, key);
        case 'sort': return _jsx(SortNode, { node: node, onAction: onAction }, key);
        case 'match': return _jsx(MatchNode, { node: node, onAction: onAction }, key);
        case 'classify': return _jsx(ClassifyNode, { node: node, onAction: onAction }, key);
        case 'simulation': return _jsx(SimulationNode, { node: node, onAction: onAction }, key);
        default: {
            // Plugin-registered custom types: a plugin ships a renderer through
            // registerGenuiComponent; unregistered unknowns render nothing. The
            // spec union is exhaustive, so an unknown node arrives as a plugin
            // extension — treat it as a generic data node.
            const custom = node;
            const Custom = getGenuiComponent(custom.type);
            if (Custom !== undefined) {
                return (_jsx(Custom, { node: custom, onAction: onAction, renderChildren: (nodes, base) => nodes.map((c, i) => renderNode(c, Number(base) + i, onAction, depth + 1)) }, key));
            }
            return null;
        }
    }
}
/* ---------------- v1.1 nodes ---------------- */
const CALLOUT_TONES = {
    info: css.calloutInfo, success: css.calloutSuccess, warning: css.calloutWarning, error: css.calloutError,
};
/** Callout: a tinted notice box with an optional heading. */
function CalloutNode({ node }) {
    const tone = node.tone ?? 'info';
    const toneClass = CALLOUT_TONES[tone] ?? css.calloutInfo;
    return (_jsxs("div", { className: `${css.callout} ${toneClass}`, "data-genui-callout": true, children: [node.title !== undefined && _jsx("div", { className: css.calloutTitle, children: node.title }), _jsx("div", { className: css.calloutBody, children: node.content })] }));
}
/** Steps: a vertical progress checklist with an optional current index. */
function StepsNode({ steps }) {
    const list = steps.steps.slice(0, GENUI_LIMITS.maxSteps);
    const current = steps.current ?? list.length;
    return (_jsx("ol", { className: css.steps, children: list.map((step, i) => {
            const done = i < current;
            const active = i === current;
            return (_jsxs("li", { className: `${css.step} ${done ? css.stepDone : ''} ${active ? css.stepActive : ''}`, children: [_jsx("span", { className: css.stepMarker, children: done ? '✓' : String(i + 1) }), _jsxs("span", { className: css.stepContent, children: [_jsx("span", { className: css.stepTitle, children: step.title }), step.desc !== undefined && _jsx("span", { className: css.stepDesc, children: step.desc })] })] }, i));
        }) }));
}
/** KeyValue: a definition list for configs and metadata. */
function KeyValueNode({ node }) {
    const pairs = node.pairs.slice(0, GENUI_LIMITS.maxKeyValuePairs);
    return (_jsx("dl", { className: css.keyvalue, children: pairs.map((pair, i) => (_jsxs("div", { className: css.kvRow, children: [_jsx("dt", { className: css.kvKey, children: pair.key }), _jsx("dd", { className: css.kvValue, children: pair.value })] }, i))) }));
}
/** Plot: SVG function plot over the SafeMath evaluator. */
function PlotNode({ plot }) {
    const series = plot.series.slice(0, GENUI_LIMITS.maxPlotSeries);
    return (_jsx(PlotBlock, { series: series.map(s => ({ expr: s.expr, label: s.label, color: s.color, params: s.params })), xMin: plot.xMin, xMax: plot.xMax, yMin: plot.yMin, yMax: plot.yMax, title: plot.title }));
}
/** Diff: 收编 dsh DiffBlock (same path/oldText/newText shape as DiffHunk). */
function DiffNode({ node }) {
    return _jsx(DiffBlock, { diffs: node.diffs });
}
/** Json: 收编 dsh JsonTree. */
function JsonNode({ node }) {
    const data = node.value;
    if (typeof data !== 'object' || data === null) {
        return _jsx("div", { className: css.jsonScalar, children: String(data) });
    }
    return _jsx(JsonTree, { data: data, copyable: true });
}
/** Code: 收编 dsh CodeBlock with explicit language. */
function CodeNode({ node }) {
    return _jsx(CodeBlock, { code: node.code.slice(0, GENUI_LIMITS.maxCode), lang: node.lang });
}
/** Chart: bars (default), line (trend), or donut (share); multi-series bars via `series`. */
function ChartNode({ chart }) {
    const kind = chart.kind ?? 'bars';
    if (kind === 'donut')
        return _jsx(DonutNode, { chart: chart });
    if (kind === 'line')
        return _jsx(LineChartNode, { chart: chart });
    return _jsx(BarsNode, { chart: chart });
}
/** Bars: one column per datum (grouped bars when `series` is present). */
function BarsNode({ chart }) {
    const grouped = chart.series !== undefined ? chart.series.slice(0, GENUI_LIMITS.maxPlotSeries) : undefined;
    if (grouped !== undefined && grouped.length > 0) {
        const labels = grouped[0].data.map(d => d.label);
        const max = Math.max(...grouped.flatMap(s => s.data.map(d => Number(d.value) || 0)), 1);
        return (_jsx("div", { className: css.chart, children: labels.map((label, i) => (_jsxs("div", { className: css.barCol, children: [_jsx("div", { className: css.groupedBars, children: grouped.map((s, si) => {
                            const d = s.data[i];
                            const h = d === undefined ? 0 : Math.round((Number(d.value) / max) * 100);
                            return (_jsx("div", { className: css.groupedFill, style: {
                                    height: `${h}%`,
                                    background: seriesColor(si, grouped.length, s.color) ?? 'var(--dsw-alias-state-business-primary, #4f8ef7)',
                                }, title: s.label }, si));
                        }) }), _jsx("span", { className: css.barLabel, children: label })] }, i))) }));
    }
    const data = chart.data.slice(0, GENUI_LIMITS.maxChartPoints);
    const max = Math.max(...data.map(d => Number(d.value) || 0), 1);
    return (_jsx("div", { className: css.chart, children: data.map((d, i) => {
            const h = Math.round((Number(d.value) / max) * 100);
            return (_jsxs("div", { className: css.barCol, children: [_jsx("span", { className: css.barValue, children: String(d.value) }), _jsx("div", { className: css.barFill, style: { height: `${h}%`, ...(d.color !== undefined ? { background: d.color } : {}) } }), _jsx("span", { className: css.barLabel, children: d.label })] }, i));
        }) }));
}
/** Line: polyline over a fixed-height plot area. */
function LineChartNode({ chart }) {
    const data = chart.data.slice(0, GENUI_LIMITS.maxChartPoints);
    const W = 460;
    const H = 140;
    const pad = 8;
    const max = Math.max(...data.map(d => Number(d.value) || 0), 1);
    const min = Math.min(...data.map(d => Number(d.value) || 0), 0);
    const span = max - min || 1;
    const n = Math.max(data.length - 1, 1);
    const pt = (i, v) => [
        pad + (i / n) * (W - pad * 2),
        pad + (1 - (v - min) / span) * (H - pad * 2),
    ];
    const d = data.map((datum, i) => pt(i, Number(datum.value) || 0));
    const path = d.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(' ');
    return (_jsxs("div", { className: css.lineChart, children: [_jsxs("svg", { width: "100%", viewBox: `0 0 ${W} ${H}`, children: [data.map((datum, i) => {
                        const [x, y] = pt(i, Number(datum.value) || 0);
                        return _jsx("circle", { cx: x, cy: y, r: 3, className: css.lineDot, fill: datum.color ?? undefined }, i);
                    }), _jsx("path", { d: path, className: css.linePath })] }), _jsx("div", { className: css.lineLabels, children: data.map((d, i) => _jsx("span", { className: css.barLabel, children: d.label }, i)) })] }));
}
/** Donut: share of total with a center total. */
function DonutNode({ chart }) {
    const data = chart.data.slice(0, GENUI_LIMITS.maxChartPoints);
    const total = data.reduce((s, d) => s + (Number(d.value) || 0), 0) || 1;
    const R = 42;
    const C = 2 * Math.PI * R;
    let offset = 0;
    return (_jsxs("div", { className: css.donut, children: [_jsxs("svg", { width: "120", height: "120", viewBox: "0 0 120 120", children: [_jsx("circle", { cx: "60", cy: "60", r: R, fill: "none", strokeWidth: "14", className: css.donutTrack }), data.map((d, i) => {
                        const frac = (Number(d.value) || 0) / total;
                        const len = frac * C;
                        const el = (_jsx("circle", { cx: "60", cy: "60", r: R, fill: "none", strokeWidth: "14", stroke: seriesColor(i, data.length, d.color) ?? 'var(--dsw-alias-state-business-primary, #4f8ef7)', strokeDasharray: `${len} ${C - len}`, strokeDashoffset: -offset, transform: "rotate(-90 60 60)" }, i));
                        offset += len;
                        return el;
                    }), _jsx("text", { x: "60", y: "58", textAnchor: "middle", className: css.donutTotal, children: total >= 1000 ? `${Math.round(total / 100) / 10}k` : String(total) }), _jsx("text", { x: "60", y: "74", textAnchor: "middle", className: css.donutTotalLabel, children: "\u5408\u8BA1" })] }), _jsx("div", { className: css.donutLegend, children: data.map((d, i) => (_jsxs("span", { className: css.legendItem, children: [_jsx("span", { className: css.legendSwatch, style: { background: seriesColor(i, data.length, d.color) ?? 'var(--dsw-alias-state-business-primary, #4f8ef7)' } }), d.label, " \u00B7 ", String(d.value)] }, i))) })] }));
}
/** Tab strip with local active-tab state. Keyboard: ArrowLeft/Right to move,
 * Home/End to jump; ids wired via useId so `aria-controls` stays unique
 * across fences and sessions. */
function TabsNode({ tabs, onAction, depth = 0 }) {
    const [active, setActive] = useState(0);
    const uid = useId();
    const list = tabs.tabs.slice(0, GENUI_LIMITS.maxTabs);
    const current = list[active];
    const move = (next) => {
        const n = (next + list.length) % list.length;
        setActive(n);
        document.getElementById(`${uid}-tab-${n}`)?.focus();
    };
    return (_jsxs("div", { className: css.tabs, "data-genui-tabs": true, "data-active": active, children: [_jsx("div", { className: css.tabBar, role: "tablist", "aria-orientation": "horizontal", onKeyDown: e => {
                    if (e.key === 'ArrowRight') {
                        e.preventDefault();
                        move(active + 1);
                    }
                    else if (e.key === 'ArrowLeft') {
                        e.preventDefault();
                        move(active - 1);
                    }
                    else if (e.key === 'Home') {
                        e.preventDefault();
                        move(0);
                    }
                    else if (e.key === 'End') {
                        e.preventDefault();
                        move(list.length - 1);
                    }
                }, children: list.map((tab, i) => (_jsx("button", { id: `${uid}-tab-${i}`, type: "button", role: "tab", "aria-selected": i === active, "aria-controls": `${uid}-panel-${i}`, tabIndex: i === active ? 0 : -1, className: `${css.tab} ${i === active ? css.tabActive : ''}`, onClick: () => setActive(i), children: tab.label }, i))) }), current !== undefined && (_jsx("div", { className: css.col, role: "tabpanel", id: `${uid}-panel-${active}`, "aria-labelledby": `${uid}-tab-${active}`, children: current.items.map((c, i) => renderNode(c, i, onAction, depth + 1)) }))] }));
}
/** Radio: one option from a group; local selection state. The group name is
 * useId-based so sibling groups never collide (deterministic per mount). */
function RadioNode({ node, onAction }) {
    const [selected, setSelected] = useState(node.selected ?? 0);
    const uid = useId();
    const action = node.action;
    const options = node.options.slice(0, GENUI_LIMITS.maxOptions);
    return (_jsxs("div", { className: css.fieldGroup, role: "radiogroup", "aria-label": node.label, children: [node.label !== undefined && _jsx("span", { className: css.fieldLabel, children: node.label }), options.map((opt, i) => (_jsxs("label", { className: css.radio, children: [_jsx("input", { type: "radio", name: `genui-radio-${uid}`, checked: i === selected, onChange: () => {
                            setSelected(i);
                            if (action !== undefined && onAction !== undefined)
                                onAction(action, { type: 'radio', value: opt });
                        } }), _jsx("span", { children: opt })] }, i)))] }));
}
/** Switch: toggle with local state. */
function SwitchNode({ node, onAction }) {
    const [on, setOn] = useState(node.checked === true);
    const action = node.action;
    return (_jsxs("label", { className: css.switchRow, "data-checked": on, children: [_jsx("span", { className: css.switchLabel, children: node.label }), _jsx("button", { type: "button", role: "switch", "aria-checked": on, className: `${css.switch} ${on ? css.switchOn : ''}`, onClick: () => {
                    const next = !on;
                    setOn(next);
                    if (action !== undefined && onAction !== undefined)
                        onAction(action, { type: 'switch', checked: next });
                }, children: _jsx("span", { className: css.switchKnob }) })] }));
}
/** Textarea: multi-line input. */
function TextareaNode({ node }) {
    return (_jsxs("label", { className: css.field, children: [node.label !== undefined && _jsx("span", { children: node.label }), _jsx("textarea", { className: css.textarea, placeholder: node.placeholder, rows: node.rows ?? 4, defaultValue: node.value })] }));
}
/** Accordion: collapsible sections with local open state. Headings and
 * bodies are wired via useId (`aria-controls`/`aria-labelledby`). */
function AccordionNode({ node, onAction, depth = 0 }) {
    const [open, setOpen] = useState(0);
    const uid = useId();
    const items = node.items.slice(0, GENUI_LIMITS.maxAccordionItems);
    return (_jsx("div", { className: css.accordion, "data-genui-accordion": true, "data-open": open ?? '', children: items.map((item, i) => (_jsxs("div", { className: css.accItem, children: [_jsxs("button", { type: "button", className: css.accHead, id: `${uid}-head-${i}`, "aria-expanded": open === i, "aria-controls": `${uid}-body-${i}`, onClick: () => setOpen(open === i ? null : i), children: [_jsx("span", { className: css.accTitle, children: item.title }), _jsx("span", { className: css.accChevron, children: open === i ? '▾' : '▸' })] }), open === i && (_jsx("div", { className: css.accBody, id: `${uid}-body-${i}`, "aria-labelledby": `${uid}-head-${i}`, children: item.items.map((c, ci) => renderNode(c, ci, onAction, depth + 1)) }))] }, i))) }));
}
/** Copy: a one-click copy chip. */
function CopyNode({ node }) {
    const [copied, setCopied] = useState(false);
    return (_jsx("button", { type: "button", className: `${css.copyChip} ${copied ? css.copyChipDone : ''}`, onClick: () => {
            void navigator.clipboard?.writeText(node.text).catch(() => { });
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
        }, children: copied ? '✓ 已复制' : (node.label ?? '复制') }));
}
/** Mermaid: lazily loaded diagram renderer. */
function MermaidNode({ node }) {
    const [html, setHtml] = useState(null);
    const [failed, setFailed] = useState(false);
    const code = node.code.slice(0, GENUI_LIMITS.maxMermaid);
    useEffect(() => {
        let alive = true;
        void import("./mermaid-lazy.js").then(async (m) => {
            try {
                const svg = await m.renderMermaid(code);
                if (alive)
                    setHtml(svg);
            }
            catch {
                if (alive)
                    setFailed(true);
            }
        });
        return () => { alive = false; };
    }, [code]);
    if (failed)
        return _jsxs("div", { className: css.mermaidFallback, children: [_jsx("pre", { children: code }), _jsx("div", { className: css.mermaidErr, children: "mermaid \u6E32\u67D3\u5931\u8D25" })] });
    if (html === null)
        return _jsxs("div", { className: css.mermaidFallback, children: [_jsx("pre", { children: code }), _jsx("div", { className: css.mermaidHint, children: "\u6E32\u67D3\u4E2D\u2026" })] });
    return _jsx("div", { className: css.mermaid, dangerouslySetInnerHTML: { __html: html }, "data-genui-mermaid": true });
}
/** Scene3D: three.js WebGL canvas, lazily imported. */
function Scene3DNode({ node }) {
    const [status, setStatus] = useState('loading');
    const ref = useRef(null);
    // Mesh cap mirrored from the guard: a pathological scene never reaches
    // three.js (per-frame cost scales with mesh count).
    const scene = node.meshes.length > GENUI_LIMITS.maxMeshes ? { ...node, meshes: node.meshes.slice(0, GENUI_LIMITS.maxMeshes) } : node;
    useEffect(() => {
        let alive = true;
        let dispose;
        void import("./scene3d-lazy.js").then(async (m) => {
            if (!alive || ref.current === null)
                return;
            try {
                dispose = await m.mountScene(ref.current, scene);
                if (alive)
                    setStatus('ready');
            }
            catch {
                if (alive)
                    setStatus('error');
            }
        });
        return () => { alive = false; dispose?.(); };
    }, [scene]);
    return (_jsxs("div", { className: css.scene3dWrap, "data-genui-scene3d": true, children: [node.title !== undefined && _jsx("div", { className: css.scene3dTitle, children: node.title }), _jsx("div", { ref: ref, className: css.scene3dCanvas }), status === 'loading' && _jsx("div", { className: css.scene3dHint, children: "\u52A0\u8F7D 3D \u573A\u666F\u2026" }), status === 'error' && _jsx("div", { className: css.scene3dHint, children: "3D \u6E32\u67D3\u5931\u8D25" })] }));
}
/** Timeline: vertical event list with time markers. */
function TimelineNode({ node }) {
    const items = node.items.slice(0, GENUI_LIMITS.maxTimelineItems);
    return (_jsx("div", { className: css.timeline, children: items.map((item, i) => (_jsxs("div", { className: css.tlItem, children: [_jsxs("div", { className: css.tlRail, children: [_jsx("span", { className: css.tlDot }), i < items.length - 1 && _jsx("span", { className: css.tlLine })] }), _jsxs("div", { className: css.tlBody, children: [_jsxs("div", { className: css.tlHead, children: [_jsx("span", { className: css.tlTitle, children: item.title }), item.time !== undefined && _jsx("span", { className: css.tlTime, children: item.time })] }), item.desc !== undefined && _jsx("div", { className: css.tlDesc, children: item.desc })] })] }, i))) }));
}
/** FileTree: indented tree of files and folders. */
function FileTreeNode({ node }) {
    const renderNode = (n, depth, i) => {
        if (depth > GENUI_LIMITS.maxTreeDepth)
            return null;
        const isDir = n.type === 'dir' || (n.children !== undefined && n.children.length > 0);
        return (_jsxs("div", { className: css.ftRow, style: { paddingLeft: `${depth * 16}px` }, children: [_jsx("span", { className: `${css.ftIcon} ${isDir ? css.ftIconDir : ''}`, children: isDir ? '▸' : '·' }), _jsx("span", { className: `${css.ftName} ${isDir ? css.ftDir : ''}`, children: n.name }), (n.children ?? []).map((c, ci) => renderNode(c, depth + 1, ci))] }, `${depth}-${i}`));
    };
    return _jsx("div", { className: css.fileTree, children: node.items.slice(0, GENUI_LIMITS.maxListItems).map((n, i) => renderNode(n, 0, i)) });
}
/** Quiz: a self-contained teaching question. Selecting an option marks it
 * correct/incorrect in place and reveals feedback + explanation — pure
 * frontend, no model round-trip (fits the v1 interaction contract). */
function QuizNode({ node }) {
    const [selected, setSelected] = useState(null);
    const options = node.options.slice(0, GENUI_LIMITS.maxQuizOptions);
    const answered = selected !== null;
    const chosen = selected === null ? undefined : options[selected];
    const correct = chosen?.correct === true;
    return (_jsxs("div", { className: css.quiz, "data-genui-quiz": true, "data-selected": selected ?? '', children: [_jsx("div", { className: css.quizQuestion, children: node.question }), _jsx("div", { className: css.quizOptions, children: options.map((opt, i) => {
                    const isChosen = selected === i;
                    const cls = answered
                        ? isChosen
                            ? opt.correct === true ? css.quizOptCorrect : css.quizOptWrong
                            : opt.correct === true ? css.quizOptReveal : css.quizOpt
                        : css.quizOpt;
                    return (_jsxs("button", { type: "button", className: cls, disabled: answered, onClick: () => setSelected(i), children: [_jsx("span", { className: css.quizMarker, children: answered && (opt.correct === true ? '✓' : isChosen ? '✗' : '') }), opt.label] }, i));
                }) }), answered && (_jsxs("div", { className: css.quizResult, "aria-live": "polite", children: [_jsxs("div", { className: correct ? css.quizCorrectMsg : css.quizWrongMsg, children: [correct ? '✓ 回答正确！' : '✗ 再想想看', chosen?.feedback !== undefined && _jsx("div", { className: css.quizFeedback, children: chosen.feedback })] }), node.explanation !== undefined && _jsx("div", { className: css.quizExplanation, children: node.explanation }), _jsx("button", { type: "button", className: css.quizRetry, onClick: () => setSelected(null), children: "\u91CD\u65B0\u4F5C\u7B54" })] }))] }));
}
/** Breadcrumb: path-style navigation trail. */
function BreadcrumbNode({ node }) {
    const items = node.items.slice(0, GENUI_LIMITS.maxBreadcrumbItems);
    return (_jsx("nav", { className: css.breadcrumb, "aria-label": "breadcrumb", children: items.map((item, i) => (_jsxs("span", { className: css.bcItem, children: [_jsx("span", { className: `${css.bcText} ${i === items.length - 1 ? css.bcCurrent : ''}`, children: item }), i < items.length - 1 && _jsx("span", { className: css.bcSep, children: "/" })] }, i))) }));
}
/**
 * Trailing debounce window (ms) for one `[genui-action]` name: rapid
 * repeated interactions on one control (button mashing, switch flipping)
 * collapse into a single action with the LAST payload. Different action
 * names stay independent. The model round-trip takes seconds, so a few
 * hundred ms of trailing delay is imperceptible — and it stops bursts of
 * queued user turns.
 */
export const GENUI_ACTION_DEBOUNCE_MS = 300;
/**
 * Wrap the harness action callback with the per-action trailing debounce.
 * Absent provider = v1 behavior (components are display-only, callback
 * stays undefined). Pending timers are cleared on unmount so a click that
 * never fired does not leak into the next mount.
 */
function useDebouncedAction(onAction) {
    const pending = useRef(null);
    useEffect(() => {
        return () => {
            const timers = pending.current;
            if (timers === null)
                return;
            for (const timer of timers.values())
                clearTimeout(timer);
            timers.clear();
        };
    }, []);
    return useMemo(() => {
        if (onAction === undefined)
            return undefined;
        const timers = new Map();
        pending.current = timers;
        return (action, payload) => {
            const existing = timers.get(action);
            if (existing !== undefined)
                clearTimeout(existing);
            timers.set(action, setTimeout(() => {
                timers.delete(action);
                onAction(action, payload);
            }, GENUI_ACTION_DEBOUNCE_MS));
        };
    }, [onAction]);
}
/**
 * Render a GenUI spec as an inline block. Falls back to nothing when the spec
 * carries no items (the fence renderer already refused non-specs before us).
 */
export const GenuiBlock = memo(function GenuiBlock({ spec, onAction: directAction }) {
    const gap = spec.gap ?? 14;
    const contextAction = useGenuiAction();
    const onAction = useDebouncedAction(directAction ?? contextAction);
    return (_jsxs("div", { className: css.block, "data-genui": true, children: [spec.title !== undefined && _jsx("div", { className: css.banner, children: spec.title }), _jsx("div", { className: css.col, style: { gap: `${gap}px` }, children: spec.items.map((c, i) => (
                // Staggered reveal: each root item fades/slides in after its
                // predecessors, so the block assembles piece by piece instead of
                // popping in as one slab. Delay capped so long specs still settle
                // quickly; prefers-reduced-motion disables it (see CSS).
                _jsx("div", { className: css.reveal, style: { animationDelay: `${Math.min(i * 90, 720)}ms` }, children: renderNode(c, i, onAction, 0) }, i))) })] }));
});
//# sourceMappingURL=GenuiBlock.js.map