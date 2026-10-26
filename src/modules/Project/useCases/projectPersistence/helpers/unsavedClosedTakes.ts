import { countSettledTakes } from '#/modules/Transport/useCases';

/**
 * The settled-take count the open project owes nothing for: read at the
 * snapshot of its last successful save, moved up when the user chose to
 * discard its takes, and moved up again when another project replaces it,
 * because the incoming project owes nothing for the outgoing one's takes.
 *
 * A take that a stop commits after that point exists only in memory once
 * autosave is stopped, so a project replacement saves the outgoing project
 * whenever the settled count has passed it. It does not depend on when the
 * replacement began: a take that landed after a route's pre-save, while it read
 * the project it is about to open, still counts.
 */
let savedThroughCount = 0;

function markSavedThrough(settledCount: number): void {
    if (settledCount > savedThroughCount) {
        savedThroughCount = settledCount;
    }
}

export const unsavedClosedTakes = {
    /** Record a save whose snapshot was taken when `settledCount` takes had settled. */
    markSavedThrough,
    /** Take every take settled so far as accounted for, without saving it. */
    acknowledgeAll: (): void => {
        markSavedThrough(countSettledTakes());
    },
    /** True when a take has closed into the open project since its last save, discard or switch. */
    hasUnsaved: (): boolean => countSettledTakes() > savedThroughCount,
};
