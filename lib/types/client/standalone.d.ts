export interface GenuiHostState {
    inputs?: Array<string | number | boolean>;
    tabs?: number[];
    switches?: boolean[];
    accordions?: Array<number | null>;
    quizzes?: Array<number | null>;
    formulas?: number[];
    simulations?: number[];
}
export interface GenuiMountOptions {
    initialState?: GenuiHostState;
    onAction?: (action: string, payload: Record<string, unknown>) => void;
    onStateChange?: (state: GenuiHostState) => void;
}
export interface GenuiMount {
    update(spec: unknown): void;
    snapshot(): GenuiHostState;
    dispose(): void;
}
export declare function snapshotGenuiState(root: Element): GenuiHostState;
export declare function restoreGenuiState(root: Element, state: GenuiHostState): void;
export declare function mountGenui(target: HTMLElement, rawSpec: unknown, options?: GenuiMountOptions): GenuiMount;
//# sourceMappingURL=standalone.d.ts.map