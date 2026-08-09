import { restoreBranchStateFromSessionBackup } from '../stores/branchStore';

/**
 * Put the local branch list back after a collaboration session projected the
 * host's over it.
 *
 * Returns whether the restored state is durable. Callers run this during
 * teardown, where the steps after it — closing peer connections, stopping the
 * sync — must happen regardless, so it reports rather than throws. `false`
 * means the session holds the pre-session branch list but a reload would come
 * back on the host's; the backup is kept so a later attempt can still land.
 */
export function restoreBranchStateAfterSession(): boolean {
    return restoreBranchStateFromSessionBackup();
}
