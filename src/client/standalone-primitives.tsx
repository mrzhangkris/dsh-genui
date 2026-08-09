import type { ComponentType } from 'react'

export type GenuiActionHandler = (action: string, payload: Record<string, unknown>) => void
export type GenuiCustomNode = { type: string; [key: string]: unknown }

export function useGenuiAction(): GenuiActionHandler | undefined { return undefined }
export function getGenuiComponent(_type: string): ComponentType<never> | undefined { return undefined }

export function CodeBlock({ code, lang }: { code: string; lang?: string }) {
  return <pre data-language={lang}><code>{code}</code></pre>
}

export function JsonTree({ data }: { data: object | unknown[]; copyable?: boolean }) {
  return <pre><code>{JSON.stringify(data, null, 2)}</code></pre>
}

export function DiffBlock({ diffs }: { diffs: Array<{ path: string; oldText: string | null; newText: string }> }) {
  return <div>{diffs.map(diff => <pre key={diff.path}><strong>{diff.path}</strong>{`\n${diff.oldText ?? ''}\n→\n${diff.newText}`}</pre>)}</div>
}
