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
 */

/**
 * The Project persistence layer that actually writes saved projects (#3377 AC-009 calibration, review
 * repair): the persistence use cases and the Project repositories tree, anchored as prefixes so a
 * like-named path outside the Project module earns nothing. Matched against the lowercased path.
 */
export const PROJECT_PERSISTENCE_PREFIXES = [
    'src/modules/project/usecases/projectpersistence/',
    'src/modules/project/repositories/',
] as const;

/**
 * The digest-facing description of the surfaces the predicate admits, for the three project-state
 * rules' `applicabilityPaths`. It is not a second classifier: it lives beside the predicate and
 * spreads the same `PROJECT_PERSISTENCE_PREFIXES`, so the two cannot drift. The first two entries
 * stand for the predicate's two case-insensitive substring matches, `undo` and `crdtdocument`, which
 * no prefix can express; the `.sdaw` and `src/app/` bootstrap entries describe the remaining markers.
 *
 * Intended owners, from the sources: the full `src/modules/CrdtDocument/` module — its `AGENTS.md`
 * documents Automerge persistence, `.sdaw` bundle encoding, durable branch-state authority, and
 * semantic action history/undo, with every persistent write routed through `mutateCrdtDoc` — the
 * project-persistence use cases and repositories the risk policy lists, `.sdaw` shapes, and the
 * `src/app/` bootstrap surface the risk policy treats as undo-relevant.
 *
 * Deliberately left out, with no persisted-project or undo ownership documented in their own
 * `AGENTS.md`: `MIDI/` and `Arrangement/` (presentation and editing, not persistence), and the rest
 * of `Project/` outside its persistence layer. `Command/` is not added as a whole-module prefix: its
 * `AGENTS.md` documents undo ownership, and its undo files are covered by the `undo` substring
 * marker, while its macro/idempotency surfaces own neither.
 */
export const SAVED_PROJECT_STATE_APPLICABILITY_PATHS: readonly string[] = [
    '**/*undo*',
    '**/*crdtdocument*',
    ...PROJECT_PERSISTENCE_PREFIXES,
    '**/*.sdaw',
    'src/app/*bootstrap*',
];

/**
 * Whether a path owns saved-project state or undo. The intended surface and its exclusions are
 * documented on `SAVED_PROJECT_STATE_APPLICABILITY_PATHS` above; this predicate is their executable
 * form.
 */
export function isSavedProjectStateOrUndoPath(path: string): boolean {
    const lower = path.toLowerCase();
    return (
        lower.includes('undo') ||
        lower.includes('crdtdocument') ||
        PROJECT_PERSISTENCE_PREFIXES.some((prefix) => lower.startsWith(prefix)) ||
        lower.endsWith('.sdaw') ||
        (lower.startsWith('src/app/') && lower.includes('bootstrap'))
    );
}
