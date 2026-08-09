import { stringify } from 'superjson';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { type BranchRecord, type BranchStoreState, MAIN_BRANCH_ID } from '../branchStore';

const BRANCH_STORAGE_KEY = 'sourdaw-branches';
const BRANCH_SESSION_BACKUP_STORAGE_KEY = 'sourdaw-branch-session-backup';

const validMainBranch = {
    branchId: MAIN_BRANCH_ID,
    name: 'Main',
    rootDocId: 'root',
    sourceBranchId: null,
    createdAt: 100,
    createdFromHeads: [],
    note: '',
} satisfies BranchRecord;

const validFeatureBranch = {
    branchId: 'feature',
    name: 'Feature',
    rootDocId: 'branch_feature',
    sourceBranchId: MAIN_BRANCH_ID,
    createdAt: 200,
    createdFromHeads: [],
    note: '',
} satisfies BranchRecord;

/**
 * Safari private mode and a full origin quota both surface as a throw from
 * `setItem` — `SecurityError` and `QuotaExceededError` respectively. Neither is
 * distinguishable at the adapter, and both must be survivable.
 */
function blockEveryDurableWrite(): void {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
    });
}

describe('branchStore module evaluation with a rejecting localStorage', () => {
    beforeEach(() => {
        window.localStorage.clear();
        vi.resetModules();
    });

    afterEach(() => {
        vi.restoreAllMocks();
        window.localStorage.clear();
    });

    it('evaluates the module when the origin quota rejects the seed write', async () => {
        // Safari private mode: `getItem` returns null, so `createStore` seeds —
        // and the seed is the first durable write of the boot.
        blockEveryDurableWrite();

        await expect(import('../branchStore')).resolves.toBeDefined();
    });

    it('evaluates the module when the origin quota rejects the session-backup restore', async () => {
        const remoteState = {
            branches: [validMainBranch, validFeatureBranch],
            activeBranchId: validFeatureBranch.branchId,
        } satisfies BranchStoreState;
        const localState = {
            branches: [validMainBranch],
            activeBranchId: MAIN_BRANCH_ID,
        } satisfies BranchStoreState;

        window.localStorage.setItem(BRANCH_STORAGE_KEY, stringify(remoteState));
        window.localStorage.setItem(BRANCH_SESSION_BACKUP_STORAGE_KEY, stringify(localState));
        blockEveryDurableWrite();

        const module = await import('../branchStore');

        // The restore is no longer a module-evaluation side effect, so importing
        // the module cannot fail on a durable write at all.
        expect(module.branchStore.value).toEqual(remoteState);

        // ...and running it explicitly reports rather than throwing.
        expect(module.restoreBranchStateFromSessionBackup()).toBe('state-not-persisted');
    });

    it('keeps the session backup when the restore could not be persisted so a later boot can retry', async () => {
        const remoteState = {
            branches: [validMainBranch, validFeatureBranch],
            activeBranchId: validFeatureBranch.branchId,
        } satisfies BranchStoreState;
        const localState = {
            branches: [validMainBranch],
            activeBranchId: MAIN_BRANCH_ID,
        } satisfies BranchStoreState;

        window.localStorage.setItem(BRANCH_STORAGE_KEY, stringify(remoteState));
        window.localStorage.setItem(BRANCH_SESSION_BACKUP_STORAGE_KEY, stringify(localState));
        blockEveryDurableWrite();

        const module = await import('../branchStore');
        module.restoreBranchStateFromSessionBackup();

        expect(window.localStorage.getItem(BRANCH_SESSION_BACKUP_STORAGE_KEY)).toBe(stringify(localState));
    });

    /**
     * The removal is the second half of consuming the backup, and Safari private
     * mode — the motivating case for the whole change — refuses it too. Before
     * this it reported a clean restore: nothing logged, nothing shown, and a
     * backup left on disk that every subsequent boot re-applies, pinning the
     * branch list to the pre-session snapshot permanently.
     */
    it('reports the retained backup when the durable write lands but the removal is refused', async () => {
        const remoteState = {
            branches: [validMainBranch, validFeatureBranch],
            activeBranchId: validFeatureBranch.branchId,
        } satisfies BranchStoreState;
        const localState = {
            branches: [validMainBranch],
            activeBranchId: MAIN_BRANCH_ID,
        } satisfies BranchStoreState;

        window.localStorage.setItem(BRANCH_STORAGE_KEY, stringify(remoteState));
        window.localStorage.setItem(BRANCH_SESSION_BACKUP_STORAGE_KEY, stringify(localState));
        vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
            throw new DOMException('The operation is insecure.', 'SecurityError');
        });

        const module = await import('../branchStore');

        expect(module.restoreBranchStateFromSessionBackup()).toBe('backup-not-cleared');
        // The branch state itself did land.
        expect(module.branchStore.value).toEqual(localState);
        expect(window.localStorage.getItem(BRANCH_SESSION_BACKUP_STORAGE_KEY)).toBe(stringify(localState));
    });

    /**
     * A retained backup is a retry only while durable state has not moved on.
     * Once a later write lands it becomes a rollback: the next boot would revert
     * the branch list and orphan any `branch_<uuid>` created since.
     */
    describe('invalidating a retained backup', () => {
        it('keeps the backup while no durable write has landed since the failure', async () => {
            const remoteState = {
                branches: [validMainBranch, validFeatureBranch],
                activeBranchId: validFeatureBranch.branchId,
            } satisfies BranchStoreState;
            const localState = {
                branches: [validMainBranch],
                activeBranchId: MAIN_BRANCH_ID,
            } satisfies BranchStoreState;

            window.localStorage.setItem(BRANCH_STORAGE_KEY, stringify(remoteState));
            window.localStorage.setItem(BRANCH_SESSION_BACKUP_STORAGE_KEY, stringify(localState));
            blockEveryDurableWrite();

            const module = await import('../branchStore');
            expect(module.restoreBranchStateFromSessionBackup()).toBe('state-not-persisted');

            // A branch write attempted while the quota is still full: `set`
            // throws and the adapter cache does not advance, so nothing durable
            // moved and the backup is still a faithful retry.
            expect(() => {
                module.branchStore.set({ branches: [validMainBranch], activeBranchId: MAIN_BRANCH_ID });
            }).toThrow();

            expect(window.localStorage.getItem(BRANCH_SESSION_BACKUP_STORAGE_KEY)).toBe(stringify(localState));
        });

        it('keeps the backup when a notification fires without a durable write', async () => {
            // `trySet` notifies whether or not the write landed, so a
            // notification alone is not evidence that anything reached the
            // backing store — this is the rollback path in
            // `runBranchLineageTransition`. Invalidating here would drop the
            // backup while durable state is still the host's, losing the
            // pre-session branch list outright.
            const remoteState = {
                branches: [validMainBranch, validFeatureBranch],
                activeBranchId: validFeatureBranch.branchId,
            } satisfies BranchStoreState;
            const localState = {
                branches: [validMainBranch],
                activeBranchId: MAIN_BRANCH_ID,
            } satisfies BranchStoreState;

            window.localStorage.setItem(BRANCH_STORAGE_KEY, stringify(remoteState));
            window.localStorage.setItem(BRANCH_SESSION_BACKUP_STORAGE_KEY, stringify(localState));
            blockEveryDurableWrite();

            const module = await import('../branchStore');
            expect(module.restoreBranchStateFromSessionBackup()).toBe('state-not-persisted');

            // Notifies, does not persist, and `removeItem` is not blocked — so
            // only the durability check stands between this and a dropped backup.
            expect(
                module.branchStore.trySet({
                    branches: [validMainBranch, validFeatureBranch],
                    activeBranchId: MAIN_BRANCH_ID,
                })
            ).toBe(false);

            expect(window.localStorage.getItem(BRANCH_SESSION_BACKUP_STORAGE_KEY)).toBe(stringify(localState));
        });

        it('drops the backup on the first durable write after the failure', async () => {
            const remoteState = {
                branches: [validMainBranch, validFeatureBranch],
                activeBranchId: validFeatureBranch.branchId,
            } satisfies BranchStoreState;
            const localState = {
                branches: [validMainBranch],
                activeBranchId: MAIN_BRANCH_ID,
            } satisfies BranchStoreState;
            const branchCreatedAfterwards = {
                branches: [validMainBranch, { ...validFeatureBranch, branchId: 'later', name: 'Later' }],
                activeBranchId: MAIN_BRANCH_ID,
            } satisfies BranchStoreState;

            window.localStorage.setItem(BRANCH_STORAGE_KEY, stringify(remoteState));
            window.localStorage.setItem(BRANCH_SESSION_BACKUP_STORAGE_KEY, stringify(localState));
            const blocked = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
                throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
            });

            const module = await import('../branchStore');
            expect(module.restoreBranchStateFromSessionBackup()).toBe('state-not-persisted');

            // The origin frees up and the user creates a branch, which lands.
            blocked.mockRestore();
            module.branchStore.set(branchCreatedAfterwards);

            // Without this the next boot would re-apply the backup and the
            // branch just created would vanish, durably and silently.
            expect(window.localStorage.getItem(BRANCH_SESSION_BACKUP_STORAGE_KEY)).toBeNull();
            expect(module.branchStore.value).toEqual(branchCreatedAfterwards);
        });
    });
});
