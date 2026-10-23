import { recordingLifecycle } from './recordingLifecycle';

type ClosedTakeWatch = {
    /** True when a take commit has settled since the watch began or was last acknowledged. */
    hasClosedTake: () => boolean;
    /** Take the takes closed so far as accounted for. */
    acknowledge: () => void;
};

/**
 * Watch for takes that close into the open project.
 *
 * A project replacement owes the project it leaves every take that closes while
 * it runs, however the stop came about, and the stops that close a take (the
 * user's Pause, the replacement's own stop, a punch-out) are spread over code
 * the replacement does not own. The count of settled commits is the one place
 * they all pass through, so the watch compares it against the count at the
 * moment the replacement began.
 */
export function watchClosedTakes(): ClosedTakeWatch {
    let acknowledgedCount = recordingLifecycle.settledCommitCount;
    return {
        hasClosedTake: () => recordingLifecycle.settledCommitCount !== acknowledgedCount,
        acknowledge: () => {
            acknowledgedCount = recordingLifecycle.settledCommitCount;
        },
    };
}
