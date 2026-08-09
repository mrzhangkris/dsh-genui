import type { GenuiClassify, GenuiFormula, GenuiMatch, GenuiSimulation, GenuiSlider, GenuiSort } from './spec.ts';
type Action = ((action: string, payload: Record<string, unknown>) => void) | undefined;
export declare function SliderNode({ node, onAction }: {
    node: GenuiSlider;
    onAction: Action;
}): import("react").JSX.Element;
export declare function FormulaNode({ node }: {
    node: GenuiFormula;
}): import("react").JSX.Element;
export declare function SortNode({ node, onAction }: {
    node: GenuiSort;
    onAction: Action;
}): import("react").JSX.Element;
export declare function MatchNode({ node, onAction }: {
    node: GenuiMatch;
    onAction: Action;
}): import("react").JSX.Element;
export declare function ClassifyNode({ node, onAction }: {
    node: GenuiClassify;
    onAction: Action;
}): import("react").JSX.Element;
export declare function SimulationNode({ node, onAction }: {
    node: GenuiSimulation;
    onAction: Action;
}): import("react").JSX.Element;
export {};
//# sourceMappingURL=LearningBlocks.d.ts.map