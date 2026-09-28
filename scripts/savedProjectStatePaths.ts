/**
 * One classification of "this path owns saved-project state or undo", shared by the review risk
 * policy (`reviewRiskPolicy.ts`, which derives the `undo` risk class) and the semantic review's three
 * project-state rules (`semanticReview/rules.ts`). Keeping the predicate in one module is what stops
 * the two from disagreeing: the risk policy lowercased and matched the real owners, while the semantic
 * rules matched a case-sensitive prefix list that named two directories that do not exist
 * (`src/modules/Crdt/`, `src/modules/History/`) and missed the module that does (`CrdtDocument/`).
 *
 * Case decision: classification is case-insensitive. The predicate lowercases the path before
 * matching, so a correctly cased `src/modules/CrdtDocument/...` path selects the project-state rules
 * and a mis-cased variant selects them too. This keeps the risk policy's existing, tested behaviour;
 * the semantic rules adopt it instead of their former case-sensitive `startsWith`.
 *
 * `SAVED_PROJECT_STATE_MATCHERS` is the single source of truth: the predicate below folds over it,
 * and the digest-facing `SAVED_PROJECT_STATE_APPLICABILITY_PATHS` renders from it, so editing one
 * matcher changes both what the rules match and the rules digest together, never one without the
 * other.
 */

/** One shape the predicate implements, matched against the lowercased path. */
export type SavedProjectStateMatcher =
    | { readonly kind: 'substring'; readonly value: string }
    | { readonly kind: 'prefix'; readonly value: string }
    | { readonly kind: 'suffix'; readonly value: string }
    | { readonly kind: 'prefixAndSubstring'; readonly prefix: string; readonly substring: string };

function assertUnreachableMatcher(matcher: never): never {
    throw new Error(`unhandled saved-project-state matcher kind: ${JSON.stringify(matcher)}`);
}

/**
 * The surfaces that own saved-project state or undo, from their sources.
 *
 * - `undo` anywhere (case-insensitive): a path whose name declares undo ownership — the Command
 *   module's undo engine, CrdtDocument's action history, or any other undo action.
 * - `crdtdocument` anywhere (case-insensitive): the full `src/modules/CrdtDocument/` module, whose
 *   `AGENTS.md` documents Automerge persistence, `.sdaw` bundle encoding in
 *   `repositories/crdtPersistence/`, durable branch-state authority, and semantic action
 *   history/undo, with the invariant that every persistent write goes through `mutateCrdtDoc`.
 * - the project-persistence use cases and repositories the risk policy lists (#3377 AC-009
 *   calibration, review repair): the persistence use cases and the Project repositories tree — the
 *   layer that actually writes saved projects — anchored as prefixes so a like-named path outside
 *   the Project module earns nothing.
 * - a `.sdaw` suffix: the saved-project bundle shape.
 * - a `src/app/` path naming `bootstrap`: the composition-root wiring the risk policy treats as
 *   undo-relevant.
 *
 * Deliberately left out, with no persisted-project or undo ownership documented in their own
 * `AGENTS.md`: `MIDI/` and `Arrangement/` (presentation and editing, not persistence), and the rest
 * of `Project/` outside its persistence layer. `Command/` is not added as a whole-module prefix: its
 * `AGENTS.md` documents undo ownership, and its undo files are covered by the `undo` substring
 * marker, while its macro/idempotency surfaces own neither.
 */
export const SAVED_PROJECT_STATE_MATCHERS: readonly SavedProjectStateMatcher[] = [
    { kind: 'substring', value: 'undo' },
    { kind: 'substring', value: 'crdtdocument' },
    { kind: 'prefix', value: 'src/modules/project/usecases/projectpersistence/' },
    { kind: 'prefix', value: 'src/modules/project/repositories/' },
    { kind: 'suffix', value: '.sdaw' },
    { kind: 'prefixAndSubstring', prefix: 'src/app/', substring: 'bootstrap' },
];

/** The digest-facing `applicabilityPaths` string one matcher renders to. */
export function renderSavedProjectStateApplicabilityPath(matcher: SavedProjectStateMatcher): string {
    switch (matcher.kind) {
        case 'substring':
            return `**/*${matcher.value}*`;
        case 'prefix':
            return matcher.value;
        case 'suffix':
            return `**/*${matcher.value}`;
        case 'prefixAndSubstring':
            return `${matcher.prefix}*${matcher.substring}*`;
        default:
            return assertUnreachableMatcher(matcher);
    }
}

/**
 * The surfaces the predicate admits, rendered in the shape the three project-state rules already use
 * for `applicabilityPaths`. Derived from `SAVED_PROJECT_STATE_MATCHERS`, never written beside it.
 */
export const SAVED_PROJECT_STATE_APPLICABILITY_PATHS: readonly string[] = SAVED_PROJECT_STATE_MATCHERS.map(
    renderSavedProjectStateApplicabilityPath
);

function matchesMatcher(lower: string, matcher: SavedProjectStateMatcher): boolean {
    switch (matcher.kind) {
        case 'substring':
            return lower.includes(matcher.value);
        case 'prefix':
            return lower.startsWith(matcher.value);
        case 'suffix':
            return lower.endsWith(matcher.value);
        case 'prefixAndSubstring':
            return lower.startsWith(matcher.prefix) && lower.includes(matcher.substring);
        default:
            return assertUnreachableMatcher(matcher);
    }
}

/** Whether a path owns saved-project state or undo. */
export function isSavedProjectStateOrUndoPath(path: string): boolean {
    const lower = path.toLowerCase();
    return SAVED_PROJECT_STATE_MATCHERS.some((matcher) => matchesMatcher(lower, matcher));
}
