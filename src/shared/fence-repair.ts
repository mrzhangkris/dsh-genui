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
export function isCompleteJson(raw: string): boolean {
  try {
    JSON.parse(raw)
    return true
  } catch {
    return false
  }
}

/** Short human-readable reason for a body that fails whole-JSON parsing, or
 * null when it parses. Positions come from the host's JSON.parse error. */
export function describeJsonFailure(raw: string): string | null {
  try {
    JSON.parse(raw)
    return null
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    const pos = msg.match(/position (\d+)/i)
    const where = pos !== null ? `（字符 ${pos[1]} 附近）` : ''
    return `${where}${msg.slice(0, 140)}`
  }
}

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
export function redactJsonErrorSnippet(diagnostic: string): string {
  const cut = diagnostic.indexOf('"')
  if (cut === -1) return diagnostic
  const head = diagnostic.slice(0, cut).replace(/[\s,，]+$/u, '')
  return head === '' ? 'JSON 语法错误' : head
}

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
export function repairFenceJson(raw: string): { text: string; repairs: number } | null {
  try {
    JSON.parse(raw)
    return null
  } catch {
    // fall through to the repair scan
  }
  let out = ''
  let inString = false
  let escaped = false
  let repairs = 0
  // `"key"=` (models writing HTML-style attributes) → the `=` must become
  // `:`; a `=` after a closed string is never legal JSON, so it is safe to
  // rewrite. Set when a closing quote's next non-space char is `=`.
  let pendingEqualsColon = false
  // HTML-attribute form where the KEY quote is never closed: `"tone="info"`
  // — the `=` sits INSIDE the key string. Track whether the current string
  // opened at a key position (after `{`/`,`) so a `=` inside it can close
  // the key and become `:`. A `=` inside a VALUE string stays literal.
  let expectingKey = true
  let thisStringIsKey = false
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i]
    if (pendingEqualsColon && ch === '=') {
      out += ':'
      pendingEqualsColon = false
      repairs++
      continue
    }
    if (inString && ch === '=' && thisStringIsKey) {
      // Unclosed key string hits `=`: close the key, emit the separator,
      // and switch to value context (`"tone="info"` → `"tone":"info"`).
      out += '"'
      out += ':'
      inString = false
      thisStringIsKey = false
      expectingKey = false
      repairs++
      continue
    }
    if (escaped) {
      out += ch
      escaped = false
      continue
    }
    if (inString && ch === '\\') {
      out += ch
      escaped = true
      continue
    }
    if (ch === '"') {
      if (!inString) {
        inString = true
        thisStringIsKey = expectingKey
        out += ch
        continue
      }
      // Inside a string: is this quote the terminator? Look past whitespace.
      let j = i + 1
      while (j < raw.length && (raw[j] === ' ' || raw[j] === '\t' || raw[j] === '\n' || raw[j] === '\r')) j++
      const next = j < raw.length ? raw[j] : ''
      if (next === ',' || next === ']' || next === '}' || next === ':' || next === '=' || next === '') {
        inString = false
        out += ch
        pendingEqualsColon = next === '='
      } else {
        // Free-standing quote inside a value → escape it.
        out += '\\"'
        repairs++
      }
      continue
    }
    if (ch === ',') {
      // Trailing comma before `}` / `]` / end of input → drop it.
      let j = i + 1
      while (j < raw.length && (raw[j] === ' ' || raw[j] === '\t' || raw[j] === '\n' || raw[j] === '\r')) j++
      const next = j < raw.length ? raw[j] : ''
      if (next === '}' || next === ']' || next === '') {
        repairs++
        continue
      }
    }
    // Key/value context for the `=`-inside-key heal (outside strings only).
    if (!inString) {
      if (ch === '{' || ch === ',') expectingKey = true
      else if (ch === ':') expectingKey = false
    }
    out += ch
  }
  if (repairs === 0) return null
  try {
    JSON.parse(out)
    return { text: out, repairs }
  } catch {
    return null
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
export function completeFenceJson(raw: string): { text: string; repairs: number; truncated?: boolean } | null {
  try {
    JSON.parse(raw)
    return null
  } catch {
    // fall through to the unified repair scan
  }
  // Hand-writing habit: the root object is closed, then `"type":"X"` dangles
  // AFTER it (`{"items":[...]}, "type":"list"`) — the author forgot the
  // discriminator before closing and appended it at the end. Move the
  // dangling type into the root object head; adopted only when the result
  // parses AND the root's first key isn't already `type` (duplicate-type
  // guards are wrong to inject into).
  const danglingType = /^\{([\s\S]*)\}\s*,?\s*"type"\s*:\s*"([a-z0-9-]+)"\s*$/.exec(raw)
  if (danglingType !== null && !/^"type"\s*:/.test(danglingType[1]!)) {
    const candidate = `{"type":"${danglingType[2]}",${danglingType[1]}}`
    try {
      JSON.parse(candidate)
      return { text: candidate, repairs: 1 }
    } catch {
      // fall through to the unified repair scan
    }
  }
  let out = ''
  const stack: Array<'}' | ']'> = []
  let inString = false
  let escaped = false
  let repairs = 0
  // `"key"=` → `:` (same tier-1 fix, folded into this pass).
  let pendingEqualsColon = false
  // `"key="value"` (unclosed key quote before `=`) — same heal as tier-1.
  let expectingKey = true
  let thisStringIsKey = false
  // Orphan-sibling heal: index (in `out`) and char of the closer that popped
  // the stack back into an object's member list — the only spot where a
  // `, ` + `[`/`{` literal can be an orphan needing to merge back. -1 when
  // no such closer is pending.
  let valueCloserIndex = -1
  let valueCloserChar = ''
  // P3 truncation candidates: for every orphan / merge point in an object
  // member list, the out-prefix length before it and a copy of the open
  // stack at that moment. Consulted only when the fully repaired body still
  // fails the whole-JSON adoption gate — the fallback then drops the orphan
  // tail and closes the structure as it stood at the cut.
  const cuts: Array<{ at: number; open: Array<'}' | ']'> }> = []
  const noteCut = (): void => {
    cuts.push({ at: out.length, open: [...stack] })
  }
  // True when the member-value ARRAY closer tracked above is still FRESH —
  // nothing but whitespace emitted since it closed — so a bare orphan
  // bracket can merge straight back into it.
  const freshMemberArray = (): boolean =>
    stack[stack.length - 1] === '}' &&
    valueCloserChar === ']' &&
    valueCloserIndex >= 0 &&
    out[valueCloserIndex] === valueCloserChar &&
    out.slice(valueCloserIndex + 1).trim() === ''
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i]
    if (pendingEqualsColon && ch === '=') {
      out += ':'
      pendingEqualsColon = false
      repairs++
      continue
    }
    if (inString && ch === '=' && thisStringIsKey) {
      out += '"'
      out += ':'
      inString = false
      thisStringIsKey = false
      expectingKey = false
      repairs++
      continue
    }
    if (escaped) {
      out += ch
      escaped = false
      continue
    }
    if (inString) {
      if (ch === '\\') {
        out += ch
        escaped = true
        continue
      }
      if (ch !== '"') {
        out += ch
        continue
      }
      // Inside a string: is this quote the terminator? Look past whitespace.
      let j = i + 1
      while (j < raw.length && (raw[j] === ' ' || raw[j] === '\t' || raw[j] === '\n' || raw[j] === '\r')) j++
      const next = j < raw.length ? raw[j] : ''
      if (next === ',' || next === ']' || next === '}' || next === ':' || next === '=' || next === '') {
        inString = false
        out += ch
        pendingEqualsColon = next === '='
      } else {
        // Free-standing quote inside a value → escape it (tier-1 fix).
        out += '\\"'
        repairs++
      }
      continue
    }
    if (ch === '"') {
      inString = true
      thisStringIsKey = expectingKey
      out += ch
      continue
    }
    if (ch === '{') {
      // P2: a bare `{` at object member position (a `"key"` must come — a
      // bracket literal is never legal here) with a fresh just-closed member
      // ARRAY right before it: the author dropped the comma. Replace that
      // array's closer with the missing `,` to reopen it, and the orphan
      // object becomes its next element (same heal as the comma branch).
      if (stack[stack.length - 1] === '}' && expectingKey) {
        if (freshMemberArray()) {
          out = out.slice(0, valueCloserIndex) + ',' + out.slice(valueCloserIndex + 1)
          stack.push(']')
          valueCloserIndex = -1
          valueCloserChar = ''
          repairs++
          noteCut()
        } else {
          noteCut()
        }
      }
      stack.push('}')
      expectingKey = true
      out += ch
      continue
    }
    if (ch === '[') {
      // P2: same bare-bracket heal for `[` orphans — object member position
      // (stack top `}` and expecting a key) proves the author meant this
      // array as the next element of the just-closed key-value array.
      if (stack[stack.length - 1] === '}' && expectingKey) {
        if (freshMemberArray()) {
          out = out.slice(0, valueCloserIndex) + ',' + out.slice(valueCloserIndex + 1)
          stack.push(']')
          valueCloserIndex = -1
          valueCloserChar = ''
          repairs++
          noteCut()
        } else {
          noteCut()
        }
      }
      stack.push(']')
      expectingKey = true
      out += ch
      continue
    }
    if (ch === '}' || ch === ']') {
      if (stack[stack.length - 1] === ch) {
        stack.pop()
        out += ch
        // A closer that lands back inside an object's member list (the value
        // was a member of an object) could have an orphan sibling right after
        // the next comma — remember where its `out` char sits in case the
        // merge below needs to delete it. Inner closers (top stays `]` or
        // the container itself closed) are never merge points.
        if (stack[stack.length - 1] === '}') {
          valueCloserIndex = out.length - 1
          valueCloserChar = ch
        }
      } else {
        // Mismatched closer (e.g. a `]` mistyped as `}`, or a duplicated
        // terminator): no legal JSON can contain it here, so skip it and let
        // the remaining closers pair up again. The whole-body parse below is
        // the final arbiter — if skipping made things worse, nothing is
        // adopted and the diagnostic banner stays.
        repairs++
      }
      continue
    }
    if (ch === ',') {
      // Trailing comma before `}` / `]` / end of input → drop it (tier-1 fix).
      let j = i + 1
      while (j < raw.length && (raw[j] === ' ' || raw[j] === '\t' || raw[j] === '\n' || raw[j] === '\r')) j++
      const next = j < raw.length ? raw[j] : ''
      if (next === '}' || next === ']' || next === '') {
        repairs++
        continue
      }
      // Orphan sibling → merge it back into the value array closed just
      // before this comma. Fires only when the comma sits in an object's
      // member list (stack top `}`) directly after a just-closed value
      // ARRAY (nothing but whitespace emitted since) and the next literal is
      // `[`/`{` — a member list only accepts `"key":` pairs, so that
      // literal can never be legal where it stands. Deleting the closer
      // reopens the array so the orphan becomes its next element (an array
      // accepts any value, so both orphan shapes parse). A value OBJECT
      // closed early is deliberately left alone: deleting its `}` leaves
      // the orphan's own `{...}` shell as a bare literal inside the object
      // (`{"a":1,{"b":2}}`) — still invalid, and peeling the shell invents
      // structure no deletion can justify. The whole-body parse below is the
      // final arbiter.
      if (next === '[' || next === '{') {
        if (freshMemberArray()) {
          out = out.slice(0, valueCloserIndex) + out.slice(valueCloserIndex + 1)
          stack.push(']')
          valueCloserIndex = -1
          valueCloserChar = ''
          repairs++
          // P3 fallback point: if the merged tail still cannot parse,
          // degrade to the pre-orphan structure (close the reopened array).
          noteCut()
        } else if (stack[stack.length - 1] === '}') {
          // An orphan literal this scan cannot merge (stale closer, an object
          // closer, or none): a key must follow a member-list comma, so the
          // bracket is never legal where it stands. Remember the pre-comma
          // position so the truncation fallback can drop it wholesale.
          noteCut()
        }
      }
      expectingKey = true
    } else if (ch === ':' && !inString) {
      expectingKey = false
    }
    out += ch
  }
  if (inString) {
    // Unterminated string value → close it.
    out += '"'
    repairs++
  }
  while (stack.length > 0) {
    out += stack.pop()
    repairs++
  }
  if (repairs === 0) return null
  if (isCompleteJson(out)) return { text: out, repairs }
  // P3 — truncated degradation: the repaired body still does not parse, so
  // some damage survives every heal. Drop the orphan tail instead of giving
  // up: each recorded cut is a prefix + the closers open at that moment. Try
  // the LONGEST prefix first (keep as much repaired content as possible);
  // adopt only when the truncated remainder parses on its own — the
  // all-or-nothing adoption gate applies to the degraded result exactly as
  // to the full one. An empty shell is not a meaningful recovery.
  for (let k = cuts.length - 1; k >= 0; k--) {
    const cut = cuts[k]!
    const kept = out.slice(0, cut.at).replace(/,\s*$/u, '')
    const candidate = kept + cut.open.slice().reverse().join('')
    if (candidate === '{}' || candidate === '[]') continue
    // truncated: true — this text is only the surviving PREFIX; the orphan
    // tail behind the cut was dropped to make it parse.
    if (isCompleteJson(candidate)) return { text: candidate, repairs: repairs + 1, truncated: true }
  }
  return null
}
