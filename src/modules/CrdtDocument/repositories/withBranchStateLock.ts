import { inject } from '#/infra/di/inject';

/** Serializes one read-validate-decide-write over the branch-state envelope. */
export const BRANCH_STATE_TRANSACTION_LOCK_NAME = 'sourdaw:branch-state';

/**
 * Held for the lifetime of a collaboration session by the instance that began
 * it, so a booting instance can tell a live session from an abandoned one by
 * asking for the lock with `ifAvailable`.
 */
export const BRANCH_SESSION_LOCK_PREFIX = 'sourdaw:branch-session:';

export type BranchStateLockOutcome<TResult> =
    | { status: 'ran'; value: Awaited<TResult> }
    | {
          /**
           * No `LockManager` at all — an insecure context, or a runtime without
           * the Web Locks API. Reported rather than thrown: branch state has a
           * degraded answer for this (refuse the durable write, keep the memory
           * projection) and a throw from here would reach the composition root.
           */
          status: 'lock-unavailable';
      };

type BranchStateLockRequest<TResult> = {
    name: string;
    /**
     * Ask without waiting. `run` is then called with `false` when another
     * client holds the lock, which is the only way to distinguish a live
     * foreign session from one whose instance is gone.
     */
    ifAvailable?: boolean;
    run: (granted: boolean) => Promise<TResult>;
};

function resolveLockManager(): LockManager | undefined {
    return globalThis.navigator?.locks;
}

/**
 * Run `run` under a named exclusive Web Lock.
 *
 * The single injection point for branch-state locking — specs replace
 * `resolveLockManager` here (`injectDependencies(withBranchStateLock, {
 * resolveLockManager: () => manager.locks })`) or stub `navigator.locks`.
 */
export const withBranchStateLock = inject({ resolveLockManager })(
    ({ resolveLockManager }) =>
        async function withBranchStateLock<TResult>({
            name,
            ifAvailable,
            run,
        }: BranchStateLockRequest<TResult>): Promise<BranchStateLockOutcome<TResult>> {
            const locks = resolveLockManager();
            if (locks === undefined) {
                return { status: 'lock-unavailable' };
            }
            const options: LockOptions =
                ifAvailable === true ? { mode: 'exclusive', ifAvailable: true } : { mode: 'exclusive' };
            // Without `ifAvailable` the callback runs only once the lock is
            // granted, so the call itself is the grant; the `Lock` argument is
            // load-bearing only for the availability probe.
            const value = await locks.request(name, options, async (lock) =>
                run(ifAvailable !== true || lock !== null)
            );
            return { status: 'ran', value };
        }
);
