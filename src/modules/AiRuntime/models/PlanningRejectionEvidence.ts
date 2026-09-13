/**
 * The bounded, application-owned diagnostic a rejected planning proposal leaves
 * behind so the bounded correction can repair instead of reroll blind.
 *
 * Provenance rules: `reason` is application-authored text from the compilation
 * or bridging layer (a closed vocabulary of expected-constraint statements),
 * never provider output or exception prose. `rejectedFragment` quotes the
 * provider's own proposal back to it — it is provider-authored text and stays
 * labeled untrusted wherever it is serialized. `candidateIds` carries real
 * project identities the provider may target, so disambiguation can name the
 * actual candidates instead of "the selector matched more than one".
 */
export type PlanningRejectionEvidence = {
    /** Closed vocabulary: what kind of rejection this was. */
    kind: 'schema' | 'missing-target' | 'ambiguous-target' | 'constraint';
    /** The failing semantic-list item, when the proposal named one. */
    itemId?: string;
    /** The failing command: its name and index inside the proposed batch. */
    command?: { index: number; name: string };
    /** The argument path that failed, when the rejection names one. */
    argumentPath?: string;
    /** Application-owned statement of the violated constraint. */
    reason: string;
    /** Bounded quote of the rejected proposal fragment (untrusted provider output). */
    rejectedFragment?: string;
    /** Bounded real project identities a corrected proposal may target. */
    candidateIds?: readonly string[];
    /** What the selector demanded versus what the project could resolve. */
    resolution?: { resolvedCount: number; expectedCount: number };
};
