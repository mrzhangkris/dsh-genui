import type { GenuiBlockProps } from './blocks/state.ts';
export declare const GENUI_ACTION_DEBOUNCE_MS = 300;
/** Durable-state save debounce: keystroke-paced `fields` updates collapse
 * into one localStorage write; the unmount/key-change flush covers the tail.
 * Exported for the durable-state tests (they previously redeclared 300). */
export declare const SAVE_DEBOUNCE_MS = 300;
export declare const GenuiBlock: import("react").NamedExoticComponent<GenuiBlockProps>;
