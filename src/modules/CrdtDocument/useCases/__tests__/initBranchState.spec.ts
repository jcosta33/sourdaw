import { stringify } from 'superjson';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockLogger = vi.hoisted(() => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn<(error: Error) => void>(),
    setWriters: vi.fn(),
}));

vi.mock('#/infra/logger/appLogger', () => ({ logger: mockLogger }));

const BRANCH_STORAGE_KEY = 'sourdaw-branches';
const BRANCH_SESSION_BACKUP_STORAGE_KEY = 'sourdaw-branch-session-backup';
const MAIN_BRANCH_ID = 'main';

const mainBranch = {
    branchId: MAIN_BRANCH_ID,
    name: 'Main',
    rootDocId: 'root',
    sourceBranchId: null,
    createdAt: 100,
    createdFromHeads: [],
    note: '',
};

const localOnlyBranch = {
    branchId: 'local-only',
    name: 'Local only',
    rootDocId: 'branch_local_only',
    sourceBranchId: MAIN_BRANCH_ID,
    createdAt: 200,
    createdFromHeads: [],
    note: '',
};

const hostProjectedState = { branches: [mainBranch], activeBranchId: MAIN_BRANCH_ID };
const backupState = { branches: [mainBranch, localOnlyBranch], activeBranchId: MAIN_BRANCH_ID };

function blockEveryDurableWrite(): void {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
    });
}

/**
 * Both `branchStore` and the session-backup adapter cache, so every case needs
 * a fresh module graph — the same shape a real boot has.
 */
async function loadInitBranchState(): Promise<{
    initBranchState: () => void;
    readBranchIds: () => string[] | undefined;
}> {
    vi.resetModules();
    const stores = await import('../../stores/branchStore');
    const useCase = await import('../initBranchState');
    return {
        initBranchState: useCase.initBranchState,
        readBranchIds: () => stores.branchStore.value?.branches.map((branch) => branch.branchId),
    };
}

describe('initBranchState', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        window.localStorage.clear();
        window.localStorage.setItem(BRANCH_STORAGE_KEY, stringify(hostProjectedState));
    });

    afterEach(() => {
        vi.restoreAllMocks();
        window.localStorage.clear();
    });

    it('consumes a session backup left behind by a session that never tore down', async () => {
        window.localStorage.setItem(BRANCH_SESSION_BACKUP_STORAGE_KEY, stringify(backupState));

        const { initBranchState, readBranchIds } = await loadInitBranchState();
        initBranchState();

        expect(readBranchIds()).toEqual([MAIN_BRANCH_ID, localOnlyBranch.branchId]);
        expect(window.localStorage.getItem(BRANCH_SESSION_BACKUP_STORAGE_KEY)).toBeNull();
        expect(mockLogger.error).not.toHaveBeenCalled();
    });

    it('leaves the store alone and stays silent when there is no backup', async () => {
        const { initBranchState, readBranchIds } = await loadInitBranchState();
        initBranchState();

        expect(readBranchIds()).toEqual([MAIN_BRANCH_ID]);
        expect(mockLogger.error).not.toHaveBeenCalled();
    });

    it('applies the recovered state and reports the loss when it cannot be persisted', async () => {
        window.localStorage.setItem(BRANCH_SESSION_BACKUP_STORAGE_KEY, stringify(backupState));

        const { initBranchState, readBranchIds } = await loadInitBranchState();
        blockEveryDurableWrite();

        expect(() => {
            initBranchState();
        }).not.toThrow();

        expect(readBranchIds()).toEqual([MAIN_BRANCH_ID, localOnlyBranch.branchId]);
        // The backup is the retry: dropping it here would turn a recoverable
        // failure into a permanent one.
        expect(window.localStorage.getItem(BRANCH_SESSION_BACKUP_STORAGE_KEY)).toBe(stringify(backupState));
        expect(mockLogger.error.mock.calls[0]?.[0]?.message).toContain('could not be persisted');
    });
});
