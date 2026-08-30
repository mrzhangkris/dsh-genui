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
export declare function isCompleteJson(raw: string): boolean;
/** Short human-readable reason for a body that fails whole-JSON parsing, or
 * null when it parses. Positions come from the host's JSON.parse error. */
export declare function describeJsonFailure(raw: string): string | null;
/**
 * Strip the embedded body snippet from a JSON.parse diagnostic before it
 * rides a message into the CONVERSATION (the P1 fence-failure relay). V8's
 * token errors append a 20–30 character quoted excerpt of the fence body —
 * `Unexpected token '模', "…正文片段…" is not valid JSON` — and that excerpt
 * is fence content, which may carry field text the report must not echo.
 * Keep only the position and the error type: cut at the first double quote
 * (the snippet's opening delimiter — the type part before it only ever uses
 * single quotes) and drop the trailing separator. Messages without a quoted
 * snippet (older V8 shapes, "Unexpected end of JSON input", …) pass through
 * unchanged.
 */
export declare function redactJsonErrorSnippet(diagnostic: string): string;
/**
 * Tier-1 repair — SAFE AT ANY TIME (streaming included): heals the most
 * common model JSON typos that do NOT change the body's structure, and only
 * when the whole body parses afterwards (so a still-growing streaming half
 * can never be adopted):
 *
 * 1. Unescaped half-width `"` inside a string value — Chinese text quoted
 *    with ASCII quotes (e.g. `对"别名路径"判定失败`), which makes JSON.parse
 *    fail near that quote with "Expected ',' or ']'...".
 * 2. Trailing commas before `}` / `]` or at end of input.
 *
 * The state-machine scan walks the raw body tracking string-open state:
 * - inside a string, a quote whose next non-space char is NOT one of `, ] } :`
 *   (or end of input) cannot legally close the string → escape it as `\"`;
 * - a `,` whose next non-space char is `}` / `]` / end of input is a trailing
 *   comma → drop it.
 *
 * Returns `{ text, repairs }` on success, or null when nothing needed fixing
 * or the body still does not parse (callers fall through to tier-2 / banner).
 */
export declare function repairFenceJson(raw: string): {
    text: string;
    repairs: number;
} | null;
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
export declare function completeFenceJson(raw: string): {
    text: string;
    repairs: number;
    truncated?: boolean;
} | null;
