/**
 * Deterministic change facts for one unit: the added and removed lines that carry an assertion call, and
 * the added lines that introduce control flow, each as a count and the line numbers it matched.
 *
 * Why this block exists. An audit of this repository's own advisory reviews found
 * `assertion_deleted` and `admission_branch_completes_without_asserting` firing on changes that do not
 * commit the alleged defect, because the model was asked to infer the edit from whole-file text. The
 * block answers the one question a local check can actually answer — what lines did this diff add and
 * remove — and nothing else.
 *
 * What it is not. These are line-level lexical facts about a unified diff. A removed assertion line says
 * the diff removed that line, never that the behaviour lost its check; an added `return;` says the edit
 * added that line, never that the branch can complete without asserting. The rules that read the block
 * say so in their own instructions, and no rule may treat a count here as proof about behaviour a later
 * call or a branch body outside the supplied regions would have to establish.
 *
 * Bounded on purpose. The request's state budget is shared with the evidence, so a large rewrite must not
 * price a unit out of its own request: each group names at most `CHANGED_LINE_FACTS_LINE_LIMIT` lines,
 * keeps the true total in `count`, and says in `truncated` when it named only the first of them.
 */

/**
 * One line a diff added or removed, at the number it holds on its own side: an added line its post-change
 * number, a removed line its pre-change number. The text is kept because whether a line carries an
 * assertion call or introduces control flow is a lexical property of its text, and the block below is the
 * only reader that needs the text rather than a count.
 */
export type ChangedSourceLine = {
    readonly line: number;
    readonly text: string;
};

/** The added and removed lines of one changed path, in diff order, keyed by the post-change path. */
export type PathChangedLines = {
    readonly added: readonly ChangedSourceLine[];
    readonly removed: readonly ChangedSourceLine[];
};

/** How many matching line numbers one group names before it reports the rest only as a count. */
export const CHANGED_LINE_FACTS_LINE_LIMIT = 8;

/** The basis a block carries: the diff's own added and removed lines, or a source that had none to give. */
export const CHANGED_LINE_FACTS_BASES = ['unified-diff', 'unavailable'] as const;
export type ChangedLineFactsBasis = (typeof CHANGED_LINE_FACTS_BASES)[number];

/** One class of changed line: how many matched, which of them are named, and whether any were withheld. */
export type ChangedLineGroup = {
    readonly count: number;
    readonly lines: readonly number[];
    readonly truncated: boolean;
};

/**
 * The facts one unit's request carries. `unavailable` is a complete value in its own right: the source
 * could not supply the diff's changed lines, so the block must not present an empty group as a fact
 * about the edit — a zero the model reads as "no added branch" when nothing was read is exactly the
 * whole-file inference this block exists to replace.
 */
export type UnitChangedLineFacts =
    | {
          readonly basis: 'unified-diff';
          /** The before-side lines the diff removed that carry an assertion call. */
          readonly before: { readonly removedAssertions: ChangedLineGroup };
          /** The after-side lines the diff added that carry an assertion call or introduce control flow. */
          readonly after: {
              readonly addedAssertions: ChangedLineGroup;
              readonly addedControlFlow: ChangedLineGroup;
          };
      }
    | { readonly basis: 'unavailable' };

/**
 * An assertion-carrying line, decided by its text alone.
 *
 * The vocabulary is the assertion calls these suites spell: Vitest's and Playwright's `expect(...)`, a
 * chained matcher (`expect(x).toBe(y)`, including `.not.`, `.resolves.` and `.rejects.`), node:test's
 * `assert(...)` and `assert.equal(...)`, and this repository's own capitalized `expect*` helpers such as
 * `expectExternalProjectLink`. The capitalization matters: `expectations.push(` is not an assertion call,
 * and a pattern loose enough to admit it would report removals that never existed.
 *
 * A line is decided by text, never by a parse. A matcher split across several lines is reported on the
 * line that spells its head, and a call spelled inside a string or a comment is reported as written.
 * That limit is disclosed by `basis` and by the rules' own wording rather than hidden here.
 */
const ASSERTION_LINE_PATTERNS: readonly RegExp[] = [
    /\bexpect\s*\(/u,
    /\bexpect\s*\.\s*[A-Za-z_$][A-Za-z0-9_$]*\s*\(/u,
    /\bexpect[A-Z][A-Za-z0-9_$]*\s*\(/u,
    /\bassert\s*(?:\.\s*[A-Za-z_$][A-Za-z0-9_$]*)?\s*\(/u,
    /\.\s*(?:not\s*\.\s*)?(?:to|rejects|resolves)[A-Za-z0-9_$]*\s*\(/u,
];

/**
 * A control-flow-introducing line, decided by its text alone: `if (`, `else`, `catch`, `switch`, `throw`,
 * and a bare `return` — a `return` with no returned expression, which is the shape that ends a case
 * without asserting. `throw` counts because it fails rather than exits, and the rules read the block with
 * that distinction spelled out. `.catch(` counts: the standing conditional-admission escape in this
 * repository's UI specs is spelled `if (await locator.isVisible().catch(() => false))`.
 */
const CONTROL_FLOW_LINE_PATTERNS: readonly RegExp[] = [
    /\bif\s*\(/u,
    /\belse\b/u,
    /\bcatch\s*(?:\(|\{)/u,
    /\bswitch\s*\(/u,
    /\bthrow\b/u,
    /\breturn\s*;?\s*(?:\/\/.*)?$/u,
];

function matchesAny(patterns: readonly RegExp[], text: string): boolean {
    return patterns.some((pattern) => pattern.test(text));
}

/** Whether one changed line's text carries an assertion call. */
export function isAssertionLine(text: string): boolean {
    return matchesAny(ASSERTION_LINE_PATTERNS, text);
}

/** Whether one changed line's text introduces control flow. */
export function isControlFlowLine(text: string): boolean {
    return matchesAny(CONTROL_FLOW_LINE_PATTERNS, text);
}

/**
 * One group from the matching line numbers. The numbers are sorted and de-duplicated so the same diff
 * always produces the same bytes, and only the first `CHANGED_LINE_FACTS_LINE_LIMIT` of them are named.
 */
function changedLineGroup(lines: readonly number[]): ChangedLineGroup {
    const ordered = [...new Set(lines)].sort((left, right) => left - right);
    return {
        count: ordered.length,
        lines: ordered.slice(0, CHANGED_LINE_FACTS_LINE_LIMIT),
        truncated: ordered.length > CHANGED_LINE_FACTS_LINE_LIMIT,
    };
}

/**
 * The bounded fact block for one unit's own changed lines. An absent entry is the source reporting it
 * could not read the diff's lines: the block then says so instead of carrying three zeroes.
 */
export function changedLineFacts(lines: PathChangedLines | undefined): UnitChangedLineFacts {
    if (lines === undefined) {
        return { basis: 'unavailable' };
    }
    return {
        basis: 'unified-diff',
        before: {
            removedAssertions: changedLineGroup(
                lines.removed.filter((line) => isAssertionLine(line.text)).map((line) => line.line)
            ),
        },
        after: {
            addedAssertions: changedLineGroup(
                lines.added.filter((line) => isAssertionLine(line.text)).map((line) => line.line)
            ),
            addedControlFlow: changedLineGroup(
                lines.added.filter((line) => isControlFlowLine(line.text)).map((line) => line.line)
            ),
        },
    };
}
