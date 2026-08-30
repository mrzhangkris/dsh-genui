import { type GenuiSpec } from './spec.ts';
/** Default repair-candidate budget. Callers may pass a smaller per-call
 * budget (tests / tuning); the default is the protection ceiling for
 * depth 8 / 200 nodes. */
export declare const MAX_PARTIAL_REPAIR_ATTEMPTS = 32;
/** One repair candidate: a balanced prefix of the body ending at `end`,
 *  plus the closing brackets to append (empty when already balanced). */
export interface PartialCandidate {
    end: number;
    closingSuffix: string;
}
/** Single left-to-right pass over the raw body. Tracks the bracket stack
 *  (skipping strings/escapes correctly) and records:
 *  - every position where the prefix is fully balanced (trailing comma or
 *    fence tail) — candidate with an empty closing suffix;
 *  - every `}` object close whose remaining depth fits the spec budget —
 *    candidate with the remaining brackets closed (an unfinished trailing
 *    element).
 *  Candidates are ring-buffered to the attempts budget (the LAST pushes are
 *  the longest), then returned longest-first, deduplicated by end. The scan
 *  stops at the first unbalanced close — earlier balanced prefixes remain
 *  valid candidates.
 *
 * Exposed for tests (the `scannedChars` diagnostic); not exported from the
 * package entry. The parser calls this exactly once per parse.
 * @param attemptsLimit - candidate ring-buffer cap (defaults to
 *   `MAX_PARTIAL_REPAIR_ATTEMPTS`; tests inject a smaller budget).
 */
export declare function collectPartialCandidates(raw: string, attemptsLimit?: number): {
    candidates: PartialCandidate[];
    scannedChars: number;
};
/**
 * Parse a possibly incomplete genui spec body.
 * @param raw - the fence body as accumulated so far.
 * @param maxRepairAttempts - repair-candidate budget (defaults to
 *   `MAX_PARTIAL_REPAIR_ATTEMPTS`; tests inject a smaller budget instead of
 *   mutating a module-level variable).
 * @returns a spec containing only finished components, or null when nothing
 *   usable has been written yet.
 */
export declare function parsePartialGenuiSpec(raw: string, maxRepairAttempts?: number): GenuiSpec | null;
