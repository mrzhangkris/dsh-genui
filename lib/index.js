//#region lib/types/client/guard.js
/** Hard resource limits enforced by repair (and mirrored at render time). */
const GENUI_LIMITS = {
	/** Maximum nesting depth of the component tree. */
	maxDepth: 8,
	/** Maximum total nodes across the whole spec. */
	maxNodes: 200,
	/** Maximum length of any plain string field. */
	maxString: 2e3,
	/** Maximum length of a `code` body. */
	maxCode: 12e3,
	/** Maximum length of a mermaid source. */
	maxMermaid: 8e3,
	/** Maximum `grid` columns. */
	maxGridCols: 12,
	/** Maximum `tabs` count. */
	maxTabs: 12,
	/** Maximum `accordion` items. */
	maxAccordionItems: 24,
	/** Maximum `list` items. */
	maxListItems: 50,
	/** Maximum `select`/`radio` options. */
	maxOptions: 50,
	/** Maximum `table` rows / columns. */
	maxTableRows: 50,
	maxTableCols: 12,
	/** Maximum `chart` data points per series. */
	maxChartPoints: 60,
	/** Maximum `plot` series and per-series parameters. */
	maxPlotSeries: 8,
	maxPlotParams: 6,
	/** Maximum `scene3d` meshes. */
	maxMeshes: 5,
	/** Maximum `quiz` options. */
	maxQuizOptions: 8,
	/** Maximum learning-control entries. */
	maxFormulaSteps: 24,
	maxPracticeItems: 24,
	maxClassifyGroups: 8,
	maxSimulationSteps: 60,
	/** Maximum `steps` / `timeline` / `breadcrumb` / `keyvalue` entries. */
	maxSteps: 24,
	maxTimelineItems: 24,
	maxBreadcrumbItems: 12,
	maxKeyValuePairs: 24,
	/** Maximum `file-tree` nesting. */
	maxTreeDepth: 6
};
/** Is `v` one of `values`? (enum guard) */
function inEnum(v, values) {
	return typeof v === "string" && values.includes(v);
}
/** String field: truncate a string to `cap`, or undefined when not a string. */
function str(v, cap) {
	return typeof v === "string" ? v.slice(0, cap) : void 0;
}
/** Finite-number field: clamp into [min, max], or undefined when not finite. */
function num(v, min, max) {
	return typeof v === "number" && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : void 0;
}
/** Integer field: clamp into [min, max], or undefined when not a finite integer. */
function int(v, min, max) {
	return typeof v === "number" && Number.isFinite(v) ? Math.min(max, Math.max(min, Math.trunc(v))) : void 0;
}
/** Optional enum field: the value when it matches, otherwise undefined. */
function enu(v, values) {
	return inEnum(v, values) ? v : void 0;
}
/** Plain object (not array, not null). */
function obj(v) {
	return typeof v === "object" && v !== null && !Array.isArray(v) ? v : void 0;
}
/**
* Optional-field spread helper. `exactOptionalPropertyTypes` forbids
* `{ gap: number | undefined }`; computing the value into a const first and
* spreading `opt('gap', g)` keeps every optional field either absent or a
* plain value.
*/
function opt(key, value) {
	return value === void 0 ? {} : { [key]: value };
}
const TEXT_SIZES = [
	"h1",
	"h2",
	"h3",
	"body",
	"muted",
	"caption"
];
const BUTTON_TONES = [
	"primary",
	"danger",
	"success",
	"ghost"
];
const BADGE_TONES = [
	"success",
	"warn",
	"danger",
	"accent"
];
const INPUT_TYPES = [
	"text",
	"email",
	"password"
];
const CALLOUT_TONES = [
	"info",
	"success",
	"warning",
	"error"
];
const CHART_KINDS = [
	"bars",
	"line",
	"donut"
];
const MESH_SHAPES = [
	"box",
	"sphere",
	"cone",
	"cylinder",
	"torus"
];
const FILE_TYPES = ["file", "dir"];
/** Walk `list` with the shared node budget; drops invalid entries. */
function repairItems(list, ctx, depth) {
	if (!Array.isArray(list)) return [];
	const out = [];
	for (const item of list) {
		if (ctx.remaining <= 0) break;
		ctx.remaining -= 1;
		const node = repairNode(item, ctx, depth);
		if (node !== null) out.push(node);
	}
	return out;
}
function repairNode(value, ctx, depth) {
	if (depth > GENUI_LIMITS.maxDepth) return null;
	const v = obj(value);
	if (v === void 0) return null;
	const type = v.type;
	if (typeof type !== "string") return null;
	switch (type) {
		case "text": {
			const content = str(v.content, GENUI_LIMITS.maxString);
			if (content === void 0) return null;
			return {
				type: "text",
				content,
				...opt("size", enu(v.size, TEXT_SIZES)),
				...opt("center", v.center === true ? true : void 0)
			};
		}
		case "row": return {
			type: "row",
			items: repairItems(v.items, ctx, depth + 1),
			...opt("wrap", v.wrap === true ? true : void 0),
			...opt("spacer", v.spacer === true ? true : void 0)
		};
		case "col": return {
			type: "col",
			items: repairItems(v.items, ctx, depth + 1),
			...opt("gap", num(v.gap, 0, 96))
		};
		case "grid": return {
			type: "grid",
			cols: int(v.cols, 1, GENUI_LIMITS.maxGridCols) ?? 1,
			items: repairItems(v.items, ctx, depth + 1)
		};
		case "card": return {
			type: "card",
			items: repairItems(v.items, ctx, depth + 1),
			...opt("title", str(v.title, GENUI_LIMITS.maxString))
		};
		case "button": {
			const label = str(v.label, GENUI_LIMITS.maxString);
			if (label === void 0) return null;
			return {
				type: "button",
				label,
				...opt("tone", enu(v.tone, BUTTON_TONES)),
				...opt("full", v.full === true ? true : void 0),
				...opt("small", v.small === true ? true : void 0),
				...opt("icon", str(v.icon, 64)),
				...opt("action", str(v.action, 200))
			};
		}
		case "input": return {
			type: "input",
			...opt("label", str(v.label, GENUI_LIMITS.maxString)),
			...opt("placeholder", str(v.placeholder, GENUI_LIMITS.maxString)),
			...opt("value", str(v.value, GENUI_LIMITS.maxString)),
			...opt("inputType", enu(v.inputType, INPUT_TYPES)),
			...opt("action", str(v.action, 200))
		};
		case "select": {
			const options = repairStrings(v.options, GENUI_LIMITS.maxOptions, GENUI_LIMITS.maxString);
			if (options === void 0) return null;
			return {
				type: "select",
				options,
				...opt("label", str(v.label, GENUI_LIMITS.maxString)),
				...opt("action", str(v.action, 200))
			};
		}
		case "checkbox": {
			const label = str(v.label, GENUI_LIMITS.maxString);
			if (label === void 0) return null;
			return {
				type: "checkbox",
				label,
				...opt("checked", v.checked === true ? true : void 0),
				...opt("action", str(v.action, 200))
			};
		}
		case "link": {
			const label = str(v.label, GENUI_LIMITS.maxString);
			if (label === void 0) return null;
			return {
				type: "link",
				label
			};
		}
		case "badge": {
			const label = str(v.label, GENUI_LIMITS.maxString);
			if (label === void 0) return null;
			return {
				type: "badge",
				label,
				...opt("tone", enu(v.tone, BADGE_TONES)),
				...opt("icon", str(v.icon, 64))
			};
		}
		case "stat": {
			const label = str(v.label, GENUI_LIMITS.maxString);
			const value = str(v.value, 128);
			if (label === void 0 || value === void 0) return null;
			return {
				type: "stat",
				label,
				value,
				...opt("delta", str(v.delta, 64))
			};
		}
		case "progress": {
			const value = num(v.value, 0, 100);
			if (value === void 0) return null;
			return {
				type: "progress",
				value,
				...opt("label", str(v.label, GENUI_LIMITS.maxString)),
				...opt("valueLabel", str(v.valueLabel, 64))
			};
		}
		case "divider": return { type: "divider" };
		case "spacer": return { type: "spacer" };
		case "avatar": {
			const name = str(v.name, 64);
			if (name === void 0) return null;
			return {
				type: "avatar",
				name,
				...opt("color", str(v.color, 32))
			};
		}
		case "list": {
			const items = repairListItems(v.items, GENUI_LIMITS.maxListItems);
			if (items === void 0) return null;
			return {
				type: "list",
				items
			};
		}
		case "table": {
			const columns = repairStrings(v.columns, GENUI_LIMITS.maxTableCols, 128);
			const rows = repairRows(v.rows, GENUI_LIMITS.maxTableRows, GENUI_LIMITS.maxTableCols);
			if (columns === void 0 || rows === void 0) return null;
			return {
				type: "table",
				columns,
				rows
			};
		}
		case "chart": {
			const data = repairChartData(v.data, GENUI_LIMITS.maxChartPoints);
			const series = Array.isArray(v.series) ? repairSeries(v.series, GENUI_LIMITS.maxPlotSeries, GENUI_LIMITS.maxChartPoints) : void 0;
			if (data === void 0 && series === void 0) return null;
			return {
				type: "chart",
				data: data ?? [],
				...opt("kind", enu(v.kind, CHART_KINDS)),
				...opt("series", series)
			};
		}
		case "tabs": {
			const tabs = repairTabs(v.tabs, ctx, depth);
			if (tabs === void 0) return null;
			return {
				type: "tabs",
				tabs
			};
		}
		case "plot": {
			const series = repairPlotSeries(v.series, GENUI_LIMITS.maxPlotSeries);
			if (series === void 0) return null;
			return {
				type: "plot",
				series,
				...opt("xMin", num(v.xMin, -1e6, 1e6)),
				...opt("xMax", num(v.xMax, -1e6, 1e6)),
				...opt("yMin", num(v.yMin, -1e9, 1e9)),
				...opt("yMax", num(v.yMax, -1e9, 1e9)),
				...opt("title", str(v.title, GENUI_LIMITS.maxString))
			};
		}
		case "callout": {
			const content = str(v.content, GENUI_LIMITS.maxString);
			if (content === void 0) return null;
			return {
				type: "callout",
				content,
				...opt("tone", enu(v.tone, CALLOUT_TONES)),
				...opt("title", str(v.title, GENUI_LIMITS.maxString))
			};
		}
		case "steps": {
			const steps = repairSteps(v.steps);
			if (steps === void 0) return null;
			return {
				type: "steps",
				steps,
				...opt("current", int(v.current, 0, steps.length))
			};
		}
		case "keyvalue": {
			const pairs = repairPairs(v.pairs, GENUI_LIMITS.maxKeyValuePairs);
			if (pairs === void 0) return null;
			return {
				type: "keyvalue",
				pairs
			};
		}
		case "diff": {
			const diffs = repairDiffs(v.diffs);
			if (diffs === void 0) return null;
			return {
				type: "diff",
				diffs
			};
		}
		case "json":
			if (!("value" in v)) return null;
			return {
				type: "json",
				value: v.value
			};
		case "code": {
			const code = str(v.code, GENUI_LIMITS.maxCode);
			if (code === void 0) return null;
			return {
				type: "code",
				code,
				...opt("lang", str(v.lang, 64))
			};
		}
		case "radio": {
			const options = repairStrings(v.options, GENUI_LIMITS.maxOptions, GENUI_LIMITS.maxString);
			if (options === void 0) return null;
			return {
				type: "radio",
				options,
				...opt("label", str(v.label, GENUI_LIMITS.maxString)),
				...opt("selected", int(v.selected, 0, options.length - 1)),
				...opt("action", str(v.action, 200))
			};
		}
		case "switch": {
			const label = str(v.label, GENUI_LIMITS.maxString);
			if (label === void 0) return null;
			return {
				type: "switch",
				label,
				...opt("checked", v.checked === true ? true : void 0),
				...opt("action", str(v.action, 200))
			};
		}
		case "textarea": return {
			type: "textarea",
			...opt("label", str(v.label, GENUI_LIMITS.maxString)),
			...opt("placeholder", str(v.placeholder, GENUI_LIMITS.maxString)),
			...opt("rows", int(v.rows, 1, 30)),
			...opt("value", str(v.value, GENUI_LIMITS.maxString))
		};
		case "accordion": {
			const items = repairAccordion(v.items, ctx, depth);
			if (items === void 0) return null;
			return {
				type: "accordion",
				items
			};
		}
		case "copy": {
			const text = str(v.text, GENUI_LIMITS.maxCode);
			if (text === void 0) return null;
			return {
				type: "copy",
				text,
				...opt("label", str(v.label, 128))
			};
		}
		case "mermaid": {
			const code = str(v.code, GENUI_LIMITS.maxMermaid);
			if (code === void 0) return null;
			return {
				type: "mermaid",
				code
			};
		}
		case "scene3d": {
			const meshes = repairMeshes(v.meshes);
			if (meshes === void 0) return null;
			return {
				type: "scene3d",
				meshes,
				...opt("title", str(v.title, GENUI_LIMITS.maxString)),
				...opt("ambient", num(v.ambient, 0, 2)),
				...opt("background", str(v.background, 32))
			};
		}
		case "timeline": {
			const items = repairTimeline(v.items, GENUI_LIMITS.maxTimelineItems);
			if (items === void 0) return null;
			return {
				type: "timeline",
				items
			};
		}
		case "file-tree": {
			const items = repairTree(v.items, GENUI_LIMITS.maxListItems);
			if (items === void 0) return null;
			return {
				type: "file-tree",
				items
			};
		}
		case "breadcrumb": {
			const items = repairStrings(v.items, GENUI_LIMITS.maxBreadcrumbItems, GENUI_LIMITS.maxString);
			if (items === void 0) return null;
			return {
				type: "breadcrumb",
				items
			};
		}
		case "quiz": {
			const question = str(v.question, GENUI_LIMITS.maxString);
			const options = repairQuizOptions(v.options);
			if (question === void 0 || options === void 0) return null;
			return {
				type: "quiz",
				question,
				options,
				...opt("explanation", str(v.explanation, GENUI_LIMITS.maxString)),
				...opt("id", str(v.id, 200))
			};
		}
		case "slider": {
			const label = str(v.label, GENUI_LIMITS.maxString);
			const min = num(v.min, -1e9, 1e9);
			const max = num(v.max, -1e9, 1e9);
			const value = num(v.value, -1e9, 1e9);
			if (label === void 0 || min === void 0 || max === void 0 || value === void 0 || min >= max) return null;
			return {
				type: "slider",
				label,
				min,
				max,
				value: Math.min(max, Math.max(min, value)),
				...opt("step", num(v.step, 1e-9, Math.max(1e-9, max - min))),
				...opt("unit", str(v.unit, 32)),
				...opt("action", str(v.action, 200))
			};
		}
		case "formula": {
			const expression = str(v.expression, GENUI_LIMITS.maxString);
			if (expression === void 0) return null;
			return {
				type: "formula",
				expression,
				...opt("label", str(v.label, 256)),
				...opt("steps", repairFormulaSteps(v.steps))
			};
		}
		case "sort": {
			const items = repairStrings(v.items, GENUI_LIMITS.maxPracticeItems, 512);
			const answer = repairStrings(v.answer, GENUI_LIMITS.maxPracticeItems, 512);
			if (items === void 0 || answer === void 0 || items.length === 0 || items.length !== answer.length) return null;
			return {
				type: "sort",
				items,
				answer,
				...opt("prompt", str(v.prompt, GENUI_LIMITS.maxString)),
				...opt("action", str(v.action, 200))
			};
		}
		case "match": {
			const pairs = repairMatchPairs(v.pairs);
			if (pairs === void 0 || pairs.length === 0) return null;
			return {
				type: "match",
				pairs,
				...opt("prompt", str(v.prompt, GENUI_LIMITS.maxString)),
				...opt("action", str(v.action, 200))
			};
		}
		case "classify": {
			const groups = repairClassifyGroups(v.groups);
			if (groups === void 0 || groups.length === 0) return null;
			return {
				type: "classify",
				groups,
				...opt("prompt", str(v.prompt, GENUI_LIMITS.maxString)),
				...opt("action", str(v.action, 200))
			};
		}
		case "simulation": {
			const steps = repairSimulationSteps(v.steps);
			if (steps === void 0 || steps.length === 0) return null;
			return {
				type: "simulation",
				steps,
				...opt("title", str(v.title, 256)),
				...opt("current", int(v.current, 0, steps.length - 1)),
				...opt("intervalMs", int(v.intervalMs, 250, 6e4)),
				...opt("loop", v.loop === true ? true : void 0),
				...opt("action", str(v.action, 200))
			};
		}
		default: return value;
	}
}
function repairStrings(v, cap, strCap) {
	if (!Array.isArray(v)) return void 0;
	const out = [];
	for (const item of v) {
		if (out.length >= cap) break;
		if (typeof item === "string") out.push(item.slice(0, strCap));
	}
	return out;
}
function repairListItems(v, cap) {
	if (!Array.isArray(v)) return void 0;
	const out = [];
	for (const item of v) {
		if (out.length >= cap) break;
		if (typeof item === "string") {
			out.push(item.slice(0, GENUI_LIMITS.maxString));
			continue;
		}
		const o = obj(item);
		const title = o === void 0 ? void 0 : str(o.title, GENUI_LIMITS.maxString);
		if (title === void 0) continue;
		out.push({
			title,
			...opt("desc", o === void 0 ? void 0 : str(o.desc, GENUI_LIMITS.maxString))
		});
	}
	return out;
}
function repairRows(v, rowCap, colCap) {
	if (!Array.isArray(v)) return void 0;
	const out = [];
	for (const row of v) {
		if (out.length >= rowCap) break;
		if (!Array.isArray(row)) continue;
		const cells = [];
		for (const cell of row) {
			if (cells.length >= colCap) break;
			if (typeof cell === "string") cells.push(cell.slice(0, 256));
			else if (typeof cell === "number" && Number.isFinite(cell)) cells.push(cell);
		}
		if (cells.length > 0) out.push(cells);
	}
	return out;
}
function repairChartData(v, cap) {
	if (!Array.isArray(v)) return void 0;
	const out = [];
	for (const datum of v) {
		if (out.length >= cap) break;
		const o = obj(datum);
		const label = o === void 0 ? void 0 : str(o.label, 128);
		const value = o === void 0 ? void 0 : num(o.value, -0xe8d4a51000, 0xe8d4a51000);
		if (label === void 0 || value === void 0) continue;
		out.push({
			label,
			value,
			...opt("color", o === void 0 ? void 0 : str(o.color, 32))
		});
	}
	return out;
}
function repairSeries(v, cap, pointCap) {
	if (!Array.isArray(v)) return void 0;
	const out = [];
	for (const s of v) {
		if (out.length >= cap) break;
		const o = obj(s);
		const label = o === void 0 ? void 0 : str(o.label, 128);
		const data = o === void 0 ? void 0 : repairChartData(o.data, pointCap);
		if (label === void 0 || data === void 0) continue;
		out.push({
			label,
			data,
			...opt("color", o === void 0 ? void 0 : str(o.color, 32))
		});
	}
	return out;
}
function repairTabs(v, ctx, depth) {
	if (!Array.isArray(v)) return void 0;
	const out = [];
	for (const tab of v) {
		if (out.length >= GENUI_LIMITS.maxTabs) break;
		const o = obj(tab);
		const label = o === void 0 ? void 0 : str(o.label, 128);
		if (label === void 0 || o === void 0) continue;
		out.push({
			label,
			items: repairItems(o.items, ctx, depth + 1)
		});
	}
	return out;
}
function repairPlotSeries(v, cap) {
	if (!Array.isArray(v)) return void 0;
	const out = [];
	for (const s of v) {
		if (out.length >= cap) break;
		const o = obj(s);
		const expr = o === void 0 ? void 0 : str(o.expr, 512);
		if (expr === void 0 || o === void 0) continue;
		const params = [];
		if (Array.isArray(o.params)) for (const p of o.params) {
			if (params.length >= GENUI_LIMITS.maxPlotParams) break;
			const po = obj(p);
			const name = po === void 0 ? void 0 : str(po.name, 64);
			const value = po === void 0 ? void 0 : num(po.value, -1e9, 1e9);
			if (name === void 0 || value === void 0) continue;
			params.push({
				name,
				value,
				...opt("min", po === void 0 ? void 0 : num(po.min, -1e9, 1e9)),
				...opt("max", po === void 0 ? void 0 : num(po.max, -1e9, 1e9)),
				...opt("step", po === void 0 ? void 0 : num(po.step, 1e-9, 1e9)),
				...opt("animateTo", po === void 0 ? void 0 : num(po.animateTo, -1e9, 1e9)),
				...opt("durationMs", po === void 0 ? void 0 : num(po.durationMs, 1, 12e4)),
				...opt("loop", po === void 0 ? void 0 : po.loop === true ? true : void 0)
			});
		}
		out.push({
			expr,
			...opt("label", str(o.label, 128)),
			...opt("color", str(o.color, 32)),
			...opt("params", params.length > 0 ? params : void 0)
		});
	}
	return out;
}
function repairSteps(v) {
	if (!Array.isArray(v)) return void 0;
	const out = [];
	for (const s of v) {
		if (out.length >= GENUI_LIMITS.maxSteps) break;
		const o = obj(s);
		const title = o === void 0 ? void 0 : str(o.title, 256);
		if (title === void 0) continue;
		out.push({
			title,
			...opt("desc", o === void 0 ? void 0 : str(o.desc, GENUI_LIMITS.maxString))
		});
	}
	return out;
}
function repairPairs(v, cap) {
	if (!Array.isArray(v)) return void 0;
	const out = [];
	for (const p of v) {
		if (out.length >= cap) break;
		const o = obj(p);
		const key = o === void 0 ? void 0 : str(o.key, 256);
		const value = o === void 0 ? void 0 : str(o.value, GENUI_LIMITS.maxString);
		if (key === void 0 || value === void 0) continue;
		out.push({
			key,
			value
		});
	}
	return out;
}
function repairDiffs(v) {
	if (!Array.isArray(v)) return void 0;
	const out = [];
	for (const d of v) {
		if (out.length >= 24) break;
		const o = obj(d);
		const path = o === void 0 ? void 0 : str(o.path, 1024);
		const newText = o === void 0 ? void 0 : str(o.newText, 2e4);
		if (path === void 0 || newText === void 0) continue;
		const old = o === void 0 ? void 0 : o.oldText;
		out.push({
			path,
			newText,
			oldText: old === null || typeof old !== "string" ? null : old.slice(0, 2e4)
		});
	}
	return out;
}
function repairAccordion(v, ctx, depth) {
	if (!Array.isArray(v)) return void 0;
	const out = [];
	for (const item of v) {
		if (out.length >= GENUI_LIMITS.maxAccordionItems) break;
		const o = obj(item);
		const title = o === void 0 ? void 0 : str(o.title, 256);
		if (title === void 0 || o === void 0) continue;
		out.push({
			title,
			items: repairItems(o.items, ctx, depth + 1)
		});
	}
	return out;
}
function repairMeshes(v) {
	if (!Array.isArray(v)) return void 0;
	const out = [];
	for (const m of v) {
		if (out.length >= GENUI_LIMITS.maxMeshes) break;
		const o = obj(m);
		const shape = o === void 0 ? void 0 : enu(o.shape, MESH_SHAPES);
		if (shape === void 0) continue;
		const scale = o === void 0 ? void 0 : num(o.scale, -1e6, 1e6) ?? tuple3(o.scale);
		const size = o === void 0 ? void 0 : num(o.size, -1e6, 1e6) ?? tuple3(o.size);
		out.push({
			shape,
			...opt("color", o === void 0 ? void 0 : str(o.color, 32)),
			...opt("position", o === void 0 ? void 0 : tuple3(o.position)),
			...opt("rotation", o === void 0 ? void 0 : tuple3(o.rotation)),
			...opt("scale", scale),
			...opt("size", size)
		});
	}
	return out;
}
function tuple3(v) {
	if (!Array.isArray(v) || v.length !== 3) return void 0;
	const [a, b, c] = v;
	if (typeof a !== "number" || !Number.isFinite(a) || typeof b !== "number" || !Number.isFinite(b) || typeof c !== "number" || !Number.isFinite(c)) return void 0;
	return [
		Math.min(1e6, Math.max(-1e6, a)),
		Math.min(1e6, Math.max(-1e6, b)),
		Math.min(1e6, Math.max(-1e6, c))
	];
}
function repairTimeline(v, cap) {
	if (!Array.isArray(v)) return void 0;
	const out = [];
	for (const item of v) {
		if (out.length >= cap) break;
		const o = obj(item);
		const title = o === void 0 ? void 0 : str(o.title, 256);
		if (title === void 0) continue;
		out.push({
			title,
			...opt("desc", o === void 0 ? void 0 : str(o.desc, GENUI_LIMITS.maxString)),
			...opt("time", o === void 0 ? void 0 : str(o.time, 128))
		});
	}
	return out;
}
function repairTree(v, cap) {
	return walkTree(v, cap, GENUI_LIMITS.maxTreeDepth);
}
function walkTree(v, cap, depthLeft) {
	if (!Array.isArray(v)) return void 0;
	const out = [];
	for (const item of v) {
		if (out.length >= cap) break;
		const o = obj(item);
		const name = o === void 0 ? void 0 : str(o.name, 256);
		if (name === void 0) continue;
		const children = o !== void 0 && depthLeft > 0 && Array.isArray(o.children) ? walkTree(o.children, cap, depthLeft - 1) : void 0;
		out.push({
			name,
			...opt("type", o === void 0 ? void 0 : enu(o.type, FILE_TYPES)),
			...opt("children", children)
		});
	}
	return out;
}
function repairQuizOptions(v) {
	if (!Array.isArray(v)) return void 0;
	const out = [];
	for (const optItem of v) {
		if (out.length >= GENUI_LIMITS.maxQuizOptions) break;
		const o = obj(optItem);
		const label = o === void 0 ? void 0 : str(o.label, 512);
		if (label === void 0) continue;
		out.push({
			label,
			...opt("correct", o === void 0 ? void 0 : o.correct === true ? true : void 0),
			...opt("feedback", o === void 0 ? void 0 : str(o.feedback, GENUI_LIMITS.maxString))
		});
	}
	return out;
}
function repairFormulaSteps(v) {
	if (!Array.isArray(v)) return void 0;
	const out = [];
	for (const item of v.slice(0, GENUI_LIMITS.maxFormulaSteps)) {
		const o = obj(item);
		const expression = o === void 0 ? void 0 : str(o.expression, GENUI_LIMITS.maxString);
		if (expression !== void 0) out.push({
			expression,
			...opt("explanation", str(o?.explanation, GENUI_LIMITS.maxString))
		});
	}
	return out;
}
function repairMatchPairs(v) {
	if (!Array.isArray(v)) return void 0;
	const out = [];
	for (const item of v.slice(0, GENUI_LIMITS.maxPracticeItems)) {
		const o = obj(item);
		const left = o === void 0 ? void 0 : str(o.left, 512);
		const right = o === void 0 ? void 0 : str(o.right, 512);
		if (left !== void 0 && right !== void 0) out.push({
			left,
			right
		});
	}
	return out;
}
function repairClassifyGroups(v) {
	if (!Array.isArray(v)) return void 0;
	const out = [];
	for (const item of v.slice(0, GENUI_LIMITS.maxClassifyGroups)) {
		const o = obj(item);
		const label = o === void 0 ? void 0 : str(o.label, 256);
		const items = o === void 0 ? void 0 : repairStrings(o.items, GENUI_LIMITS.maxPracticeItems, 512);
		if (label !== void 0 && items !== void 0) out.push({
			label,
			items
		});
	}
	return out;
}
function repairSimulationSteps(v) {
	if (!Array.isArray(v)) return void 0;
	const out = [];
	for (const item of v.slice(0, GENUI_LIMITS.maxSimulationSteps)) {
		const o = obj(item);
		const label = o === void 0 ? void 0 : str(o.label, 256);
		const content = o === void 0 ? void 0 : str(o.content, GENUI_LIMITS.maxString);
		if (label !== void 0 && content !== void 0) out.push({
			label,
			content
		});
	}
	return out;
}
/**
* Deterministically repair a raw spec value into a renderable GenuiSpec.
* Returns null only when the root is not an object with an `items` array;
* every other defect is healed by dropping/clamping/truncating. Idempotent:
* repairing a repaired spec is a no-op.
*/
function repairGenuiSpec(value) {
	const v = obj(value);
	if (v === void 0 || !Array.isArray(v.items)) return null;
	const ctx = { remaining: GENUI_LIMITS.maxNodes };
	return {
		...opt("title", str(v.title, GENUI_LIMITS.maxString)),
		...opt("gap", num(v.gap, 0, 96)),
		...opt("panel", v.panel === true ? true : void 0),
		items: repairItems(v.items, ctx, 0)
	};
}
//#endregion
//#region lib/types/plugin/tool.js
/**
* The `render_ui` tool: a model-facing channel that renders a GenUI spec as
* an interactive card in the conversation TOOL ROW (route A of the design
* doc). The ```dsh-ui fence channel renders inline in the reply; this tool
* renders in the tool row and rides the harness's result `meta` projection:
* `presentationMeta` stores the repaired spec, the browser toolview
* (`src/client/toolview.tsx`) reads it from the result node and renders.
*
* Zero runtime harness imports, deliberately: an external plugin's node half
* must not depend on the harness module graph at runtime (the profile
* resolves only the plugin package itself). The definition is therefore a
* plain `ToolDefinition` object — the exact shape `defineTool` returns — with
* the arguments schema authored as JSON Schema (the harness validates args
* and output with the same JSON Schema validator defineTool uses). Deep
* validation, deterministic repair, and resource limits live in the shared
* guard (`src/client/guard.ts`), which the schema deliberately stays loose
* enough to reach.
* @module @deepseek-ai/dsh-genui/plugin/tool
*/
/**
* Arguments schema: an open `spec` slot. The schema must NOT reject anything
* the guard could repair — the model's component trees are imperfect by
* nature, and the guard heals them; argument validation would only strand
* them. `additionalProperties: false` keeps the call shape honest.
*
* `spec` IS typed `object` on purpose: the guard can only repair plain
* records (a serialized JSON string, array, or scalar root is unusable), so
* argument validation rejecting non-objects loses nothing repairable — and
* it stops the model from double-encoding the tree as a string (observed
* twice in the wild), failing fast with a clear schema error instead.
*/
const RENDER_UI_PARAMETERS = {
	type: "object",
	properties: { spec: {
		type: "object",
		description: "GenUI component tree (white-listed vocabulary, see the dsh-ui fence section in the system prompt). Deep-validated and repaired by the renderer. Pass the spec as a JSON OBJECT — never as a serialized JSON string (a string fails argument validation)."
	} },
	required: ["spec"],
	additionalProperties: false
};
/** The tool's canonical value is a short model-facing summary string. */
const RENDER_UI_OUTPUT_SCHEMA = {
	type: "string",
	description: "One-line human-readable render summary for the model."
};
/** Read the `spec` argument defensively (presenters run on replayed args). */
function specOf(args) {
	return typeof args === "object" && args !== null ? args.spec : void 0;
}
/** Total node count of a repaired spec (already bounded by the guard). */
function countNodes(spec) {
	let n = 0;
	const walk = (list) => {
		for (const node of list) {
			if (n >= GENUI_LIMITS.maxNodes) return;
			n += 1;
			const items = node.items;
			if (Array.isArray(items)) walk(items);
		}
	};
	walk(spec.items);
	return n;
}
/** Tool-call title shared by the pending and completed presentations. */
function cardTitle(args) {
	const spec = repairGenuiSpec(specOf(args));
	return spec === null ? void 0 : `渲染 UI：${spec.title ?? "未命名"}`;
}
/**
* Build the render_ui tool definition. Registered by the plugin node half;
* `ctx.tools.register` consumes it exactly like a `defineTool` result.
*/
function createRenderUiTool() {
	return {
		name: "render_ui",
		description: "Render an interactive UI card in the conversation tool row by passing a GenUI spec (a white-listed component tree; the same vocabulary as the ```dsh-ui fence, see the system prompt). Use it when the user asks for a structured panel, dashboard, or form that belongs in the tool row rather than inline in the reply. The card is interactive client-side (tabs, buttons, inputs, switches); components carrying an \"action\" field send [genui-action] back to you when the user interacts, and you should re-render the updated UI.",
		parameters: RENDER_UI_PARAMETERS,
		output: {
			schema: RENDER_UI_OUTPUT_SCHEMA,
			render(_args, value) {
				return [{
					type: "text",
					text: String(value)
				}];
			},
			presentationMeta(args) {
				return repairGenuiSpec(specOf(args));
			}
		},
		async execute(args) {
			const spec = repairGenuiSpec(specOf(args));
			if (spec === null) return "render_ui：spec 无效 —— 根对象需要 \"items\" 数组（组件树白名单见系统提示词），请修正后重试。";
			return `已渲染 UI「${spec.title ?? "未命名"}」（${countNodes(spec)} 个组件）。用户现在可以看到这张卡片；组件带 action 时，用户交互会以 [genui-action] 消息发回给你，届时请重新渲染更新后的界面。`;
		},
		presentCall(args) {
			const title = cardTitle(args);
			return title === void 0 ? void 0 : {
				card: "generic",
				title,
				kind: "other"
			};
		},
		presentResult(args) {
			const title = cardTitle(args);
			return title === void 0 ? void 0 : {
				card: "generic",
				title
			};
		}
	};
}
//#endregion
//#region lib/types/plugin/index.js
/**
* GenUI plugin: teaches the model the ```dsh-ui fence syntax for emitting
* declarative UI components inline in its reply. The browser half renders the
* fence through GenuiBlock (ui-primitives); this host half only tells the
* model the language exists, so a session without the plugin simply never
* emits fences and nothing changes.
*
* The section is a convention section (order 100-199), placed after the bash
* guidance so the model sees it among its output-format rules.
* @module @deepseek-ai/dsh-genui
*/
/** Convention: tool guidance uses 100–199; bash's section is 104. */
const GENUI_SECTION_ORDER = 105;
/** The fence language description injected into every assembled system prompt. */
const GENUI_SECTION_TEXT = `You can render interactive UI components INSIDE your reply — as part of your answer, between paragraphs — by emitting a fenced block with the language tag \`dsh-ui\` containing a JSON spec:

\`\`\`dsh-ui
{"title":"可选标题","gap":14,"items":[...]}
\`\`\`

The spec is a white-listed component tree; the UI renders it inline where the fence sits. Node vocabulary (use only these \`type\` values):

- text: {"type":"text","size":"h1|h2|h3|body|muted|caption","content":"...","center":true?}
- row / col: {"type":"row"|"col","items":[...],"wrap":true?,"spacer":true?,"gap":n?}  — layout containers
- grid: {"type":"grid","cols":n,"items":[...]}
- card: {"type":"card","title":"...","items":[...]}
- button: {"type":"button","label":"...","tone":"primary|danger|success|ghost","full":true?,"small":true?,"icon":"emoji?"}
- input: {"type":"input","label":"...","placeholder":"...","inputType":"text|email|password","value":"..."}
- select: {"type":"select","label":"...","options":["...","..."]}
- checkbox: {"type":"checkbox","label":"...","checked":true?}
- link: {"type":"link","label":"..."}
- badge: {"type":"badge","label":"...","tone":"success|warn|danger|accent","icon":"emoji?"}
- stat: {"type":"stat","label":"...","value":"...","delta":"+12.4%|-3%"}
- progress: {"type":"progress","label":"...","value":0-100,"valueLabel":"70%"}
- divider: {"type":"divider"}
- list: {"type":"list","items":["..."] or [{"title":"...","desc":"..."}]}
- table: {"type":"table","columns":["..."],"rows":[["...","..."]]}
- chart: {"type":"chart","kind":"bars|line|donut","data":[{"label":"...","value":n,"color":"#hex?"}],"series":[...]?}  — bars (default), line trend, donut share; series field = grouped bars
- tabs: {"type":"tabs","tabs":[{"label":"...","items":[...]}]}  — switchable tab panels
- avatar: {"type":"avatar","name":"..."}
- spacer: {"type":"spacer"}
- plot: {"type":"plot","series":[{"expr":"sin(x)","label":"...","color":"#hex?"}],"xMin":-5,"xMax":5,"yMin":?,"yMax":?,"title":"..."}  — SVG math function plot; expressions use sin/cos/tan/asin/acos/atan/sqrt/cbrt/exp/log/ln/abs/floor/ceil/round/min/max/pow, constants pi/e/tau, and the variable x
- callout: {"type":"callout","tone":"info|success|warning|error","title":"...","content":"..."}
- steps: {"type":"steps","current":n,"steps":[{"title":"...","desc":"..."}]}  — progress checklist
- keyvalue: {"type":"keyvalue","pairs":[{"key":"...","value":"..."}]}
- diff: {"type":"diff","diffs":[{"path":"...","oldText":"..."|null,"newText":"..."}]}  — code diff
- json: {"type":"json","value":...}  — JSON tree inspector
- code: {"type":"code","lang":"ts","code":"..."}  — syntax-highlighted code
- radio: {"type":"radio","label":"...","options":["...","..."],"selected":n?}
- switch: {"type":"switch","label":"...","checked":true?}
- textarea: {"type":"textarea","label":"...","placeholder":"...","rows":n?,"value":"..."}
- accordion: {"type":"accordion","items":[{"title":"...","items":[...]}]}
- copy: {"type":"copy","label":"复制","text":"..."}  — copy-to-clipboard chip
- mermaid: {"type":"mermaid","code":"graph TD\\nA-->B"}  — flowchart/sequence/class/gantt/pie/er/state/journey diagrams
- scene3d: {"type":"scene3d","title":"...","meshes":[{"shape":"box|sphere|cone|cylinder|torus","color":"#hex?","size":n|[w,h,d]?,"position":[x,y,z]?,"rotation":[rx,ry,rz]?,"scale":n?|[...]?}],"ambient":0-2?,"background":"#hex?"}  — 3D WebGL scene, drag to rotate, wheel to zoom
- timeline: {"type":"timeline","items":[{"title":"...","desc":"...","time":"..."}]}  — vertical event timeline
- file-tree: {"type":"file-tree","items":[{"name":"...","type":"file|dir","children":[...]?}]}  — directory tree
- breadcrumb: {"type":"breadcrumb","items":["首页","设置","账户"]}  — path-style navigation trail
- quiz: {"type":"quiz","question":"...","options":[{"label":"...","correct":true?,"feedback":"..."?}],"explanation":"...","id":"..."?}  — self-contained teaching question with in-place judging and retry

Rules:
- Put the fence exactly where the component belongs in your answer; prose flows around it.
- Use stat/grid/card/table/chart/plot/tabs/callout/steps to build structured, realistic interfaces.
- A malformed fence degrades to a plain code block, so keep the JSON strict.
- Do NOT wrap the fence in another code fence, and do not put markdown inside the JSON strings.
- Prefer dark-theme-friendly content; the UI theme is the app's, not yours.
- For 3D scenes keep mesh counts small (1–5); for plots give sane xMin/xMax ranges.
- Keep specs compact: at most 200 nodes total and 8 levels of nesting; oversized specs are truncated by the renderer.
- v2 actions: button / input / select / checkbox / radio / switch may carry "action":"name"; the user's click or change is then sent back to you as [genui-action] name with the component's current data, so you can re-render the UI with the result.
- Tool channel: you may also call the render_ui tool with the same spec to render the UI as a card in the tool row (e.g. a dashboard the user asked you to "build"); the fence channel renders inline in the reply — prefer the fence for UI that is part of your answer, the tool for UI that is a deliverable.
- Panel updates: calling render_ui also renders the spec into the session panel (the dock above the composer); calling it again updates that SAME panel in place — use this for surfaces the user keeps refreshing, and keep the fence for one-shot explainers.
- Panel fences: a \`\`\`dsh-ui fence whose spec carries "panel": true renders ONLY into the session panel (nothing in the message flow) and updates it in place — the tool-free way to refresh a panel.
- Panel actions: when a [genui-action] from a panel component arrives, reply with the updated panel:true fence plus at most one short line of confirmation (e.g. "已刷新") — no explanations, no ordinary fences; the panel alone changes.`;
/**
* Register the GenUI output-language section and the render_ui tool.
* @param ctx - cordis context.
*/
const inject = ["systemPrompt"];
function apply(ctx) {
	ctx.systemPrompt.section({
		name: "genui:fence",
		order: 105,
		text: GENUI_SECTION_TEXT
	});
	let registered = false;
	const tryRegister = (value) => {
		if (registered) return;
		const tools = value ?? ctx.reflect.get("tools", false);
		if (tools === void 0) return;
		tools.register(createRenderUiTool());
		registered = true;
	};
	tryRegister(void 0);
	ctx.on("internal/service", (name, value) => {
		if (name === "tools") tryRegister(value);
	});
}
//#endregion
export { GENUI_SECTION_ORDER, GENUI_SECTION_TEXT, apply, inject };
