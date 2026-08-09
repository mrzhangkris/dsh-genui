import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
export function useGenuiAction() { return undefined; }
export function getGenuiComponent(_type) { return undefined; }
export function CodeBlock({ code, lang }) {
    return _jsx("pre", { "data-language": lang, children: _jsx("code", { children: code }) });
}
export function JsonTree({ data }) {
    return _jsx("pre", { children: _jsx("code", { children: JSON.stringify(data, null, 2) }) });
}
export function DiffBlock({ diffs }) {
    return _jsx("div", { children: diffs.map(diff => _jsxs("pre", { children: [_jsx("strong", { children: diff.path }), `\n${diff.oldText ?? ''}\n→\n${diff.newText}`] }, diff.path)) });
}
//# sourceMappingURL=standalone-primitives.js.map