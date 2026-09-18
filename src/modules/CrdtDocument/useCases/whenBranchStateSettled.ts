import { branchStateAuthority } from '../repositories/branchStateAuthority';

/**
 * Wait for the boot-time branch recovery to settle.
 *
 * A reader that runs before it can see a branch list an abandoned
 * collaboration session still owns — the pre-recovery list — and act on it. The
 * first project load awaits this before resolving the active branch. Never
 * rejects: a failed recovery is reported by `initBranchState`, and a waiter has
 * nothing to do about it but proceed.
 */
export function whenBranchStateSettled(): Promise<void> {
    return branchStateAuthority.whenSettled();
}
