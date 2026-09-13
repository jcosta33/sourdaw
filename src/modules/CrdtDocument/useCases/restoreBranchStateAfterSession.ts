import { restoreBranchStateFromSessionBackup, type BranchStateRestoreOutcome } from '../stores/branchStore';

/**
 * Put the local branch list back after a collaboration session projected the
 * host's over it.
 *
 * Reports rather than throws. Callers run this during teardown, where the steps
 * after it — closing peer connections, stopping the sync — must happen
 * regardless. The failure outcomes are not interchangeable and the caller has
 * to tell them apart: one means the branch list is live but not durable, one
 * means it is durable but a stale backup survived and will be re-applied, and
 * one means storage could not be read so neither claim is available. See
 * `BranchStateRestoreOutcome`.
 */
export function restoreBranchStateAfterSession(): BranchStateRestoreOutcome {
    return restoreBranchStateFromSessionBackup();
}
