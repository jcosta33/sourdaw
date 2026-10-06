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
 * The patterns below are the heads that are not `expect.<member>(`: Vitest's and Playwright's
 * `expect(...)`, this repository's own capitalized `expect*` helpers such as `expectExternalProjectLink`,
 * and node:test's `assert(...)` and `assert.equal(...)`. The capitalization matters: `expectations.push(`
 * is not an assertion call, and a pattern loose enough to admit it would report removals that never
 * existed.
 *
 * The matchers a head chains — `.toBe(`, `.not.toEqual(`, `.resolves.toBe(` — are deliberately *not*
 * patterns of their own. An unanchored `.to[A-Za-z]*\(` reads `JSON.stringify(value).toLowerCase()`,
 * `count.toFixed(2)` and `date.toISOString()` as assertions, and a serialization-only edit that removes
 * one would then publish a removed assertion with no counterpart: the very false alarm this block exists
 * to quiet, carrying the block's deterministic authority. A matcher split onto a line of its own is
 * reported on the line that spells its head, which is the same limitation `basis` and the rules disclose:
 * a line is decided by text, never by a parse, and a call spelled inside a string or comment is reported
 * as written.
 */
const ASSERTION_LINE_PATTERNS: readonly RegExp[] = [
    /\bexpect\s*\(/u,
    /\bexpect[A-Z][A-Za-z0-9_$]*\s*\(/u,
    /\bassert\s*(?:\.\s*[A-Za-z_$][A-Za-z0-9_$]*)?\s*\(/u,
];

/**
 * The `expect.<member>(` heads that are not assertions, across both frameworks this repository's specs
 * run on: the asymmetric matchers, which build the value an assertion compares against; the matchers a
 * framework registers at run time through `expect.extend`; and vitest's registration, serialization,
 * configuration, and state helpers. The `assert` member is a namespace rather than a call and `not` is a
 * property, so neither can appear as `expect.<member>(` and neither needs a name here.
 *
 * The matcher half is not hand-picked. The spec derives every member of vitest's
 * `AsymmetricMatchersContaining` and `CustomMatcher` and of playwright's `AsymmetricMatchers` from the
 * installed declarations, and fails when one is missing here. That is how `toSatisfy` and `toBeOneOf`
 * (vitest) and `arrayOf` (playwright, reachable in the end-to-end specs through `@playwright/test`, which
 * re-exports `playwright/test`) were found: all three are matcher *values*
 * (`expect(x).toEqual(expect.toBeOneOf(['a']))`), and a removed `expect.arrayOf(Example)` would otherwise
 * have published as a removed assertion.
 *
 * The registered half is what `expect.extend` adds after the declarations are written: vitest's bench
 * runner registers `toBeFasterThan` and `toBeSlowerThan`, which its types declare only in the chained
 * `expect(result).toBeFasterThan(baseline)` form, and a package that augments the framework from its own
 * types — jest-dom's matchers are the same case — is registered rather than declared too. A removed
 * `expect.toBeFasterThan(baseline)` is a removed matcher value, not a removed assertion.
 *
 * The helper half is pinned by name against those same declarations, because a declaration cannot say
 * which kind a member is: vitest's `ExpectStatic` declares `assertions: (expected: number) => void` beside
 * `addEqualityTesters: (testers: Array<Tester>) => void`, and only one of the two is a check. The spec
 * derives the `expect` surface of each installed framework — vitest's `ExpectStatic` and playwright's
 * `Expect` type alias — requires every helper name here to be declared on one of them, checks every
 * registered name against the live framework's own registration, and holds this list equal to the derived
 * matcher values plus those two categories, so a name deleted from any of them fails. Exported so that
 * drift guard reads the one list rather than a copy of it.
 */
export const NON_ASSERTION_EXPECT_MEMBERS: ReadonlySet<string> = new Set([
    // Asymmetric matchers, the complete shipped set of both frameworks.
    'any',
    'anything',
    'arrayContaining',
    'arrayOf',
    'objectContaining',
    'stringContaining',
    'stringMatching',
    'closeTo',
    'schemaMatching',
    'toSatisfy',
    'toBeOneOf',
    // Matchers a package adds to a framework's own matcher interface: the repository augments vitest's
    // `AsymmetricMatchersContaining` with jest-dom's set, so a removed `expect.toHaveValue('1/4'),` is a
    // removed matcher value rather than a removed assertion.
    'toAppearAfter',
    'toAppearBefore',
    'toBeChecked',
    'toBeDisabled',
    'toBeEmpty',
    'toBeEmptyDOMElement',
    'toBeEnabled',
    'toBeInTheDOM',
    'toBeInTheDocument',
    'toBeInvalid',
    'toBePartiallyChecked',
    'toBePartiallyPressed',
    'toBePressed',
    'toBeRequired',
    'toBeValid',
    'toBeVisible',
    'toContainAnyByAltText',
    'toContainAnyByDisplayValue',
    'toContainAnyByLabelText',
    'toContainAnyByPlaceholderText',
    'toContainAnyByRole',
    'toContainAnyByTestId',
    'toContainAnyByText',
    'toContainAnyByTitle',
    'toContainElement',
    'toContainHTML',
    'toContainOneByAltText',
    'toContainOneByDisplayValue',
    'toContainOneByLabelText',
    'toContainOneByPlaceholderText',
    'toContainOneByRole',
    'toContainOneByTestId',
    'toContainOneByText',
    'toContainOneByTitle',
    'toHaveAccessibleDescription',
    'toHaveAccessibleErrorMessage',
    'toHaveAccessibleName',
    'toHaveAttribute',
    'toHaveClass',
    'toHaveDescription',
    'toHaveDisplayValue',
    'toHaveErrorMessage',
    'toHaveFocus',
    'toHaveFormValues',
    'toHaveRole',
    'toHaveSelection',
    'toHaveStyle',
    'toHaveTextContent',
    'toHaveValue',
    // Matchers a framework registers at run time through `expect.extend`: vitest's bench pair, which is a
    // matcher value when it is spelled `expect.toBeFasterThan(baseline)`.
    'toBeFasterThan',
    'toBeSlowerThan',
    // Registration, serialization, configuration, and expect state.
    'extend',
    'addEqualityTesters',
    'addSnapshotSerializer',
    'getState',
    'setState',
    'configure',
]);

/**
 * The member one `expect.<member>(` head spells, or undefined when the line spells none.
 *
 * The open-ended side is deliberate. An allowlist of the assertion heads that came to mind silently missed
 * `expect.fail(` and `expect.unreachable(`, which this repository's specs spell 126 and 4 times, so a
 * removed one published no removed assertion at all — the false-negative half of the defect that made the
 * matcher pattern over-report. Every member outside the non-assertion list above now counts, including one
 * a later framework version adds, and the price of that direction is a removed configuration helper
 * reading as a removed assertion: visible, and bounded by the list being the framework's own
 * non-assertion surface.
 */
function expectMemberHead(text: string): string | undefined {
    return /\bexpect\s*\.\s*([A-Za-z_$][A-Za-z0-9_$]*)\s*\(/u.exec(text)?.[1];
}

/** Whether a line ends with a bare `expect` identifier, which the next line in the file may complete. */
function opensExpectHead(text: string): boolean {
    return /\bexpect\s*$/u.test(text);
}

/**
 * Whether a line completes an open `expect` head: a `.member(` call outside the non-assertion list, or the
 * direct `(` of `expect(actual)`.
 */
function completesExpectHead(text: string): boolean {
    const member = /^\s*\.\s*([A-Za-z_$][A-Za-z0-9_$]*)\s*\(/u.exec(text)?.[1];
    if (member !== undefined) {
        return !NON_ASSERTION_EXPECT_MEMBERS.has(member);
    }
    return /^\s*\(/u.test(text);
}

/**
 * The line numbers of one side's changed lines that carry an assertion call, carrying an open head across
 * a line break.
 *
 * This repository spells a session head split from its call — `expect` on one line and
 * `.soft(result.actions)` on the next, twice in one AiRuntime spec — and neither line alone is an
 * assertion, so a per-line predicate published zero removed assertions for a removed soft check. A line
 * that ends with a bare `expect` opens a head, and the next line *in the file* completes it when it
 * spells a `.member(` head outside the non-assertion list or the direct call; both lines are reported,
 * because either one can be the line an edit removed. Pairing only consecutive lines keeps two adjacent
 * additions from different hunks from reading as one split assertion.
 */
function assertionLineNumbers(lines: readonly ChangedSourceLine[]): number[] {
    const reported: number[] = [];
    let openHead: number | undefined;
    for (const line of lines) {
        if (isAssertionLine(line.text)) {
            reported.push(line.line);
            openHead = undefined;
            continue;
        }
        if (openHead !== undefined && line.line === openHead + 1 && completesExpectHead(line.text)) {
            reported.push(openHead, line.line);
            openHead = undefined;
            continue;
        }
        openHead = opensExpectHead(line.text) ? line.line : undefined;
    }
    return reported;
}

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
    const member = expectMemberHead(text);
    if (member !== undefined && !NON_ASSERTION_EXPECT_MEMBERS.has(member)) {
        return true;
    }
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
            removedAssertions: changedLineGroup(assertionLineNumbers(lines.removed)),
        },
        after: {
            addedAssertions: changedLineGroup(assertionLineNumbers(lines.added)),
            addedControlFlow: changedLineGroup(
                lines.added.filter((line) => isControlFlowLine(line.text)).map((line) => line.line)
            ),
        },
    };
}
