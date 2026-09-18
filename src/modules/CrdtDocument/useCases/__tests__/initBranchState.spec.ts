import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createControlledLockManager, type ControlledLockManager } from '#/infra/testing/createControlledLockManager';

import {
    blockEveryDurableRead,
    holdBranchStateLock,
    readStoredEnvelope,
    sessionLockName,
    writeStoredEnvelope,
} from '../../repositories/__tests__/branchStateHarness';

const mockLogger = vi.hoisted(() => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn<(message: string) => void>(),
    error: vi.fn<(error: Error) => void>(),
    setWriters: vi.fn(),
}));

vi.mock('#/infra/logger/appLogger', () => ({ logger: mockLogger }));

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

const preSessionBranch = {
    branchId: 'pre-session',
    name: 'Pre session',
    rootDocId: 'branch_pre_session',
    sourceBranchId: MAIN_BRANCH_ID,
    createdAt: 200,
    createdFromHeads: [],
    note: '',
};

const sessionProjectedState = { branches: [mainBranch], activeBranchId: MAIN_BRANCH_ID };
const preSessionState = { branches: [mainBranch, preSessionBranch], activeBranchId: MAIN_BRANCH_ID };

/**
 * The authority carries the revision, the boot promise and the session holds in
 * module state, so every case needs a fresh module graph — the same shape a
 * real boot has.
 */
async function loadInitBranchState(manager: ControlledLockManager | null): Promise<{
    initBranchState: () => void;
    whenBranchStateSettled: () => Promise<void>;
    readBranchIds: () => string[] | undefined;
}> {
    vi.resetModules();
    // The authority resolves the lock manager off `navigator`, so a stub is
    // what a runtime with (or without) the Web Locks API looks like here.
    vi.stubGlobal('navigator', { ...navigator, locks: manager?.locks });
    const stores = await import('../../stores/branchStore');
    const useCase = await import('../initBranchState');
    const settled = await import('../whenBranchStateSettled');
    return {
        initBranchState: useCase.initBranchState,
        whenBranchStateSettled: settled.whenBranchStateSettled,
        readBranchIds: () => stores.branchStore.value?.branches.map((branch) => branch.branchId),
    };
}

describe('initBranchState', () => {
    let manager: ControlledLockManager;

    beforeEach(() => {
        vi.clearAllMocks();
        window.localStorage.clear();
        manager = createControlledLockManager();
    });

    afterEach(() => {
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
        window.localStorage.clear();
    });

    it('hydrates the durable branch list before anything can read a branch id', async () => {
        writeStoredEnvelope({ version: 1, revision: 4, current: preSessionState, session: null, reset: null });

        const { initBranchState, readBranchIds, whenBranchStateSettled } = await loadInitBranchState(manager);
        initBranchState();

        // Synchronous on purpose: the composition root reads the active branch
        // in the same tick, before the asynchronous recovery can settle.
        expect(readBranchIds()).toEqual([MAIN_BRANCH_ID, preSessionBranch.branchId]);

        await whenBranchStateSettled();
        expect(mockLogger.error).not.toHaveBeenCalled();
        expect(mockLogger.warn).not.toHaveBeenCalled();
    });

    it('restores the pre-session list of a session whose instance never tore down', async () => {
        writeStoredEnvelope({
            version: 1,
            revision: 7,
            current: sessionProjectedState,
            session: { owner: 'o1', backup: preSessionState, baseRevision: 6, sequence: 1 },
            reset: null,
        });

        const { initBranchState, readBranchIds, whenBranchStateSettled } = await loadInitBranchState(manager);
        initBranchState();
        await whenBranchStateSettled();

        expect(readBranchIds()).toEqual([MAIN_BRANCH_ID, preSessionBranch.branchId]);
        expect(readStoredEnvelope()).toEqual({
            version: 1,
            revision: 8,
            current: preSessionState,
            session: null,
            reset: null,
        });
        expect(mockLogger.error).not.toHaveBeenCalled();
    });

    it('warns without restoring when another window still holds the session', async () => {
        writeStoredEnvelope({
            version: 1,
            revision: 7,
            current: sessionProjectedState,
            session: { owner: 'o1', backup: preSessionState, baseRevision: 6, sequence: 1 },
            reset: null,
        });
        const releaseLifetime = holdBranchStateLock(manager, sessionLockName('o1'));

        const { initBranchState, readBranchIds, whenBranchStateSettled } = await loadInitBranchState(manager);
        initBranchState();
        await whenBranchStateSettled();

        // The other window owns the list: restoring its backup here is exactly
        // the overwrite this protocol exists to prevent, so this is a warning
        // about refused local writes, not an error.
        expect(readBranchIds()).toEqual([MAIN_BRANCH_ID]);
        expect(readStoredEnvelope()?.revision).toBe(7);
        expect(mockLogger.error).not.toHaveBeenCalled();
        expect(mockLogger.warn.mock.calls[0]?.[0]).toContain('owns the branch list');
        releaseLifetime();
    });

    it('reports an unsequenceable boot when the Web Locks API is absent', async () => {
        writeStoredEnvelope({ version: 1, revision: 4, current: preSessionState, session: null, reset: null });

        const { initBranchState, readBranchIds, whenBranchStateSettled } = await loadInitBranchState(null);
        expect(() => {
            initBranchState();
        }).not.toThrow();
        await whenBranchStateSettled();

        expect(readBranchIds()).toEqual([MAIN_BRANCH_ID, preSessionBranch.branchId]);
        expect(mockLogger.error.mock.calls[0]?.[0]?.message).toContain('cannot be sequenced');
    });

    it('starts on the default list and reports when durable storage cannot be read', async () => {
        writeStoredEnvelope({ version: 1, revision: 4, current: preSessionState, session: null, reset: null });

        const { initBranchState, readBranchIds, whenBranchStateSettled } = await loadInitBranchState(manager);
        const restoreReads = blockEveryDurableRead();

        expect(() => {
            initBranchState();
        }).not.toThrow();
        await whenBranchStateSettled();

        expect(readBranchIds()).toEqual([MAIN_BRANCH_ID]);
        expect(mockLogger.error.mock.calls[0]?.[0]?.message).toContain('could not be read');

        restoreReads();
        // Nothing was written over the list this boot could not see.
        expect(readStoredEnvelope()).toEqual({
            version: 1,
            revision: 4,
            current: preSessionState,
            session: null,
            reset: null,
        });
    });
});
