import { jsx as _jsx } from "react/jsx-runtime";
import { createRoot } from 'react-dom/client';
import { GenuiBlock } from "./GenuiBlock.js";
import { repairGenuiSpec } from "./guard.js";
function numbers(root, selector, attribute) {
    return [...root.querySelectorAll(selector)].map(item => Number(item.getAttribute(attribute) ?? 0));
}
export function snapshotGenuiState(root) {
    const inputs = [...root.querySelectorAll('input, select, textarea')]
        .filter(input => input.type !== 'radio')
        .map(input => input instanceof HTMLInputElement && (input.type === 'checkbox' || input.type === 'range')
        ? input.type === 'checkbox' ? input.checked : Number(input.value)
        : input.value);
    return {
        inputs,
        tabs: numbers(root, '[data-genui-tabs]', 'data-active'),
        switches: [...root.querySelectorAll('[role="switch"]')].map(item => item.getAttribute('aria-checked') === 'true'),
        accordions: [...root.querySelectorAll('[data-genui-accordion]')].map(item => {
            const value = item.getAttribute('data-open');
            return value === null || value === '' ? null : Number(value);
        }),
        quizzes: [...root.querySelectorAll('[data-genui-quiz]')].map(item => {
            const value = item.getAttribute('data-selected');
            return value === null || value === '' ? null : Number(value);
        }),
        formulas: numbers(root, '[data-genui-formula]', 'data-visible'),
        simulations: numbers(root, '[data-genui-simulation]', 'data-current'),
    };
}
function clickAt(nodes, values, childSelector) {
    values?.forEach((value, index) => {
        const parent = nodes[index];
        if (parent === undefined || value === null)
            return;
        parent.querySelectorAll(childSelector)[value]?.click();
    });
}
export function restoreGenuiState(root, state) {
    const fields = [...root.querySelectorAll('input, select, textarea')]
        .filter(input => input.type !== 'radio');
    state.inputs?.forEach((value, index) => {
        const field = fields[index];
        if (field === undefined)
            return;
        if (field instanceof HTMLInputElement && field.type === 'checkbox')
            field.checked = Boolean(value);
        else
            field.value = String(value);
        field.dispatchEvent(new Event('input', { bubbles: true }));
        field.dispatchEvent(new Event('change', { bubbles: true }));
    });
    clickAt(root.querySelectorAll('[data-genui-tabs]'), state.tabs, '[role="tab"]');
    state.switches?.forEach((value, index) => {
        const item = root.querySelectorAll('[role="switch"]')[index];
        if (item !== undefined && (item.getAttribute('aria-checked') === 'true') !== value)
            item.click();
    });
    state.accordions?.forEach((value, index) => {
        const item = root.querySelectorAll('[data-genui-accordion]')[index];
        if (item === undefined)
            return;
        const currentText = item.getAttribute('data-open');
        const current = currentText === null || currentText === '' ? null : Number(currentText);
        if (current === value)
            return;
        const buttons = item.querySelectorAll('button[aria-expanded]');
        if (value === null)
            buttons[current ?? -1]?.click();
        else
            buttons[value]?.click();
    });
    clickAt(root.querySelectorAll('[data-genui-quiz]'), state.quizzes, 'button:not([class*="Retry"])');
    state.formulas?.forEach((value, index) => {
        const item = root.querySelectorAll('[data-genui-formula]')[index];
        if (item === undefined)
            return;
        const current = Number(item.getAttribute('data-visible') ?? 0);
        const buttons = item.querySelectorAll('button');
        const button = value > current ? buttons[1] : buttons[0];
        for (let count = 0; button !== undefined && count < Math.abs(value - current); count += 1)
            button.click();
    });
    clickAt(root.querySelectorAll('[data-genui-simulation]'), state.simulations, '[class*="simulationTrack"] button');
}
export function mountGenui(target, rawSpec, options = {}) {
    const root = createRoot(target);
    let spec = repairGenuiSpec(rawSpec);
    let savedState = options.initialState;
    let observer = null;
    let notifyTimer;
    const notify = () => {
        if (options.onStateChange === undefined)
            return;
        if (notifyTimer !== undefined)
            clearTimeout(notifyTimer);
        notifyTimer = setTimeout(() => {
            savedState = snapshotGenuiState(target);
            options.onStateChange?.(savedState);
        }, 80);
    };
    const render = () => {
        root.render(spec === null ? null : _jsx(GenuiBlock, { spec: spec, onAction: options.onAction }));
        setTimeout(() => {
            if (savedState !== undefined)
                restoreGenuiState(target, savedState);
            observer ??= new MutationObserver(notify);
            observer.observe(target, { attributes: true, childList: true, subtree: true });
            target.addEventListener('input', notify);
            target.addEventListener('change', notify);
            target.addEventListener('click', notify);
        });
    };
    render();
    return {
        update(next) { savedState = snapshotGenuiState(target); spec = repairGenuiSpec(next); render(); },
        snapshot() { return snapshotGenuiState(target); },
        dispose() {
            observer?.disconnect();
            if (notifyTimer !== undefined)
                clearTimeout(notifyTimer);
            target.removeEventListener('input', notify);
            target.removeEventListener('change', notify);
            target.removeEventListener('click', notify);
            root.unmount();
        },
    };
}
//# sourceMappingURL=standalone.js.map