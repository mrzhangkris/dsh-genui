import type { ComponentType } from 'react';
export type GenuiActionHandler = (action: string, payload: Record<string, unknown>) => void;
export type GenuiCustomNode = {
    type: string;
    [key: string]: unknown;
};
export declare function useGenuiAction(): GenuiActionHandler | undefined;
export declare function getGenuiComponent(_type: string): ComponentType<never> | undefined;
export declare function CodeBlock({ code, lang }: {
    code: string;
    lang?: string;
}): import("react").JSX.Element;
export declare function JsonTree({ data }: {
    data: object | unknown[];
    copyable?: boolean;
}): import("react").JSX.Element;
export declare function DiffBlock({ diffs }: {
    diffs: Array<{
        path: string;
        oldText: string | null;
        newText: string;
    }>;
}): import("react").JSX.Element;
//# sourceMappingURL=standalone-primitives.d.ts.map