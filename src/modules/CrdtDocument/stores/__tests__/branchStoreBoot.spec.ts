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

        // ...and running it explicitly still cannot throw.
        expect(() => {
            module.restoreBranchStateFromSessionBackup();
        }).not.toThrow();
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
});
