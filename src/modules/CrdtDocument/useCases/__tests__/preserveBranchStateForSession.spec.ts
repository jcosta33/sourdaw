import { parse } from 'superjson';
import { beforeEach, describe, expect, it, vi } from 'vitest';

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

describe('preserveBranchStateForSession', () => {
    beforeEach(() => {
        vi.resetModules();
        window.localStorage.clear();
    });

    it('should durably preserve an immutable pre-session branch snapshot', async () => {
        const { branchStore } = await import('../../stores/branchStore');
        const { preserveBranchStateForSession } = await import('../preserveBranchStateForSession');
        branchStore.set(localState);

        preserveBranchStateForSession();
        branchStore.set({
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
        });
        preserveBranchStateForSession();

        const storedSnapshot = window.localStorage.getItem(BRANCH_SESSION_BACKUP_STORAGE_KEY);
        if (storedSnapshot === null) {
            throw new Error('Expected durable branch-session snapshot');
        }
        expect(parse(storedSnapshot)).toEqual(localState);
    });
});
