import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
//#region src/client/spec.ts
/**
* Wrap a bare component object into a col root. Returns null when `value` is
* not component-shaped (no usable `type`). `panel`/`append` live on the root
* spec, so they are hoisted onto the wrapper.
*/
function wrapSingleComponentRoot(value) {
	if (typeof value !== "object" || value === null) return null;
	const v = value;
	if (typeof v.type !== "string" || v.type === "") return null;
	const root = {
		type: "col",
		items: [value]
	};
	if (v.panel === true) root.panel = true;
	if (v.append === true) root.append = true;
	return root;
}
//#endregion
//#region src/client/guard.ts
/** Hard resource limits enforced by repair (and mirrored at render time). */
const GENUI_LIMITS = {
	/** Maximum nesting depth of the component tree. */
	maxDepth: 8,
	/** Maximum total nodes across the whole spec. */
	maxNodes: 200,
	/** Maximum length of any plain string field. */
	maxString: 2e3,
	/** Maximum serialized length of a `json` node value. */
	maxJsonValue: 24e3,
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
	/** Maximum `scene3d` meshes per scene. */
	maxMeshes: 5,
	/** Maximum `scene3d` nodes per spec (nesting included). Browsers cap live
	* WebGL contexts (~16) and a page stuffed with scenes loses every context
	* at once (collective context loss), so scenes past the cap are dropped. */
	maxScene3dNodes: 5,
	/** Maximum `quiz` options. */
	maxQuizOptions: 8,
	/** Maximum `steps` / `timeline` / `breadcrumb` / `keyvalue` entries. */
	maxSteps: 24,
	maxTimelineItems: 24,
	maxBreadcrumbItems: 12,
	maxKeyValuePairs: 24,
	/** Maximum `file-tree` nesting. */
	maxTreeDepth: 6,
	/** Maximum `diagram` nodes / edges / zones / focal accents (editorial
	* complexity budget, mirroring diagram-design's §7 limits). */
	maxDiagramNodes: 9,
	maxDiagramEdges: 12,
	maxDiagramZones: 3,
	maxDiagramFocal: 2,
	maxDiagramLabel: 14,
	/** Maximum depth of an `echart` option object (prevents pathological nested
	* ECharts configs from stalling the guard walk). */
	maxEChartOptionDepth: 10,
	/** Maximum length of any single array inside an `echart` option (prevents
	* a model from stalling rendering with `series.data` of hundreds of
	* thousands of points). */
	maxEChartArrayLen: 500,
	/** Maximum total entries (object keys + array elements) traversed while
	* sanitizing an `echart` option. Bounds the walk so a pathologically
	* large option object cannot stall the guard. */
	maxEChartOptionNodes: 2e3
};
/** Is `v` one of `values`? (enum guard) */
function inEnum(v, values) {
	return typeof v === "string" && values.includes(v);
}
/** String field: truncate a string to `cap`, or undefined when not a string. */
function str(v, cap) {
	return typeof v === "string" ? v.slice(0, cap) : void 0;
}
/**
* Color field: the value lands in an inline `style` (background/stroke) or
* THREE.Color. Arbitrary CSS values are an exfiltration channel — a model
* (or a hostile spec) could emit `url(https://attacker/track?...)` and the
* browser would fetch it. Only formats that name a color pass: hex, rgb/hsl
* functions, and host design tokens (`var(--dsw-*)`). Anything else degrades
* to the component's default palette.
*/
const SAFE_COLOR_RE = /^(?:#[\da-fA-F]{3,8}|rgba?\([^)]{0,64}\)|hsla?\([^)]{0,64}\)|var\(--dsw-[\w-]+(?:,\s*#[0-9a-fA-F]{3,8})?\))$/;
function color(v) {
	if (typeof v !== "string") return void 0;
	const s = v.trim();
	return s.length <= 64 && SAFE_COLOR_RE.test(s) ? s : void 0;
}
/**
* Solid color field: hex/rgb/hsl plus a whitelist of common CSS named
* colors — deliberately narrower than `color()`, which also admits host
* design tokens (`var(--dsw-*)`). CSS variables are fine for inline
* `style` strings (the browser resolves them), but THREE.Color cannot
* parse a `var()` literal and throws, taking the whole 3D scene down to
* the "3D 渲染失败" fallback. THREE.Color.NAMES does resolve CSS named
* colors (`red`, `navy`, …), so the common ones pass (normalized to
* lowercase, the exact form NAMES stores); anything outside the whitelist
* degrades to the renderer's default palette.
*/
const SOLID_COLOR_RE = /^(?:#[\da-fA-F]{3,8}|rgba?\([^)]{0,64}\)|hsla?\([^)]{0,64}\))$/;
/** Common CSS named colors THREE.Color.NAMES resolves. Deliberately NOT the
* full CSS list — a closed, reviewed set; extend only with colors verified
* against the renderer's three.js build. Matched case-insensitively. */
const SOLID_NAMED_COLORS = /* @__PURE__ */ new Set([
	"red",
	"orange",
	"yellow",
	"green",
	"blue",
	"purple",
	"pink",
	"brown",
	"black",
	"white",
	"gray",
	"grey",
	"cyan",
	"magenta",
	"lime",
	"teal",
	"navy",
	"olive",
	"maroon",
	"silver",
	"gold"
]);
function solidColor(v) {
	if (typeof v !== "string") return void 0;
	const s = v.trim();
	if (s.length > 64) return void 0;
	if (SOLID_NAMED_COLORS.has(s.toLowerCase())) return s.toLowerCase();
	return SOLID_COLOR_RE.test(s) ? s : void 0;
}
/**
* Link target field: http(s), mailto, and `/`-rooted same-origin paths
* survive. `javascript:`/`data:`, every other scheme, and
* protocol-relative `//host` URLs degrade to a plain-text node — the
* model's link is display, not an execution channel. Same-origin paths
* mirror `safeMediaSrc` (see inline comment below for the exact gates).
*/
function safeHref(v) {
	if (typeof v !== "string") return void 0;
	const s = v.trim();
	if (s === "" || s.length > 2048) return void 0;
	if (/^https?:\/\//i.test(s)) return s;
	if (/^mailto:[^@\s]+@[^@\s]+$/i.test(s)) return s;
	if (s.startsWith("/") && !/^[/\\]/.test(s.slice(1))) return s;
}
/** Media loads bytes, so accept only browser-reachable http(s) or same-origin
* relative paths. Active/local schemes and protocol-relative URLs are
* rejected. The renderer always keeps playback user-controlled. */
function safeMediaSrc(v) {
	if (typeof v !== "string") return void 0;
	const s = v.trim();
	if (s === "" || s.length > 2048) return void 0;
	if (/^https?:\/\//i.test(s)) return s;
	if (/^[a-z][a-z0-9+.-]*:/i.test(s) || /^[/\\]{2}/.test(s)) return void 0;
	return s;
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
const PLOT_KINDS = [
	"line",
	"area",
	"scatter"
];
const MEDIA_ASPECT_RATIOS = [
	"16:9",
	"4:3",
	"1:1",
	"9:16"
];
const MESH_SHAPES = [
	"box",
	"sphere",
	"cone",
	"cylinder",
	"torus"
];
const FILE_TYPES = ["file", "dir"];
const DIAGRAM_KINDS = [
	"architecture",
	"it-state",
	"flowchart",
	"sequence",
	"state",
	"er",
	"timeline",
	"swimlane",
	"quadrant",
	"radar",
	"loop",
	"nested",
	"tree",
	"org-chart",
	"layers",
	"venn",
	"pyramid",
	"bar",
	"line",
	"gantt",
	"scatter",
	"high-level",
	"process",
	"medallion",
	"data-flow",
	"dp-integration",
	"dp-security-matrix"
];
const DIAGRAM_NODE_TYPES = [
	"focal",
	"backend",
	"store",
	"external",
	"input",
	"optional",
	"security"
];
const DIAGRAM_VARIANTS = [
	"light",
	"dark",
	"editorial"
];
const DIAGRAM_EDGE_KINDS = [
	"solid",
	"dashed",
	"accent",
	"link"
];
const DIAGRAM_ROUTES = [
	"auto",
	"orthogonal",
	"straight"
];
const ECHART_PRESETS = [
	"bar",
	"line",
	"area",
	"pie",
	"scatter"
];
/** Record an alias repair: `from` was consumed as its canonical `to`. */
function renamed(ctx, path, from, to) {
	ctx.diag?.push({
		kind: "renamed",
		path,
		detail: `${path} 的字段 '${from}' 已按正名 '${to}' 缝补——能用，但请改用正名 ${to}`
	});
}
/** Derive callout `content` from an `items` array alias: the first string
* item verbatim, otherwise the JSON serialization of the whole array
* (guarded — stringify throws on cycles / BigInt). Returns undefined when
* nothing usable can be extracted (non-array or empty array). */
function calloutItemsContent(items) {
	if (!Array.isArray(items) || items.length === 0) return void 0;
	if (typeof items[0] === "string") return str(items[0], GENUI_LIMITS.maxString);
	try {
		return str(JSON.stringify(items) ?? void 0, GENUI_LIMITS.maxString);
	} catch {
		return;
	}
}
/** Layout-container children with the children/columns aliases recorded
* (K3 audit #8) and the child path threaded for nested diagnostics. */
function repairContainerItems(v, ctx, depth, path) {
	if (v.items === void 0) {
		if (v.children !== void 0) renamed(ctx, path, "children", "items");
		else if (v.columns !== void 0) renamed(ctx, path, "columns", "items");
	}
	return repairItems(v.items ?? v.children ?? v.columns, ctx, depth + 1, `${path}.items`);
}
/** Canonical + accepted-alias input keys per node type. The unknown-key diff
* uses this to report silently discarded fields; ALIASES ARE INCLUDED so a
* key consumed as an alias reports once as `renamed` and never double-reports
* as dropped. Keep in sync with the repairNode switch. */
const NODE_KEYS = {
	text: /* @__PURE__ */ new Set([
		"content",
		"text",
		"size",
		"center"
	]),
	row: /* @__PURE__ */ new Set([
		"items",
		"children",
		"columns",
		"wrap",
		"spacer"
	]),
	col: /* @__PURE__ */ new Set([
		"items",
		"children",
		"columns",
		"gap"
	]),
	grid: /* @__PURE__ */ new Set([
		"items",
		"children",
		"columns",
		"cols"
	]),
	card: /* @__PURE__ */ new Set([
		"items",
		"children",
		"columns",
		"title"
	]),
	button: /* @__PURE__ */ new Set([
		"label",
		"text",
		"tone",
		"full",
		"small",
		"icon",
		"action"
	]),
	input: /* @__PURE__ */ new Set([
		"label",
		"placeholder",
		"value",
		"inputType",
		"action",
		"id"
	]),
	select: /* @__PURE__ */ new Set([
		"options",
		"choices",
		"label",
		"action",
		"selected",
		"id"
	]),
	checkbox: /* @__PURE__ */ new Set([
		"label",
		"checked",
		"action"
	]),
	link: /* @__PURE__ */ new Set(["label", "href"]),
	audio: /* @__PURE__ */ new Set([
		"src",
		"url",
		"alt",
		"loop"
	]),
	video: /* @__PURE__ */ new Set([
		"src",
		"url",
		"alt",
		"poster",
		"loop",
		"muted",
		"aspectRatio"
	]),
	badge: /* @__PURE__ */ new Set([
		"label",
		"text",
		"value",
		"content",
		"tone",
		"icon"
	]),
	stat: /* @__PURE__ */ new Set([
		"label",
		"value",
		"val",
		"delta",
		"unit"
	]),
	progress: /* @__PURE__ */ new Set([
		"value",
		"percent",
		"label",
		"valueLabel"
	]),
	divider: /* @__PURE__ */ new Set([]),
	spacer: /* @__PURE__ */ new Set([]),
	avatar: /* @__PURE__ */ new Set(["name", "color"]),
	list: /* @__PURE__ */ new Set(["items", "children"]),
	table: /* @__PURE__ */ new Set([
		"columns",
		"headers",
		"rows",
		"data"
	]),
	chart: /* @__PURE__ */ new Set([
		"data",
		"points",
		"series",
		"kind"
	]),
	tabs: /* @__PURE__ */ new Set(["tabs"]),
	plot: /* @__PURE__ */ new Set([
		"series",
		"xMin",
		"xMax",
		"yMin",
		"yMax",
		"title"
	]),
	callout: /* @__PURE__ */ new Set([
		"content",
		"text",
		"body",
		"description",
		"items",
		"tone",
		"type_",
		"level",
		"title"
	]),
	steps: /* @__PURE__ */ new Set([
		"steps",
		"items",
		"current"
	]),
	keyvalue: /* @__PURE__ */ new Set([
		"pairs",
		"items",
		"data"
	]),
	diff: /* @__PURE__ */ new Set(["diffs"]),
	json: /* @__PURE__ */ new Set(["value", "data"]),
	code: /* @__PURE__ */ new Set([
		"code",
		"value",
		"lang"
	]),
	radio: /* @__PURE__ */ new Set([
		"options",
		"choices",
		"label",
		"selected",
		"action",
		"group",
		"answer",
		"explanation"
	]),
	submit: /* @__PURE__ */ new Set([
		"label",
		"action",
		"resetAction",
		"groups"
	]),
	switch: /* @__PURE__ */ new Set([
		"label",
		"checked",
		"action"
	]),
	slider: /* @__PURE__ */ new Set([
		"min",
		"max",
		"step",
		"value",
		"label",
		"action",
		"id"
	]),
	textarea: /* @__PURE__ */ new Set([
		"label",
		"placeholder",
		"rows",
		"value",
		"action",
		"id"
	]),
	accordion: /* @__PURE__ */ new Set(["items"]),
	copy: /* @__PURE__ */ new Set([
		"text",
		"content",
		"label"
	]),
	mermaid: /* @__PURE__ */ new Set(["code", "source"]),
	scene3d: /* @__PURE__ */ new Set([
		"meshes",
		"objects",
		"title",
		"ambient",
		"background"
	]),
	diagram: /* @__PURE__ */ new Set([
		"kind",
		"nodes",
		"edges",
		"zones",
		"variant",
		"title",
		"theme"
	]),
	timeline: /* @__PURE__ */ new Set(["items", "entries"]),
	"file-tree": /* @__PURE__ */ new Set(["items"]),
	breadcrumb: /* @__PURE__ */ new Set(["items"]),
	quiz: /* @__PURE__ */ new Set([
		"question",
		"options",
		"choices",
		"explanation",
		"id",
		"action"
	]),
	echart: /* @__PURE__ */ new Set([
		"title",
		"height",
		"preset",
		"data",
		"series",
		"option"
	])
};
/** Walk `list` with the shared node budget; drops invalid entries. Only
* KEPT entries consume the pool (dropped ones refund their charge), matching
* walkTree's skip-before-charge. */
function repairItems(list, ctx, depth, path) {
	if (!Array.isArray(list)) return [];
	const out = [];
	for (let i = 0; i < list.length; i++) {
		if (ctx.remaining <= 0) break;
		const itemPath = `${path}[${i}]`;
		const declaredType = obj(list[i])?.type;
		ctx.remaining -= 1;
		const node = repairNode(list[i], ctx, depth, itemPath);
		if (node !== null) out.push(node);
		else {
			ctx.remaining += 1;
			if (typeof declaredType === "string" && NODE_KEYS[declaredType] !== void 0) ctx.diag?.push({
				kind: "dropped-node",
				path: itemPath,
				detail: `${itemPath}（type '${declaredType}'）因必填字段缺失或类型非法被整体丢弃`
			});
		}
	}
	return out;
}
function repairNode(value, ctx, depth, path) {
	if (depth > GENUI_LIMITS.maxDepth) return null;
	const vo = obj(value);
	if (vo === void 0) return null;
	const type = vo.type;
	if (typeof type !== "string") return null;
	let v = vo;
	let effectiveType = type;
	const loweredType = type.trim().toLowerCase();
	if ((loweredType === "h1" || loweredType === "h2" || loweredType === "h3") && !Array.isArray(vo.children)) {
		ctx.diag?.push({
			kind: "renamed",
			path,
			detail: `${path} 的 type '${type}' 已缝补为 'text' + size:'${loweredType}'——能用，但请直接写 {"type":"text","size":"${loweredType}"}`
		});
		const content = vo.content !== void 0 ? vo.content : vo.text !== void 0 ? vo.text : typeof vo.children === "string" ? vo.children : vo.body;
		const consumed = [];
		if (vo.content === void 0 && content !== void 0) {
			if (vo.text !== void 0) {
				renamed(ctx, path, "text", "content");
				consumed.push("text");
			} else if (typeof vo.children === "string") {
				renamed(ctx, path, "children", "content");
				consumed.push("children");
			} else if (vo.body !== void 0) {
				renamed(ctx, path, "body", "content");
				consumed.push("body");
			}
		}
		v = {
			...vo,
			type: "text",
			size: loweredType
		};
		if (content !== void 0) v.content = content;
		for (const key of consumed) delete v[key];
		effectiveType = "text";
	}
	const allowed = NODE_KEYS[effectiveType];
	if (allowed !== void 0) for (const key of Object.keys(v)) {
		if (key === "type") continue;
		if (!allowed.has(key)) ctx.diag?.push({
			kind: "dropped-unknown-key",
			path,
			detail: `${path} 的字段 '${key}' 不是 ${effectiveType} 的合法字段，已被无声丢弃（键只取自字段表）`
		});
	}
	switch (effectiveType) {
		case "text": {
			if (v.content === void 0 && v.text !== void 0) renamed(ctx, path, "text", "content");
			const content = str(v.content, GENUI_LIMITS.maxString) ?? str(v.text, GENUI_LIMITS.maxString);
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
			items: repairContainerItems(v, ctx, depth, path),
			...opt("wrap", v.wrap === true ? true : void 0),
			...opt("spacer", v.spacer === true ? true : void 0)
		};
		case "col": return {
			type: "col",
			items: repairContainerItems(v, ctx, depth, path),
			...opt("gap", num(v.gap, 0, 96))
		};
		case "grid": return {
			type: "grid",
			cols: int(v.cols, 1, GENUI_LIMITS.maxGridCols) ?? 1,
			items: repairContainerItems(v, ctx, depth, path)
		};
		case "card": return {
			type: "card",
			items: repairContainerItems(v, ctx, depth, path),
			...opt("title", str(v.title, GENUI_LIMITS.maxString))
		};
		case "button": {
			if (v.label === void 0 && v.text !== void 0) renamed(ctx, path, "text", "label");
			const label = str(v.label, GENUI_LIMITS.maxString) ?? str(v.text, GENUI_LIMITS.maxString);
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
			...opt("action", str(v.action, 200)),
			...opt("id", str(v.id, 200))
		};
		case "select": {
			if (v.options === void 0 && v.choices !== void 0) renamed(ctx, path, "choices", "options");
			const options = repairStrings(v.options ?? v.choices, GENUI_LIMITS.maxOptions, GENUI_LIMITS.maxString);
			if (options === void 0) return null;
			return {
				type: "select",
				options,
				...opt("label", str(v.label, GENUI_LIMITS.maxString)),
				...opt("action", str(v.action, 200)),
				...opt("selected", int(v.selected, 0, options.length - 1)),
				...opt("id", str(v.id, 200))
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
				label,
				...opt("href", safeHref(v.href))
			};
		}
		case "audio": {
			if (v.src === void 0 && v.url !== void 0) renamed(ctx, path, "url", "src");
			const src = safeMediaSrc(v.src ?? v.url);
			if (src === void 0) return null;
			return {
				type: "audio",
				src,
				...opt("alt", str(v.alt, GENUI_LIMITS.maxString)),
				...opt("loop", v.loop === true ? true : void 0)
			};
		}
		case "video": {
			if (v.src === void 0 && v.url !== void 0) renamed(ctx, path, "url", "src");
			const src = safeMediaSrc(v.src ?? v.url);
			if (src === void 0) return null;
			return {
				type: "video",
				src,
				...opt("alt", str(v.alt, GENUI_LIMITS.maxString)),
				...opt("poster", safeMediaSrc(v.poster)),
				...opt("loop", v.loop === true ? true : void 0),
				...opt("muted", v.muted === true ? true : void 0),
				...opt("aspectRatio", enu(v.aspectRatio, MEDIA_ASPECT_RATIOS))
			};
		}
		case "badge": {
			const fromLabel = str(v.label, GENUI_LIMITS.maxString);
			const fromText = str(v.text, GENUI_LIMITS.maxString);
			const fromValue = str(v.value, GENUI_LIMITS.maxString);
			const label = fromLabel ?? fromText ?? fromValue ?? str(v.content, GENUI_LIMITS.maxString);
			if (label === void 0) return null;
			if (fromLabel === void 0 && fromText === void 0 && fromValue === void 0) renamed(ctx, path, "content", "label");
			return {
				type: "badge",
				label,
				...opt("tone", enu(v.tone, BADGE_TONES)),
				...opt("icon", str(v.icon, 64))
			};
		}
		case "stat": {
			if (v.value === void 0 && v.val !== void 0) renamed(ctx, path, "val", "value");
			const label = str(v.label, GENUI_LIMITS.maxString);
			const value = str(v.value, 128) ?? str(v.val, 128);
			if (label === void 0 || value === void 0) return null;
			return {
				type: "stat",
				label,
				value,
				...opt("delta", str(v.delta, 64)),
				...opt("unit", str(v.unit, 32))
			};
		}
		case "progress": {
			if (v.value === void 0 && v.percent !== void 0) renamed(ctx, path, "percent", "value");
			const value = num(v.value ?? v.percent, 0, 100);
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
				...opt("color", color(v.color))
			};
		}
		case "list": {
			if (v.items === void 0 && v.children !== void 0) renamed(ctx, path, "children", "items");
			const items = repairListItems(v.items ?? v.children, GENUI_LIMITS.maxListItems, ctx, depth + 1, `${path}.items`);
			if (items === void 0) return null;
			return {
				type: "list",
				items
			};
		}
		case "table": {
			const declaredCols = v.columns !== void 0 ? v.columns : v.headers;
			if (v.columns === void 0 && v.headers !== void 0) renamed(ctx, path, "headers", "columns");
			if (v.rows === void 0 && v.data !== void 0) renamed(ctx, path, "data", "rows");
			let rawCols = declaredCols;
			let rawRows = v.rows !== void 0 ? v.rows : v.data;
			if (Array.isArray(rawCols) && rawCols.length > 0 && typeof rawCols[0] === "object" && rawCols[0] !== null) rawCols = rawCols.map((c) => columnHeaderText(c));
			if (Array.isArray(rawRows) && rawRows.length > 0 && typeof rawRows[0] === "object" && rawRows[0] !== null && !Array.isArray(rawRows[0])) {
				const keys = Array.isArray(declaredCols) && declaredCols.length > 0 && typeof declaredCols[0] === "object" && declaredCols[0] !== null ? declaredCols.map((c) => columnKeyOf(c)).filter((k) => k !== void 0) : Object.keys(rawRows[0]);
				rawRows = rawRows.map((row) => keys.map((k) => cellText(row[k])));
			}
			const columns = repairStrings(rawCols, GENUI_LIMITS.maxTableCols, 128);
			const rows = repairRows(rawRows, GENUI_LIMITS.maxTableRows, GENUI_LIMITS.maxTableCols);
			if (columns === void 0 || rows === void 0) return null;
			return {
				type: "table",
				columns,
				rows
			};
		}
		case "chart": {
			if (v.data === void 0 && v.points !== void 0) renamed(ctx, path, "points", "data");
			const data = repairChartData(v.data ?? v.points, GENUI_LIMITS.maxChartPoints);
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
			const tabs = repairTabs(v.tabs, ctx, depth, path);
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
			const itemsAsContent = calloutItemsContent(v.items);
			if (v.content === void 0) {
				if (v.text !== void 0) renamed(ctx, path, "text", "content");
				else if (v.body !== void 0) renamed(ctx, path, "body", "content");
				else if (v.description !== void 0) renamed(ctx, path, "description", "content");
				else if (itemsAsContent !== void 0) renamed(ctx, path, "items", "content");
			}
			if (v.tone === void 0 && v.type_ !== void 0) renamed(ctx, path, "type_", "tone");
			else if (v.tone === void 0 && v.level !== void 0) renamed(ctx, path, "level", "tone");
			const content = str(v.content, GENUI_LIMITS.maxString) ?? str(v.text, GENUI_LIMITS.maxString) ?? str(v.body, GENUI_LIMITS.maxString) ?? str(v.description, GENUI_LIMITS.maxString) ?? itemsAsContent;
			if (content === void 0) return null;
			return {
				type: "callout",
				content,
				...opt("tone", enu(v.tone ?? v.type_ ?? v.level, CALLOUT_TONES)),
				...opt("title", str(v.title, GENUI_LIMITS.maxString))
			};
		}
		case "steps": {
			if (v.steps === void 0 && v.items !== void 0) renamed(ctx, path, "items", "steps");
			const steps = repairSteps(v.steps ?? v.items);
			if (steps === void 0) return null;
			return {
				type: "steps",
				steps,
				...opt("current", int(v.current, 0, steps.length))
			};
		}
		case "keyvalue": {
			if (v.pairs === void 0) {
				if (v.items !== void 0) renamed(ctx, path, "items", "pairs");
				else if (v.data !== void 0) renamed(ctx, path, "data", "pairs");
			}
			const pairs = repairPairs(v.pairs ?? v.items ?? v.data, GENUI_LIMITS.maxKeyValuePairs);
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
		case "json": {
			if (!("value" in v) && !("data" in v)) return null;
			if (!("value" in v) && "data" in v) renamed(ctx, path, "data", "value");
			const raw = "value" in v ? v.value : v.data;
			let serialized;
			try {
				serialized = JSON.stringify(raw) ?? "";
			} catch {
				return null;
			}
			if (serialized.length > GENUI_LIMITS.maxJsonValue) return null;
			return {
				type: "json",
				value: raw
			};
		}
		case "code": {
			if (v.code === void 0 && v.value !== void 0) renamed(ctx, path, "value", "code");
			const code = str(v.code, GENUI_LIMITS.maxCode) ?? str(v.value, GENUI_LIMITS.maxCode);
			if (code === void 0) return null;
			return {
				type: "code",
				code,
				...opt("lang", str(v.lang, 64))
			};
		}
		case "radio": {
			if (v.options === void 0 && v.choices !== void 0) renamed(ctx, path, "choices", "options");
			const options = repairStrings(v.options ?? v.choices, GENUI_LIMITS.maxOptions, GENUI_LIMITS.maxString);
			if (options === void 0) return null;
			return {
				type: "radio",
				options,
				...opt("label", str(v.label, GENUI_LIMITS.maxString)),
				...opt("selected", int(v.selected, 0, options.length - 1)),
				...opt("action", str(v.action, 200)),
				...opt("group", str(v.group, 200)),
				...opt("answer", typeof v.answer === "number" && Number.isFinite(v.answer) && v.answer >= 0 && v.answer < options.length ? Math.trunc(v.answer) : typeof v.answer === "string" ? v.answer.slice(0, 512) : void 0),
				...opt("explanation", str(v.explanation, GENUI_LIMITS.maxString))
			};
		}
		case "submit": {
			const label = str(v.label, GENUI_LIMITS.maxString);
			const action = str(v.action, 200);
			if (label === void 0) return null;
			return {
				type: "submit",
				label,
				...opt("action", action),
				...opt("resetAction", str(v.resetAction, 200)),
				...opt("groups", repairStrings(v.groups, GENUI_LIMITS.maxOptions, 200))
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
		case "slider": {
			const min = num(v.min, -1e9, 1e9) ?? 0;
			const max = num(v.max, -1e9, 1e9) ?? 100;
			const lo = Math.min(min, max);
			const hi = Math.max(min, max);
			const step = num(v.step, 1e-9, Math.max(hi - lo, 1e-9));
			const value = num(v.value, lo, hi) ?? lo;
			return {
				type: "slider",
				min: lo,
				max: hi,
				...opt("step", step),
				value,
				...opt("label", str(v.label, GENUI_LIMITS.maxString)),
				...opt("action", str(v.action, 200)),
				...opt("id", str(v.id, 200))
			};
		}
		case "textarea": return {
			type: "textarea",
			...opt("label", str(v.label, GENUI_LIMITS.maxString)),
			...opt("placeholder", str(v.placeholder, GENUI_LIMITS.maxString)),
			...opt("rows", int(v.rows, 1, 30)),
			...opt("value", str(v.value, GENUI_LIMITS.maxString)),
			...opt("action", str(v.action, 200)),
			...opt("id", str(v.id, 200))
		};
		case "accordion": {
			const items = repairAccordion(v.items, ctx, depth, path);
			if (items === void 0) return null;
			return {
				type: "accordion",
				items
			};
		}
		case "copy": {
			if (v.text === void 0 && v.content !== void 0) renamed(ctx, path, "content", "text");
			const text = str(v.text, GENUI_LIMITS.maxCode) ?? str(v.content, GENUI_LIMITS.maxCode);
			if (text === void 0) return null;
			return {
				type: "copy",
				text,
				...opt("label", str(v.label, 128))
			};
		}
		case "mermaid": {
			if (v.code === void 0 && v.source !== void 0) renamed(ctx, path, "source", "code");
			const code = str(v.code, GENUI_LIMITS.maxMermaid) ?? str(v.source, GENUI_LIMITS.maxMermaid);
			if (code === void 0) return null;
			return {
				type: "mermaid",
				code
			};
		}
		case "scene3d": {
			if (ctx.scene3dLeft <= 0) return null;
			if (v.meshes === void 0 && v.objects !== void 0) renamed(ctx, path, "objects", "meshes");
			const meshes = repairMeshes(v.meshes ?? v.objects);
			if (meshes === void 0) return null;
			ctx.scene3dLeft -= 1;
			return {
				type: "scene3d",
				meshes,
				...opt("title", str(v.title, GENUI_LIMITS.maxString)),
				...opt("ambient", num(v.ambient, 0, 2)),
				...opt("background", color(v.background))
			};
		}
		case "diagram": return repairDiagram(v);
		case "timeline": {
			if (v.items === void 0 && v.entries !== void 0) renamed(ctx, path, "entries", "items");
			const items = repairTimeline(v.items ?? v.entries, GENUI_LIMITS.maxTimelineItems);
			if (items === void 0) return null;
			return {
				type: "timeline",
				items
			};
		}
		case "file-tree": {
			const items = repairTree(v.items, GENUI_LIMITS.maxListItems, ctx);
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
			if (v.options === void 0 && v.choices !== void 0) renamed(ctx, path, "choices", "options");
			const question = str(v.question, GENUI_LIMITS.maxString);
			const options = repairQuizOptions(v.options ?? v.choices);
			if (question === void 0 || options === void 0) return null;
			return {
				type: "quiz",
				question,
				options,
				...opt("explanation", str(v.explanation, GENUI_LIMITS.maxString)),
				...opt("id", str(v.id, 200)),
				...opt("action", str(v.action, 200))
			};
		}
		case "echart": {
			const data = v.data !== void 0 ? repairChartData(v.data, GENUI_LIMITS.maxChartPoints) : void 0;
			const series = v.series !== void 0 && Array.isArray(v.series) ? repairSeries(v.series, GENUI_LIMITS.maxPlotSeries, GENUI_LIMITS.maxChartPoints) : void 0;
			const sanitized = v.option !== void 0 ? sanitizeEChartOption(v.option, 0, { count: GENUI_LIMITS.maxEChartOptionNodes }) : void 0;
			const option = sanitized === void 0 || typeof sanitized !== "object" || sanitized === null || Array.isArray(sanitized) ? void 0 : sanitized;
			if (option === void 0 && data === void 0 && series === void 0) return null;
			return {
				type: "echart",
				...opt("title", str(v.title, GENUI_LIMITS.maxString)),
				...opt("height", int(v.height, 100, 800)),
				...opt("preset", enu(v.preset, ECHART_PRESETS)),
				...opt("data", data),
				...opt("series", series),
				...opt("option", option)
			};
		}
		default: return sanitizeOpaqueNode(value, depth);
	}
}
/** Keys never allowed through an opaque pass-through: a JSON.parse'd spec
* can carry own `__proto__`/`constructor`/`prototype` properties, and a
* computed-key rebuild (`{ [key]: val }`) would re-create them as own data
* properties — downstream spreads (Object.assign, React props) would then
* pollute Object.prototype. Object.entries alone does NOT drop them: they
* are own enumerable keys like any other, so they are skipped BY NAME. */
const OPAQUE_DANGEROUS_KEYS = /* @__PURE__ */ new Set([
	"__proto__",
	"constructor",
	"prototype"
]);
/**
* Depth-bounded structural clone for plugin-registered custom node types
* the guard is otherwise opaque to (the renderer's default branch resolves
* them). The original reference is never handed on: the clone strips
* `__proto__`/`constructor`/`prototype` at every level and cuts any value
* nested deeper than GENUI_LIMITS.maxDepth to null (the depth budget is
* shared with the surrounding tree), so a hostile spec cannot smuggle
* prototype pollution or unbounded nesting through a custom type.
*/
function sanitizeOpaqueNode(value, depth) {
	if (obj(value) === void 0) return null;
	if (depth > GENUI_LIMITS.maxDepth) return null;
	return cloneOpaqueValue(value, depth);
}
function cloneOpaqueValue(v, depth) {
	if (v === null || typeof v !== "object") return v;
	if (depth > GENUI_LIMITS.maxDepth) return null;
	if (Array.isArray(v)) return v.map((item) => cloneOpaqueValue(item, depth + 1));
	const out = {};
	for (const [key, val] of Object.entries(v)) {
		if (OPAQUE_DANGEROUS_KEYS.has(key)) continue;
		out[key] = cloneOpaqueValue(val, depth + 1);
	}
	return out;
}
function repairStrings(v, cap, strCap) {
	if (!Array.isArray(v)) return void 0;
	const out = [];
	for (const item of v) {
		if (out.length >= cap) break;
		if (typeof item === "string") out.push(item.slice(0, strCap));
		else if (item !== null && typeof item === "object") {
			const o = item;
			const s = typeof o.label === "string" ? o.label : typeof o.value === "string" ? o.value : typeof o.title === "string" ? o.title : JSON.stringify(item);
			out.push(s.slice(0, strCap));
		}
	}
	return out;
}
function repairListItems(v, cap, ctx, depth, path) {
	if (!Array.isArray(v)) return void 0;
	const out = [];
	let i = 0;
	for (const item of v) {
		i += 1;
		if (out.length >= cap) break;
		if (typeof item === "string") {
			out.push(item.slice(0, GENUI_LIMITS.maxString));
			continue;
		}
		const o = obj(item);
		const title = o === void 0 ? void 0 : str(o.title, GENUI_LIMITS.maxString);
		if (title !== void 0) {
			out.push({
				title,
				...opt("desc", o === void 0 ? void 0 : str(o.desc, GENUI_LIMITS.maxString))
			});
			continue;
		}
		if (o !== void 0 && typeof o.type === "string") {
			if (ctx.remaining <= 0) break;
			ctx.remaining -= 1;
			const node = repairNode(o, ctx, depth, `${path}[${i - 1}]`);
			if (node !== null) out.push(node);
			else {
				ctx.remaining += 1;
				ctx.diag?.push({
					kind: "dropped-node",
					path: `${path}[${i - 1}]`,
					detail: `${path}[${i - 1}]（type '${o.type}'）因必填字段缺失或类型非法被整体丢弃`
				});
			}
		}
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
			...opt("color", o === void 0 ? void 0 : color(o.color))
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
			...opt("color", o === void 0 ? void 0 : color(o.color))
		});
	}
	return out;
}
function repairTabs(v, ctx, depth, path) {
	if (!Array.isArray(v)) return void 0;
	const out = [];
	for (let i = 0; i < v.length; i++) {
		if (out.length >= GENUI_LIMITS.maxTabs) break;
		const o = obj(v[i]);
		const label = o === void 0 ? void 0 : str(o.label, 128);
		if (label === void 0 || o === void 0) continue;
		const tabPath = `${path}.tabs[${i}]`;
		if (o.items === void 0 && o.content !== void 0) renamed(ctx, tabPath, "content", "items");
		const rawItems = o.items !== void 0 ? o.items : o.content !== void 0 ? Array.isArray(o.content) ? o.content : [o.content] : void 0;
		out.push({
			label,
			items: repairItems(rawItems, ctx, depth + 1, `${tabPath}.items`)
		});
	}
	return out;
}
/** Header text for an object-shaped table column ({title,key} antd style). */
function columnHeaderText(c) {
	const o = obj(c);
	if (o === void 0) return String(c);
	for (const k of [
		"title",
		"label",
		"key",
		"dataIndex"
	]) {
		const s = o[k];
		if (typeof s === "string" && s !== "") return s;
	}
	return JSON.stringify(c);
}
/** Row key for an object-shaped column, mirroring columnHeaderText's order. */
function columnKeyOf(c) {
	const o = obj(c);
	if (o === void 0) return void 0;
	for (const k of [
		"key",
		"dataIndex",
		"title",
		"label"
	]) {
		const s = o[k];
		if (typeof s === "string" && s !== "") return s;
	}
}
/** Cell text for object-array rows: strings/finite numbers pass through,
* everything else stringifies so the column alignment is preserved
* (repairRows would drop null/undefined cells and shift the row). */
function cellText(v) {
	if (typeof v === "string") return v;
	if (typeof v === "number" && Number.isFinite(v)) return v;
	if (v === null || v === void 0) return "";
	return JSON.stringify(v);
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
			...opt("color", color(o.color)),
			...opt("kind", enu(o.kind, PLOT_KINDS)),
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
function repairAccordion(v, ctx, depth, path) {
	if (!Array.isArray(v)) return void 0;
	const out = [];
	for (let i = 0; i < v.length; i++) {
		if (out.length >= GENUI_LIMITS.maxAccordionItems) break;
		const o = obj(v[i]);
		const title = o === void 0 ? void 0 : str(o.title, 256);
		if (title === void 0 || o === void 0) continue;
		out.push({
			title,
			items: repairItems(o.items, ctx, depth + 1, `${path}.items[${i}]`)
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
			...opt("color", o === void 0 ? void 0 : solidColor(o.color)),
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
/** Clamp a coordinate/size to the 4px editorial grid. */
function grid4(v, min, max) {
	return Math.min(max, Math.max(min, Math.round(v / 4) * 4));
}
function repairDiagramNodes(v) {
	if (!Array.isArray(v)) return void 0;
	const out = [];
	const seen = /* @__PURE__ */ new Set();
	for (const raw of v) {
		if (out.length >= GENUI_LIMITS.maxDiagramNodes) break;
		const o = obj(raw);
		if (o === void 0) continue;
		const id = str(o.id, 128);
		const label = str(o.label, GENUI_LIMITS.maxString);
		if (id === void 0 || label === void 0) continue;
		if (seen.has(id)) continue;
		seen.add(id);
		const nodeType = enu(o.type, DIAGRAM_NODE_TYPES);
		const x = o.x === void 0 ? void 0 : grid4(num(o.x, -1e6, 1e6) ?? 0, 0, 1e6);
		const y = o.y === void 0 ? void 0 : grid4(num(o.y, -1e6, 1e6) ?? 0, 0, 1e6);
		const w = o.w === void 0 ? void 0 : grid4(num(o.w, -1e6, 1e6) ?? 96, 40, 2e3);
		const h = o.h === void 0 ? void 0 : grid4(num(o.h, -1e6, 1e6) ?? 48, 24, 1200);
		out.push({
			id,
			label,
			...opt("sub", str(o.sub, 256)),
			...opt("type", nodeType),
			...opt("x", x),
			...opt("y", y),
			...opt("w", w),
			...opt("h", h),
			...opt("tag", str(o.tag, 32))
		});
	}
	return out;
}
function repairDiagramEdges(v) {
	if (v === void 0) return [];
	if (!Array.isArray(v)) return void 0;
	const out = [];
	for (const raw of v) {
		if (out.length >= GENUI_LIMITS.maxDiagramEdges) break;
		const o = obj(raw);
		if (o === void 0) continue;
		const from = str(o.from, 128);
		const to = str(o.to, 128);
		if (from === void 0 || to === void 0) continue;
		out.push({
			from,
			to,
			...opt("label", str(o.label, GENUI_LIMITS.maxDiagramLabel)),
			...opt("kind", enu(o.kind, DIAGRAM_EDGE_KINDS)),
			...opt("route", enu(o.route, DIAGRAM_ROUTES))
		});
	}
	return out;
}
function repairDiagramTheme(v) {
	const o = obj(v);
	if (o === void 0) return void 0;
	const out = {};
	for (const key of [
		"paper",
		"paper-2",
		"ink",
		"muted",
		"soft",
		"rule",
		"accent",
		"accent-tint",
		"link"
	]) {
		const c = color(o[key]);
		if (c !== void 0) out[key] = c;
	}
	return Object.keys(out).length === 0 ? void 0 : out;
}
function repairDiagramZones(v) {
	if (v === void 0) return [];
	if (!Array.isArray(v)) return void 0;
	const out = [];
	for (const raw of v) {
		if (out.length >= GENUI_LIMITS.maxDiagramZones) break;
		const o = obj(raw);
		if (o === void 0) continue;
		const label = str(o.label, 64);
		if (label === void 0) continue;
		out.push({
			label,
			...opt("x", o.x === void 0 ? void 0 : grid4(num(o.x, -1e6, 1e6) ?? 0, 0, 1e6)),
			...opt("y", o.y === void 0 ? void 0 : grid4(num(o.y, -1e6, 1e6) ?? 0, 0, 1e6)),
			...opt("w", o.w === void 0 ? void 0 : grid4(num(o.w, -1e6, 1e6) ?? 100, 40, 2e3)),
			...opt("h", o.h === void 0 ? void 0 : grid4(num(o.h, -1e6, 1e6) ?? 100, 40, 1200))
		});
	}
	return out;
}
function repairDiagram(v) {
	const o = obj(v);
	if (o === void 0) return null;
	const kind = enu(o.kind, DIAGRAM_KINDS);
	if (kind === void 0) return null;
	const nodes = repairDiagramNodes(o.nodes);
	if (nodes === void 0) return null;
	const edges = repairDiagramEdges(o.edges);
	if (edges === void 0) return null;
	const zones = repairDiagramZones(o.zones);
	if (zones === void 0) return null;
	return {
		type: "diagram",
		kind,
		nodes,
		edges,
		zones,
		...opt("variant", enu(o.variant, DIAGRAM_VARIANTS)),
		...opt("title", str(o.title, 256)),
		...opt("theme", repairDiagramTheme(o.theme))
	};
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
function repairTree(v, cap, ctx) {
	return walkTree(v, cap, GENUI_LIMITS.maxTreeDepth, ctx);
}
function walkTree(v, cap, depthLeft, ctx) {
	if (!Array.isArray(v)) return void 0;
	const out = [];
	for (const item of v) {
		if (out.length >= cap) break;
		if (ctx.remaining <= 0) break;
		const o = obj(item);
		if (o === void 0) continue;
		const name = str(o.name, 256);
		if (name === void 0) continue;
		ctx.remaining -= 1;
		const children = depthLeft > 0 && Array.isArray(o.children) ? walkTree(o.children, cap, depthLeft - 1, ctx) : void 0;
		out.push({
			name,
			...opt("type", enu(o.type, FILE_TYPES)),
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
/**
* Patterns that indicate HTML/script injection in a string field. ECharts
* default `tooltip.renderMode: 'html'` writes tooltip content via
* `innerHTML`; even with renderMode forced to 'richText' (see below),
* filtering these patterns is defense-in-depth — a model (or a
* prompt-injected model) should never emit `<script>`, `onerror=`, or
* `javascript:` inside a chart option string.
*/
const ECHART_HTML_DANGER_RE = /<(?:script|img|svg|iframe|video|audio|object|embed|source)\b|on[a-z]+\s*=|javascript:/i;
/**
* Prefixes that make ECharts hand a string to the browser as a network/data
* load: `series[].symbol: 'image://…'` (and graphic `style.image`) fetch an
* external URL, while `data:`/`blob:` URLs load bytes directly — each is an
* exfiltration/tracking channel for a prompt-injected model that the `url(` /
* HTML checks above never see. Only a string STARTING with the scheme is
* dangerous (ECharts prefix-parses these fields); labels, formatter
* templates, and hex colors are unaffected.
*/
const ECHART_EXFIL_RE = /^(?:image|data|blob):/i;
/**
* Sanitize an ECharts option object: depth-bounded, budget-bounded
* pass-through that strips dangerous values (functions, `url()` in styles,
* HTML/script injection patterns in strings) but preserves the object shape
* ECharts needs. Scalars are KEPT: ECharts options are full of them,
* including inside `data` arrays (`data: [120, 150, 180]`,
* `xAxis.data: ['1月', '2月']`). Previously a scalar hit the plain-object
* gate below and returned undefined, so every primitive-valued array was
* filtered to empty and dropped — a chart with a full `option` rendered
* with empty series (blank canvas). This is a safety walk, not an ECharts
* semantic validator.
*
* Security: `tooltip.renderMode` is forced to `'richText'` on every tooltip
* object. ECharts' default `'html'` mode writes tooltip content via
* `innerHTML`, which is an XSS vector when the option originates from model
* output — a prompt-injected model could emit
* `{"tooltip":{"formatter":"<img src=x onerror=...>"}}` and execute
* arbitrary script. `richText` renders as text, never touching innerHTML.
*/
function sanitizeEChartOption(v, depth, budget) {
	if (budget.count <= 0) return void 0;
	budget.count -= 1;
	if (depth > GENUI_LIMITS.maxEChartOptionDepth) return void 0;
	if (typeof v === "string") {
		const s = v.slice(0, GENUI_LIMITS.maxString);
		if (s.toLowerCase().includes("url(") || ECHART_HTML_DANGER_RE.test(s) || ECHART_EXFIL_RE.test(s.trim())) return void 0;
		return s;
	}
	if (typeof v === "number" && Number.isFinite(v)) return v;
	if (typeof v === "boolean") return v;
	if (v === null) return null;
	if (Array.isArray(v)) {
		const cap = Math.min(v.length, GENUI_LIMITS.maxEChartArrayLen);
		const arr = [];
		for (let i = 0; i < cap; i++) {
			const s = sanitizeEChartOption(v[i], depth + 1, budget);
			arr.push(s !== void 0 ? s : null);
		}
		return arr.length > 0 ? arr : void 0;
	}
	const o = obj(v);
	if (o === void 0) return void 0;
	const out = {};
	for (const [key, val] of Object.entries(o)) {
		if (key === "image" && typeof val === "string" && (val.includes("://") || val.trim().startsWith("//"))) continue;
		const s = sanitizeEChartOption(val, depth + 1, budget);
		if (s === void 0) continue;
		if (key === "tooltip" && typeof s === "object" && s !== null && !Array.isArray(s)) s.renderMode = "richText";
		out[key] = s;
	}
	return Object.keys(out).length > 0 || Object.keys(o).length === 0 ? out : void 0;
}
/**
* Deterministically repair a raw spec value into a renderable GenuiSpec.
* Returns null only when the root is not an object with an `items` array
* (a bare component root is wrapped into a col first — the documented fence
* vocabulary allows single-component bodies); every other defect is healed by
* dropping/clamping/truncating. Idempotent: repairing a repaired spec is a
* no-op.
*/
function repairGenuiSpec(value, diag) {
	const v = obj(value);
	if (v === void 0) return null;
	if (!Array.isArray(v.items)) {
		const wrapped = wrapSingleComponentRoot(value);
		if (wrapped === null) return null;
		return repairGenuiSpec(wrapped, diag);
	}
	const ctx = {
		remaining: GENUI_LIMITS.maxNodes,
		scene3dLeft: GENUI_LIMITS.maxScene3dNodes,
		...diag !== void 0 ? { diag } : {}
	};
	if (diag !== void 0) {
		for (const key of Object.keys(v)) if (key !== "title" && key !== "gap" && key !== "panel" && key !== "append" && key !== "items") diag.push({
			kind: "dropped-unknown-key",
			path: "spec",
			detail: `spec 根对象的字段 '${key}' 不是合法的 spec 字段（title/gap/panel/append/items），已被无声丢弃`
		});
	}
	return {
		...opt("title", str(v.title, GENUI_LIMITS.maxString)),
		...opt("gap", num(v.gap, 0, 96)),
		...opt("panel", v.panel === true ? true : void 0),
		...opt("append", v.append === true ? true : void 0),
		items: repairItems(v.items, ctx, 0, "items")
	};
}
/**
* Count the nodes of a spec tree (every item, descending into tabs /
* accordion / file-tree / list containers — the same descent
* `validateGenuiSpec` walks). Shared by the panel fold (node-budget gate)
* and validation, so the panel never runs a second, divergent traversal.
* `cap` bounds the walk for hostile inputs; the panel passes
* `PANEL_LIMITS.maxNodes + 1` to detect overflow without counting the whole
* tree.
*/
function countGenuiNodes(value, cap = Number.POSITIVE_INFINITY) {
	let count = 0;
	const walk = (list) => {
		if (!Array.isArray(list)) return;
		for (const item of list) {
			if (count >= cap) return;
			count += 1;
			const v = obj(item);
			if (v === void 0) continue;
			if (v.type === "tabs" && Array.isArray(v.tabs)) for (const t of v.tabs) {
				if (count >= cap) return;
				const to = obj(t);
				if (to !== void 0) walk(to.items);
			}
			else if (v.type === "accordion" && Array.isArray(v.items)) for (const it of v.items) {
				if (count >= cap) return;
				const io = obj(it);
				if (io !== void 0) walk(io.items);
			}
			else if ((v.type === "row" || v.type === "col" || v.type === "grid" || v.type === "card") && Array.isArray(v.items)) walk(v.items);
			else if (v.type === "file-tree" && Array.isArray(v.items)) walk(v.items);
			else if (v.type === "list" && Array.isArray(v.items)) for (const li of v.items) {
				if (count >= cap) return;
				const lo = obj(li);
				if (lo !== void 0 && typeof lo.type === "string") walk([lo]);
			}
		}
	};
	const root = obj(value);
	walk(root === void 0 ? [] : root.items);
	return count;
}
/** Every white-listed node `type`. Keep in sync with the repairNode switch —
* validate_dsh_ui uses it to tell declared GenUI nodes apart from unrelated
* `"type"` strings (e.g. file-tree's `{type:'file'}` children). */
const GENUI_NODE_TYPES = /* @__PURE__ */ new Set([
	"accordion",
	"audio",
	"avatar",
	"badge",
	"breadcrumb",
	"button",
	"callout",
	"card",
	"chart",
	"checkbox",
	"code",
	"col",
	"copy",
	"diff",
	"divider",
	"file-tree",
	"grid",
	"input",
	"json",
	"keyvalue",
	"link",
	"list",
	"mermaid",
	"plot",
	"progress",
	"quiz",
	"radio",
	"row",
	"scene3d",
	"select",
	"slider",
	"spacer",
	"stat",
	"steps",
	"submit",
	"switch",
	"table",
	"tabs",
	"text",
	"textarea",
	"timeline",
	"video",
	"echart",
	"diagram"
]);
/**
* Count DECLARED nodes in a raw spec tree: objects whose `type` is a
* white-listed string, descending the same containers `countGenuiNodes`
* walks. `validate_dsh_ui` compares this with the repaired count to surface
* children the repair silently dropped (blank-render class of bugs, issue
* #42) instead of reporting a green check on a half-empty tree.
*/
function countDeclaredGenuiNodes(value, cap = Number.POSITIVE_INFINITY) {
	let count = 0;
	const declared = (candidate) => {
		const o = obj(candidate);
		return o !== void 0 && typeof o.type === "string" && GENUI_NODE_TYPES.has(o.type);
	};
	const walk = (list) => {
		if (!Array.isArray(list)) return;
		for (const item of list) {
			if (count >= cap) return;
			if (!declared(item)) continue;
			count += 1;
			const v = obj(item);
			if (v === void 0) continue;
			if (v.type === "tabs" && Array.isArray(v.tabs)) for (const t of v.tabs) walkItemsOf(t);
			else if (v.type === "accordion" && Array.isArray(v.items)) for (const it of v.items) walkItemsOf(it);
			else if ((v.type === "row" || v.type === "col" || v.type === "grid" || v.type === "card") && Array.isArray(v.items)) walk(v.items);
			else if (v.type === "list" && Array.isArray(v.items)) {
				for (const li of v.items) if (declared(li)) walk([li]);
			}
		}
	};
	const walkItemsOf = (holder) => {
		const o = obj(holder);
		if (o === void 0) return;
		const items = o.items !== void 0 ? o.items : o.content;
		if (Array.isArray(items)) walk(items);
		else if (declared(items)) walk([items]);
	};
	const root = obj(value);
	if (root === void 0) return count;
	if (!Array.isArray(root.items) && declared(value)) walk([value]);
	else walk(root.items);
	return count;
}
//#endregion
//#region src/shared/fence-repair.ts
/**
* Shared fence-body JSON repair — pure string functions, no DOM, no I/O.
* Used by BOTH the client fence renderer (tier-1/tier-2 auto-repair before
* rendering) and the node-side validate_dsh_ui tool (which returns the
* repaired JSON to the model instead of making it re-author the fix).
*
* Two tiers, deliberately gated differently by the callers:
* - Tier-1 (`repairFenceJson`): heals the most common model JSON typos that
*   do NOT change the body's structure — unescaped half-width quotes inside
*   string values and trailing commas. Safe at any time (streaming included),
*   adopted only when the WHOLE body parses afterwards.
* - Tier-2 (`completeFenceJson`): heals structural incompleteness — missing
*   closing quotes/brackets — by appending the missing terminators, and
*   skips mismatched closers (a `]` mistyped as `}`, duplicated terminators).
*   SETTLED MESSAGES ONLY: a streaming half must never be adopted as a
*   finished prefix.
* @module @omdsh-dev/dsh-genui/shared/fence-repair
*/
/** A fence body counts as complete when it parses as a whole JSON value. */
function isCompleteJson(raw) {
	try {
		JSON.parse(raw);
		return true;
	} catch {
		return false;
	}
}
/**
* Tier-2 repair — SETTLED MESSAGES ONLY (never while streaming): heals
* structural incompleteness — missing closing quotes/brackets — by appending
* the missing terminators, and heals stray closers — a `]` mistyped as `}` or
* a duplicated terminator — by skipping closers that do not match the open
* stack (they cannot be legal JSON). Callers gate it on settled messages (the
* client uses the host-provided fence source; the validate tool is by
* definition pre-emission), so a streaming half can never flash premature UI.
*
* ONE unified scan: the tier-1 fixes (quote escaping + trailing-comma drops)
* are folded into the same pass, so bodies that combine BOTH defect classes
* (a trailing comma AND a missing closer) heal in one shot — the old
* two-phase chain lost tier-1's partial work when its whole-body parse
* failed, and re-scanning the raw text could not compose the repairs.
* Adopted only when the completed body parses as whole JSON.
*
* Orphan siblings: a hand-written body may close a member VALUE array one
* bracket early and keep typing siblings after the next comma
* (`"rows":[[a],[b]],["c","d"]` — the `["c","d"]` is an orphan literal in
* object context, where only `"key":` pairs are legal). When the scan sees a
* `,` directly (modulo whitespace) after a just-closed value array and the
* next non-space char is `[` or `{`, it deletes that closer to reopen the
* array so the orphan becomes its next element. The same merge also fires for
* a BARE bracket orphan — the author dropped the comma entirely
* (`"rows":[[a],[b]] ["c","d"]`): at object member position (stack top `}`
* and expecting a key) a bracket literal is never legal, so the scan
* backtracks to the nearest just-closed key-value array, replaces its closer
* with the missing `,` and merges the orphan in as the next element. A value
* OBJECT closed early is deliberately NOT healed: deleting its `}` leaves
* the orphan's own `{...}` shell as a bare literal inside the object
* (`{"a":1,{"b":2}}`), which is still invalid — no single deletion can make
* it parse.
*
* Truncated degradation: when the scan DID repair something but the completed
* body still does not parse (damage no heal can fix), the repairer does not
* give up. Every orphan/merge point in an object member list records a
* truncation candidate — the prefix emitted before it plus the closers open
* at that moment. The fallback drops the orphan tail and keeps the longest
* repaired prefix that parses as whole JSON on its own (never an empty
* `{}`/`[]` shell): partial UI beats a diagnostic banner. The result then
* carries `truncated: true` so callers can surface that content was DROPPED
* instead of rendering the degraded prefix as if nothing was lost. Bodies
* where the scan repaired nothing, or that carry no orphan truncation point,
* still fail honestly with null.
*/
function completeFenceJson(raw) {
	try {
		JSON.parse(raw);
		return null;
	} catch {}
	const danglingType = /^\{([\s\S]*)\}\s*,?\s*"type"\s*:\s*"([a-z0-9-]+)"\s*$/.exec(raw);
	if (danglingType !== null && !/^"type"\s*:/.test(danglingType[1])) {
		const candidate = `{"type":"${danglingType[2]}",${danglingType[1]}}`;
		try {
			JSON.parse(candidate);
			return {
				text: candidate,
				repairs: 1
			};
		} catch {}
	}
	let out = "";
	const stack = [];
	let inString = false;
	let escaped = false;
	let repairs = 0;
	let pendingEqualsColon = false;
	let expectingKey = true;
	let thisStringIsKey = false;
	let valueCloserIndex = -1;
	let valueCloserChar = "";
	const cuts = [];
	const noteCut = () => {
		cuts.push({
			at: out.length,
			open: [...stack]
		});
	};
	const freshMemberArray = () => stack[stack.length - 1] === "}" && valueCloserChar === "]" && valueCloserIndex >= 0 && out[valueCloserIndex] === valueCloserChar && out.slice(valueCloserIndex + 1).trim() === "";
	for (let i = 0; i < raw.length; i++) {
		const ch = raw[i];
		if (pendingEqualsColon && ch === "=") {
			out += ":";
			pendingEqualsColon = false;
			repairs++;
			continue;
		}
		if (inString && ch === "=" && thisStringIsKey) {
			out += "\"";
			out += ":";
			inString = false;
			thisStringIsKey = false;
			expectingKey = false;
			repairs++;
			continue;
		}
		if (escaped) {
			out += ch;
			escaped = false;
			continue;
		}
		if (inString) {
			if (ch === "\\") {
				out += ch;
				escaped = true;
				continue;
			}
			if (ch !== "\"") {
				out += ch;
				continue;
			}
			let j = i + 1;
			while (j < raw.length && (raw[j] === " " || raw[j] === "	" || raw[j] === "\n" || raw[j] === "\r")) j++;
			const next = j < raw.length ? raw[j] : "";
			if (next === "," || next === "]" || next === "}" || next === ":" || next === "=" || next === "") {
				inString = false;
				out += ch;
				pendingEqualsColon = next === "=";
			} else {
				out += "\\\"";
				repairs++;
			}
			continue;
		}
		if (ch === "\"") {
			inString = true;
			thisStringIsKey = expectingKey;
			out += ch;
			continue;
		}
		if (ch === "{") {
			if (stack[stack.length - 1] === "}" && expectingKey) {
				if (freshMemberArray()) {
					out = out.slice(0, valueCloserIndex) + "," + out.slice(valueCloserIndex + 1);
					stack.push("]");
					valueCloserIndex = -1;
					valueCloserChar = "";
					repairs++;
					noteCut();
				} else noteCut();
			}
			stack.push("}");
			expectingKey = true;
			out += ch;
			continue;
		}
		if (ch === "[") {
			if (stack[stack.length - 1] === "}" && expectingKey) {
				if (freshMemberArray()) {
					out = out.slice(0, valueCloserIndex) + "," + out.slice(valueCloserIndex + 1);
					stack.push("]");
					valueCloserIndex = -1;
					valueCloserChar = "";
					repairs++;
					noteCut();
				} else noteCut();
			}
			stack.push("]");
			expectingKey = true;
			out += ch;
			continue;
		}
		if (ch === "}" || ch === "]") {
			if (stack[stack.length - 1] === ch) {
				stack.pop();
				out += ch;
				if (stack[stack.length - 1] === "}") {
					valueCloserIndex = out.length - 1;
					valueCloserChar = ch;
				}
			} else repairs++;
			continue;
		}
		if (ch === ",") {
			let j = i + 1;
			while (j < raw.length && (raw[j] === " " || raw[j] === "	" || raw[j] === "\n" || raw[j] === "\r")) j++;
			const next = j < raw.length ? raw[j] : "";
			if (next === "}" || next === "]" || next === "") {
				repairs++;
				continue;
			}
			if (next === "[" || next === "{") {
				if (freshMemberArray()) {
					out = out.slice(0, valueCloserIndex) + out.slice(valueCloserIndex + 1);
					stack.push("]");
					valueCloserIndex = -1;
					valueCloserChar = "";
					repairs++;
					noteCut();
				} else if (stack[stack.length - 1] === "}") noteCut();
			}
			expectingKey = true;
		} else if (ch === ":" && !inString) expectingKey = false;
		out += ch;
	}
	if (inString) {
		out += "\"";
		repairs++;
	}
	while (stack.length > 0) {
		out += stack.pop();
		repairs++;
	}
	if (repairs === 0) return null;
	if (isCompleteJson(out)) return {
		text: out,
		repairs
	};
	for (let k = cuts.length - 1; k >= 0; k--) {
		const cut = cuts[k];
		const candidate = out.slice(0, cut.at).replace(/,\s*$/u, "") + cut.open.slice().reverse().join("");
		if (candidate === "{}" || candidate === "[]") continue;
		if (isCompleteJson(candidate)) return {
			text: candidate,
			repairs: repairs + 1,
			truncated: true
		};
	}
	return null;
}
//#endregion
//#region src/plugin/tool.ts
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
		description: "GenUI component tree (white-listed vocabulary, see the dsh-ui fence section in the system prompt). Deep-validated and repaired by the renderer. Pass the spec as a JSON OBJECT — never as a serialized JSON string (a string fails argument validation).",
		properties: {
			title: {
				type: "string",
				description: "Short title shown as the card banner."
			},
			gap: {
				type: "number",
				description: "Vertical gap between root items in px."
			},
			panel: {
				type: "boolean",
				description: "Panel-only: renders into the session panel dock instead of the message flow."
			},
			items: {
				type: "array",
				description: "Root component list (white-listed vocabulary).",
				items: { type: "object" }
			}
		}
	} },
	required: ["spec"],
	additionalProperties: false
};
/** The tool's canonical value is a short model-facing summary string. */
const RENDER_UI_OUTPUT_SCHEMA = {
	type: "string",
	description: "One-line human-readable render summary for the model."
};
/**
* Read the `spec` argument defensively (presenters run on replayed args).
*
* The harness tool-call bridge has been observed to deliver arguments in
* shapes other than the authored `{ spec: <object> }`:
* - `{ spec: "<JSON string>" }` — spec serialized to text;
* - `{ arguments: "<JSON string>" }` / `{ arguments: <object> }` — a
*   double-encoded wrapper from the SDK tool-call bridge (seen live in the
*   web GUI: small specs arrived wrapped this way, large specs arrived with
*   their JSON corrupted mid-stream);
* - a bare JSON string (double-encoded root).
* Each shape is unwrapped here so the guard can repair the actual tree.
* Corrupted JSON cannot be recovered (bytes were lost in transit): it yields
* `undefined` plus a diagnostic log line for the transport-layer bug.
*/
function specOf(args) {
	if (typeof args === "string") return parseSpecJson(args, "bare-string");
	if (typeof args !== "object" || args === null) return void 0;
	const record = args;
	if ("spec" in record) {
		const s = record.spec;
		if (typeof s === "string") return parseSpecJson(s, "spec-string");
		return unwrapSpec(s, "spec");
	}
	if ("arguments" in record) {
		const a = record.arguments;
		if (typeof a === "string") return parseSpecJson(a, "arguments-string");
		if (typeof a === "object" && a !== null) return unwrapSpec(a, "arguments");
	}
}
/**
* Peel nested `{ spec: ... }` wrapper layers. Observed bridge shapes nest the
* authored `spec` object one or more levels deep (e.g. the serialized text
* inside `{ arguments: "..." }` is itself `{ spec: { title, gap, items } }`),
* so unwrapping stops only at a value that carries no `spec` key.
*/
function unwrapSpec(value, shape) {
	if (typeof value === "object" && value !== null) {
		const record = value;
		if ("spec" in record) {
			const s = record.spec;
			if (typeof s === "string") return parseSpecJson(s, `${shape}/spec-string`);
			return unwrapSpec(s, `${shape}/spec`);
		}
	}
	return value;
}
/** Try to decode a serialized spec; log a diagnostic when it is broken. */
function parseSpecJson(raw, shape) {
	try {
		return unwrapSpec(JSON.parse(raw), shape);
	} catch (error) {
		const detail = error instanceof Error ? error.message : String(error);
		const pos = /position (\d+)/.exec(detail)?.[1] ?? "?";
		console.error(`[genui-tool] spec wrapped as ${shape} but its JSON is broken (${raw.length} bytes, error at ${pos}); cannot recover — bytes lost in transit`);
		return;
	}
}
/** Total node count of a repaired spec — the shared guard traversal
* (`countGenuiNodes`) so the tool reports the SAME number the panel fold and
* validation use. A local walker used to under-count specs whose content
* lives inside tabs/accordion/file-tree (their children are not `.items`). */
function countNodes(spec) {
	return countGenuiNodes(spec, GENUI_LIMITS.maxNodes);
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
/**
* The `validate_dsh_ui` tool: a model-facing pre-flight check for the
* ```dsh-ui fence channel. The model calls it with the JSON text it is about
* to put inside a fence; it reports whether the body parses as a valid GenUI
* spec, and when it does not, WHERE it breaks and WHAT is likely wrong
* (bracket counts, common typo classes) so the model can fix and re-validate
* before emitting — turning "render a red banner after the fact" into
* "verify before you send". Purely local: no LLM, no network, no DOM.
*/
const VALIDATE_DESCRIPTION = "Validate the JSON body of a ```dsh-ui fence BEFORE emitting it — required when the spec contains a table/chart or a nested container (row/col/grid/card/tabs/accordion) at any level, or has ≥2 nodes; skip only for a single flat node. Pass the exact JSON text you are about to put inside the fence as the \"spec\" argument (a string). Returns an object: ok=true means the fence may be emitted, ok=false means fix first; every result carries a model-facing message, and when repair had to stitch or drop anything a diagnostics list (renamed / dropped-unknown-key / dropped-node) names each one — renamed means usable but switch to the canonical name. When the JSON is broken but repairable (unescaped quotes, trailing commas, missing closers), the ❌ reply INCLUDES the auto-repaired JSON — copy it verbatim into the fence instead of rewriting by hand.";
const VALIDATE_PARAMETERS = {
	type: "object",
	properties: { spec: {
		oneOf: [{
			type: "string",
			description: "The exact JSON text of the fence body."
		}, {
			type: "object",
			description: "The spec object (serialized before validation)."
		}],
		description: "The dsh-ui fence body to validate: pass the JSON as a string for an exact check, or as the spec object."
	} },
	required: ["spec"],
	additionalProperties: false
};
/** Read the fence-body text from the call args (string preferred, object serialized). */
function fenceTextOf(args) {
	if (typeof args === "string") return args;
	if (typeof args !== "object" || args === null) return null;
	const record = args;
	const s = "spec" in record ? record.spec : "arguments" in record ? record.arguments : void 0;
	if (typeof s === "string") return s;
	if (typeof s === "object" && s !== null) return JSON.stringify(s);
	return null;
}
/** Count structural brackets outside string literals. */
function bracketCounts(raw) {
	const counts = {
		"{": 0,
		"}": 0,
		"[": 0,
		"]": 0
	};
	let inString = false;
	let escaped = false;
	for (let i = 0; i < raw.length; i++) {
		const ch = raw[i];
		if (escaped) {
			escaped = false;
			continue;
		}
		if (inString) {
			if (ch === "\\") escaped = true;
			else if (ch === "\"") inString = false;
			continue;
		}
		if (ch === "\"") {
			inString = true;
			continue;
		}
		if (ch === "{") counts["{"] += 1;
		else if (ch === "}") counts["}"] += 1;
		else if (ch === "[") counts["["] += 1;
		else if (ch === "]") counts["]"] += 1;
	}
	return counts;
}
/** Short structural hint from bracket counts (empty when balanced). */
function bracketDiagnostic(raw) {
	const c = bracketCounts(raw);
	const diffs = [];
	if (c["{"] !== c["}"]) {
		const d = c["{"] - c["}"];
		diffs.push(`{ ×${c["{"]} / } ×${c["}"]} → ${d > 0 ? `缺 ${d} 个 }` : `多 ${-d} 个 }`}`);
	}
	if (c["["] !== c["]"]) {
		const d = c["["] - c["]"];
		diffs.push(`[ ×${c["["]} / ] ×${c["]"]} → ${d > 0 ? `缺 ${d} 个 ]` : `多 ${-d} 个 ]`}`);
	}
	return diffs.length === 0 ? "" : `  括号计数：${diffs.join("；")}（长表格最易在收尾处错位，如把 ]]}]} 写成 ]}]}]}）\n`;
}
const COMMON_CAUSES = "常见原因：① 收尾括号错位/缺失（{ 与 }、[ 与 ] 数量不相等）② 字符串值内用了半角引号 \"（中文引语请用 “” 或 「」）③ 尾随逗号 ④ 字符串未闭合";
/**
* Project repair diagnostics to plain object literals. The tool's canonical
* value must satisfy `JsonValue` (a recursive index-signature type), and the
* `GenuiRepairDiagnostic` INTERFACE has no implicit index signature — a
* field-by-field literal keeps the return type honest.
*/
function toDiagnostics(diag) {
	return diag.map((d) => ({
		kind: d.kind,
		path: d.path,
		detail: d.detail
	}));
}
/**
* Output schema: the verdict is an OBJECT — `ok` + model-facing `message`,
* plus `diagnostics` (the guard's GenuiRepairDiagnostic list: renamed /
* dropped-unknown-key / dropped-node) whenever the repair walk had to stitch
* or drop anything (K3 audit #8). Absent `diagnostics` = fully silent repair.
*/
const VALIDATE_OUTPUT_SCHEMA = {
	type: "object",
	description: "Validation verdict: ok flag, model-facing message, and repair diagnostics (renamed / dropped-unknown-key / dropped-node) when repair stitched or dropped anything.",
	properties: {
		ok: {
			type: "boolean",
			description: "Whether the spec is valid and the fence may be emitted."
		},
		message: {
			type: "string",
			description: "Human-readable verdict text (✅ ready / ❌ fix first)."
		},
		diagnostics: {
			type: "array",
			description: "Repair diagnostics from the guard; absent when nothing was stitched or dropped.",
			items: {
				type: "object",
				properties: {
					kind: {
						type: "string",
						enum: [
							"renamed",
							"dropped-unknown-key",
							"dropped-node"
						],
						description: "renamed = alias key consumed as its canonical name; dropped-unknown-key = field not in the type field table; dropped-node = whole node dropped."
					},
					path: {
						type: "string",
						description: "Dotted path of the node in the spec tree, e.g. items[2]."
					},
					detail: {
						type: "string",
						description: "One-line explanation of what was stitched or dropped."
					}
				},
				required: [
					"kind",
					"path",
					"detail"
				],
				additionalProperties: false
			}
		}
	},
	required: ["ok", "message"],
	additionalProperties: false
};
/** Build the validate_dsh_ui tool definition (registered alongside render_ui). */
function createValidateDshUiTool() {
	return {
		name: "validate_dsh_ui",
		description: VALIDATE_DESCRIPTION,
		parameters: VALIDATE_PARAMETERS,
		output: {
			schema: VALIDATE_OUTPUT_SCHEMA,
			render(_args, value) {
				const verdict = typeof value === "object" && value !== null && !Array.isArray(value) && "message" in value ? value : void 0;
				if (verdict === void 0) return [{
					type: "text",
					text: typeof value === "string" ? value : JSON.stringify(value)
				}];
				let text = String(verdict.message);
				if (Array.isArray(verdict.diagnostics)) {
					for (const d of verdict.diagnostics) if (typeof d === "object" && d !== null && "detail" in d) text += `\n- ${String(d.detail)}`;
				}
				return [{
					type: "text",
					text
				}];
			}
		},
		async execute(args) {
			const raw = fenceTextOf(args);
			if (raw === null || raw.trim() === "") return {
				ok: false,
				message: "❌ validate_dsh_ui：缺少 spec 参数 —— 把围栏 JSON 文本作为 spec 传入。"
			};
			let parsed;
			try {
				parsed = JSON.parse(raw);
			} catch (error) {
				const detail = error instanceof Error ? error.message : String(error);
				const repaired = completeFenceJson(raw);
				if (repaired !== null) {
					const repairedDiag = [];
					if (repairGenuiSpec(JSON.parse(repaired.text), repairedDiag) !== null) {
						const renamedCount = repairedDiag.filter((d) => d.kind === "renamed").length;
						const truncatedWarn = repaired.truncated === true ? "（截断降级：部分内容因格式错误被丢弃，下面只是可用前缀，发出前请核对是否缺内容）" : "";
						const warn = renamedCount > 0 ? `  ⚠️ 修复后的 JSON 仍含 ${renamedCount} 处别名键：能用但请改用正名。\n` : "";
						return {
							ok: false,
							message: `❌ dsh-ui 围栏 JSON 解析失败：${detail}。\n${bracketDiagnostic(raw)}  已自动修复 ${repaired.repairs} 处${truncatedWarn}，下面是修复后的 JSON，直接作为围栏正文发出即可（无需再验证）：\n${warn}\`\`\`\n${repaired.text}\n\`\``,
							...repairedDiag.length > 0 ? { diagnostics: toDiagnostics(repairedDiag) } : {}
						};
					}
				}
				return {
					ok: false,
					message: `❌ dsh-ui 围栏 JSON 解析失败：${detail}。\n${bracketDiagnostic(raw)}  自动修复未能恢复（结构损坏），请按错误信息修正后重新调用本工具验证，通过后再发出围栏。\n${COMMON_CAUSES}`
				};
			}
			const diag = [];
			const spec = repairGenuiSpec(parsed, diag);
			if (spec === null) return {
				ok: false,
				message: "❌ 不是合法 GenUI spec：根对象需要 \"items\" 数组，且每个节点 type 必须在白名单内（见系统提示词）。请修正后重新验证。",
				...diag.length > 0 ? { diagnostics: toDiagnostics(diag) } : {}
			};
			const validCount = countNodes(spec);
			const declaredCount = countDeclaredGenuiNodes(parsed, GENUI_LIMITS.maxNodes + 1);
			if (declaredCount > validCount) return {
				ok: false,
				message: `❌ 验证未通过：检测到声明了 ${declaredCount} 个组件，但仅成功解析出 ${validCount} 个（有 ${declaredCount - validCount} 个组件因字段格式异常被丢弃）。常见原因：table 的 columns/rows 不是二维字符串数组、tabs 的 items/content 缺失、嵌套组件字段类型不符。请修正后重新验证。`,
				...diag.length > 0 ? { diagnostics: toDiagnostics(diag) } : {}
			};
			const renamed = diag.filter((d) => d.kind === "renamed");
			const dropped = diag.filter((d) => d.kind !== "renamed");
			let message = `✅ dsh-ui spec 合法（${validCount} 个组件），可以发出围栏。`;
			if (renamed.length > 0) message += ` ⚠️ ${renamed.length} 处别名键已自动缝补——能用但请改用正名。`;
			if (dropped.length > 0) message += ` ⚠️ ${dropped.length} 处非法/多余键被无声丢弃——逐键比对字段表。`;
			return {
				ok: true,
				message,
				...diag.length > 0 ? { diagnostics: toDiagnostics(diag) } : {}
			};
		},
		presentCall() {
			return {
				card: "generic",
				title: "验证 dsh-ui 围栏",
				kind: "other"
			};
		},
		presentResult() {
			return {
				card: "generic",
				title: "验证 dsh-ui 围栏"
			};
		}
	};
}
//#endregion
//#region src/plugin/index.ts
/** Convention: tool guidance uses 100–199; bash's section is 104. */
const GENUI_SECTION_ORDER = 105;
/**
* The mermaid/three engines ship as standalone IIFE bundles under
* `lib/assets/` and are fetched by the client ONLY when a spec needs them.
* This route serves them from the plugin's own package directory through the
* host webserver service — the longest-prefix rule lets it win over the
* generic `/plugins` bundle route, and no host source change is needed. The
* service is optional at this plugin's start time (same ordering reality as
* the tools registry), so registration probes immediately AND on the
* `internal/service` event, exactly like the tools registration below.
*/
/** Route prefix under /plugins; anything under it is this plugin's asset. */
const ASSET_ROUTE_PATH = "/plugins/@omdsh-dev/dsh-genui/assets";
/** Safe flat file names only: no slashes, no traversal, js assets only. */
const ASSET_FILE_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*\.js$/;
/** The handler itself (registered via the optional webServer probe). */
async function serveGenuiAsset(req, res) {
	if (req.method !== "GET" && req.method !== "HEAD") {
		res.writeHead(405);
		res.end();
		return;
	}
	let pathname;
	try {
		pathname = decodeURIComponent(new URL(req.url ?? "/", "http://x").pathname);
	} catch {
		res.writeHead(400);
		res.end();
		return;
	}
	const rel = pathname.startsWith(`${ASSET_ROUTE_PATH}/`) ? pathname.slice(36) : null;
	if (rel === null) {
		res.writeHead(404);
		res.end();
		return;
	}
	const file = rel.slice(1);
	if (!ASSET_FILE_RE.test(file)) {
		res.writeHead(404);
		res.end();
		return;
	}
	try {
		const dir = fileURLToPath(new URL("./assets/", import.meta.url));
		const body = await readFile(join(dir, file));
		res.writeHead(200, {
			"content-type": "text/javascript; charset=utf-8",
			"cache-control": "public, max-age=31536000, immutable"
		});
		res.end(body);
	} catch {
		res.writeHead(404);
		res.end();
	}
}
/** The fence language description injected into every assembled system prompt.
*  Deliberately slim: the `genui` skill carries the full component→field
*  mapping; this section keeps only the contract that must always be
*  present (fence syntax, type whitelist, and critical behavioral rules). */
const GENUI_SECTION_TEXT = `You can render interactive UI components INSIDE your reply — between paragraphs — by emitting a fenced block with the language tag \`dsh-ui\` containing a JSON spec:

\`\`\`dsh-ui
{"title":"可选标题","gap":14,"items":[...]}
\`\`\`

The spec is a white-listed component tree rendered inline where the fence sits. Only these \`type\` values; the \`genui\` skill, when available, carries the full content→component mapping and per-component field details:

- 布局: text · row · col · grid · card · divider · spacer
- 展示: badge · stat · progress · list · table · keyvalue · avatar · audio · video · timeline · file-tree · breadcrumb · callout · steps · diff · json · code · copy
- 图表: chart (bars|line|donut) · echart (preset|option) · plot (函数图)
- 交互: button · input · textarea · select · checkbox · switch · slider · radio · submit · quiz · link · tabs · accordion
- 高级: mermaid (flowchart/sequence/class/gantt/pie/er/state/journey) · diagram (编辑级架构/流程图，27 种 kind) · scene3d (3D WebGL)
Field table — one line per type, canonical names ONLY (missing required → node dropped; 可选 = may be omitted):
- text: content(string)必填；size可选(h1|h2|h3|body|muted|caption)；center可选(true)
- row: items(节点数组)必填；wrap可选(true)；spacer可选(true)
- col: items(节点数组)必填；gap可选(数字)
- grid: items(节点数组)必填；cols可选(数字)
- card: items(节点数组)必填；title可选(string)
- divider: 无字段
- spacer: 无字段
- badge: label(string)必填；tone可选(success|warn|danger|accent)；icon可选
- stat: label+value必填；delta可选；unit可选
- progress: value(0–100数字)必填；label/valueLabel可选
- list: items必填
- table: columns(string数组)+rows(二维数组)必填
- keyvalue: pairs({key,value}数组)必填
- avatar: name(string)必填；color可选
- audio: src(string)必填；alt/loop可选
- video: src(string)必填；poster/loop/muted/aspectRatio可选(16:9|4:3|1:1|9:16)
- timeline: items必填
- file-tree: items必填
- breadcrumb: items(string数组)必填
- callout: content(string)必填；tone可选(info|success|warning|error)；title可选
- steps: steps({title}数组)必填；current可选(数字)
- diff: diffs({path,oldText,newText}数组)必填
- json: value(任意JSON)必填
- code: code(string)必填；lang可选
- copy: text(string)必填；label可选
- chart: data({label,value}数组)或series必填；kind可选(bars|line|donut)
- echart: 预设用 data/series、完整配置用 option，至少其一必填；title/height可选；preset可选(bar|line|area|pie|scatter)
- plot: series({expr}数组)必填；xMin/xMax/yMin/yMax可选(数字)
- button: label(string)必填；tone可选(primary|danger|success|ghost)；action/full/small/icon可选
- input: 全部可选(label/placeholder/value/inputType/action/id)
- textarea: 全部可选(label/placeholder/rows/value/action/id)
- checkbox: label(string)必填；checked/action可选
- switch: label(string)必填；checked/action可选
- slider: min/max/step/value(数字，缺省0–100)；label/action可选
- select: options(string数组)必填；label/selected/action可选
- radio: options(string数组)必填；group/answer/explanation可选
- submit: label(string)必填；action/groups可选
- quiz: question(string)+options必填；explanation可选
- link: label(string)必填；href可选(http[s]/mailto)
- tabs: tabs({label,items}数组)必填
- accordion: items({title,items}数组)必填
- mermaid: code(string)必填
- scene3d: meshes(1–5个)必填；title/background可选
- diagram: kind+nodes({id,label}数组)必填；edges/zones/variant/title/theme可选

高频错误黑名单（发出前自查，validate_dsh_ui 会提示）: ① callout/badge 写 type_ —— 正名是 tone；② code/mermaid 写 value —— 正名是 code；③ table 写 headers —— 正名是 columns。

Rules:
- 触发: 结构化表达优于纯文本时主动用（要点、强调、对比、流程、步骤、状态、数据、演示），纯问答与一句话不套 UI；一个主题一个主组件，每次 3–8 个组件，同一数据不重复出现。
- JSON 严格: 坏围栏降级为代码块；含图表/嵌套容器（row/col/grid/card/tabs/accordion）任一层级 或 节点数≥2 的围栏发出前调用 validate_dsh_ui，❌ 修好再发（若附「已自动修复」JSON 照抄即可）；table 的 rows≥5 行同样必须先验证，验证失败且无法自动修复时拆成 ≤5 行小表或多个 list/keyvalue 卡片替代，禁止重发同形态大表。
- 键名纪律: 节点的键只取自字段表，多余或拼错的可选字段名会被渲染器无声丢弃、不给任何警告；写完逐键比对字段表。
- 规模: ≤200 节点、嵌套≤8 层（超出被截断）；3D mesh 1–5；plot 给合理 xMin/xMax。
- LOCAL-FIRST + actions: UI 能自己做的状态变化（判卷、判题、重置、展开、选中）就地完成，零往返；action 只用于必须模型参与的事。交互组件带 "action":"name"，交互以 [genui-action] name + 组件数据回传，届时重渲染更新 UI；无 action 的按钮禁用。
- Durable state: 交互状态按「会话+内容指纹」持久化——刷新/重放恢复；重渲染相同内容保留，新内容重置。
- 卷子模式: 每题一个 radio（group+answer+explanation）+ 一个 submit（groups 全列），本地判分。
- Secrets ban: 不索取密码、API Key、Token、恢复码；需要时拒绝并解释。
- Tool channel: render_ui 工具把同一 spec 渲染为工具行卡片（交付物型界面用）；围栏用于回答内联 UI。
- Panel: "panel":true 只渲染进会话面板 dock 并原地更新；"append":true 追加合并（同标签 tabs 追加/新标签加入/尾部追加）；上限 200 节点/200 次追加，满了发 replace 重建。面板组件来的 [genui-action] 只回一个 panel:true 围栏 + 至多一行 10 字内确认，不解释、不用普通围栏。`;
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
		tools.register(createValidateDshUiTool());
		registered = true;
	};
	tryRegister(void 0);
	ctx.on("internal/service", (name, value) => {
		if (name === "tools") tryRegister(value);
	});
	let assetsRegistered = false;
	const tryRegisterAssets = (value) => {
		if (assetsRegistered) return;
		const webServer = value ?? ctx.reflect.get("webServer", false);
		if (webServer === void 0) return;
		webServer.register({
			kind: "prefix",
			path: ASSET_ROUTE_PATH,
			handler: serveGenuiAsset
		});
		assetsRegistered = true;
	};
	tryRegisterAssets(void 0);
	ctx.on("internal/service", (name, value) => {
		if (name === "webServer") tryRegisterAssets(value);
	});
}
//#endregion
export { GENUI_SECTION_ORDER, GENUI_SECTION_TEXT, apply, inject };
