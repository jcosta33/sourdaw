import { parse } from 'superjson';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const BRANCH_STORAGE_KEY = 'sourdaw-branches';
const BRANCH_SESSION_BACKUP_STORAGE_KEY = 'sourdaw-branch-session-backup';

const localState = {
    branches: [
        {
            branchId: 'main',
            name: 'Main',
            rootDocId: 'root',
            sourceBranchId: null,
            createdAt: 1,
            createdFromHeads: [],
            note: '',
        },
    ],
    activeBranchId: 'main',
};

const remoteState = {
    branches: [
        ...localState.branches,
        {
            branchId: 'remote',
            name: 'Remote',
            rootDocId: 'branch_remote',
            sourceBranchId: 'main',
            createdAt: 2,
            createdFromHeads: [],
            note: '',
        },
    ],
    activeBranchId: 'remote',
};

describe('restoreBranchStateAfterSession', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
        vi.resetModules();
        window.localStorage.clear();
    });

    it('should persist the local branch state before clearing its durable session backup', async () => {
        const { branchStore } = await import('../../stores/branchStore');
        const { preserveBranchStateForSession } = await import('../preserveBranchStateForSession');
        const { restoreBranchStateAfterSession } = await import('../restoreBranchStateAfterSession');
        branchStore.set(localState);
        preserveBranchStateForSession();
        branchStore.set(remoteState);

        restoreBranchStateAfterSession();

        expect(branchStore.value).toEqual(localState);
        const persistedState = window.localStorage.getItem(BRANCH_STORAGE_KEY);
        if (persistedState === null) {
            throw new Error('Expected restored branch state to persist');
        }
        expect(parse(persistedState)).toEqual(localState);
        expect(window.localStorage.getItem(BRANCH_SESSION_BACKUP_STORAGE_KEY)).toBeNull();
    });

    it('should retain the backup and report the failure when restored branch state cannot persist', async () => {
        const { branchStore } = await import('../../stores/branchStore');
        const { preserveBranchStateForSession } = await import('../preserveBranchStateForSession');
        const { restoreBranchStateAfterSession } = await import('../restoreBranchStateAfterSession');
        branchStore.set(localState);
        preserveBranchStateForSession();
        branchStore.set(remoteState);

        const originalSetItem = Storage.prototype.setItem;
        vi.spyOn(Storage.prototype, 'setItem').mockImplementation((key, value) => {
            if (key === BRANCH_STORAGE_KEY) {
                throw new Error('branch persistence failed');
            }
            originalSetItem.call(window.localStorage, key, value);
        });

        // Reports rather than throws (#1557): this runs inside collaboration
        // teardown's `try`/`finally` with no `catch`, and a throw from here
        // skipped the rest of teardown and left live WebRTC peers connected.
        expect(restoreBranchStateAfterSession()).toBe(false);
        // The session still gets the local branch list back...
        expect(branchStore.value).toEqual(localState);
        // ...and the backup stays, so a later attempt can still make it durable.
        expect(window.localStorage.getItem(BRANCH_SESSION_BACKUP_STORAGE_KEY)).not.toBeNull();
    });
});
