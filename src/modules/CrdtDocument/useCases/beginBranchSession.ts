import { branchStateAuthority, type BranchSessionBeginResult } from '../repositories/branchStateAuthority';

/**
 * Take ownership of the durable branch list for one collaboration session.
 *
 * Refused when another session already owns it — including one left behind by
 * an instance that is still running. The caller runs the session without branch
 * sync in that case; it must not project over a list it does not own.
 */
export function beginBranchSession(): Promise<BranchSessionBeginResult> {
    return branchStateAuthority.beginSession();
}
