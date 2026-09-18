import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
    const defaultBranchState = {
        branches: [
            {
                branchId: 'main',
                name: 'Main',
                rootDocId: 'root',
                sourceBranchId: null,
                createdAt: 100,
                createdFromHeads: [],
                note: '',
            },
        ],
        activeBranchId: 'main',
    };

    return {
        defaultBranchState,
        createDefaultBranchStoreState: vi.fn(() => defaultBranchState),
        readDurableAuthority: vi.fn(),
        committedAuthority: vi.fn(),
        beginReset: vi.fn(),
        finalizeReset: vi.fn(),
        resetCrdtProjectAuthority: vi.fn(),
        loggerError: vi.fn(),
    };
});

vi.mock('#/infra/logger/appLogger', () => ({
    logger: { error: mocks.loggerError, warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));
vi.mock('../../stores/branchStore', () => ({
    createDefaultBranchStoreState: mocks.createDefaultBranchStoreState,
    MAIN_BRANCH_ID: 'main',
}));
vi.mock('../../repositories/branchStateAuthority', () => ({
    branchStateAuthority: { beginReset: mocks.beginReset, finalizeReset: mocks.finalizeReset },
}));
vi.mock('../readDurablePersistenceAuthority', () => ({
    readDurablePersistenceAuthority: mocks.readDurableAuthority,
}));
vi.mock('../committedPersistenceAuthority', () => ({
    committedPersistenceAuthority: mocks.committedAuthority,
}));
vi.mock('../resetCrdtProjectAuthority', () => ({
    resetCrdtProjectAuthority: mocks.resetCrdtProjectAuthority,
}));

import { resetCrdtProject } from '../resetCrdtProject';

const outgoingAuthority = { epoch: 'epoch-outgoing', revision: 4, rootLineage: 'main' };
const resetHandle = { owner: 'owner-1' };

describe('resetCrdtProject', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.resetCrdtProjectAuthority.mockReset();
        mocks.readDurableAuthority.mockResolvedValue(outgoingAuthority);
        mocks.beginReset.mockResolvedValue({ status: 'begun', handle: resetHandle });
        mocks.finalizeReset.mockResolvedValue('finalized');
        mocks.committedAuthority.mockReturnValue(null);
    });

    // U1
    it('records the reset against the authority it read before the outgoing project is destroyed', async () => {
        const result = await resetCrdtProject('New Project');

        expect(result).toEqual({ status: 'replaced', finalize: expect.any(Function) });
        expect(mocks.beginReset).toHaveBeenCalledWith({
            old: outgoingAuthority,
            target: { epoch: expect.any(String), revision: 5, rootLineage: 'main' },
            intended: mocks.defaultBranchState,
        });
        expect(mocks.readDurableAuthority.mock.invocationCallOrder[0]!).toBeLessThan(
            mocks.beginReset.mock.invocationCallOrder[0]!
        );
        expect(mocks.beginReset.mock.invocationCallOrder[0]!).toBeLessThan(
            mocks.resetCrdtProjectAuthority.mock.invocationCallOrder[0]!
        );
    });

    /**
     * U1 — the marker and the queue have to agree on one epoch and one list.
     * A second epoch, or a second call to the branch-list factory (its default
     * carries a creation timestamp), would leave the durable record describing
     * a save and a list that never happen.
     */
    it('hands the switch the same epoch and list it recorded durably', async () => {
        await resetCrdtProject('New Project');

        const recorded = mocks.beginReset.mock.calls[0]?.[0] as {
            target: { epoch: string };
            intended: unknown;
        };
        expect(mocks.resetCrdtProjectAuthority).toHaveBeenCalledWith('New Project', undefined, {
            epoch: recorded.target.epoch,
            old: outgoingAuthority,
            branchState: recorded.intended,
        });
        expect(mocks.createDefaultBranchStoreState).toHaveBeenCalledTimes(1);
    });

    // U1 — the replacement's branch list becomes durable only through finalize.
    it('finalizes with the authority the replacement actually committed', async () => {
        const result = await resetCrdtProject('New Project');
        if (result.status !== 'replaced') {
            throw new Error(`Expected the reset to be replaced, got ${result.status}`);
        }
        const recorded = mocks.beginReset.mock.calls[0]?.[0] as { target: unknown };
        // Read when `finalize` runs, not when the reset began: the save that
        // makes the replacement durable happens between the two.
        mocks.committedAuthority.mockReturnValue(recorded.target);

        await expect(result.finalize()).resolves.toBe('finalized');

        expect(mocks.finalizeReset).toHaveBeenCalledWith(resetHandle, recorded.target);
    });

    // U2 — a refusal is decided before anything is destroyed, so the caller can
    // abort back into the project the user still has.
    it('leaves the outgoing project untouched when a collaboration session owns the durable list', async () => {
        mocks.beginReset.mockResolvedValue({ status: 'refused', reason: 'session-active' });

        await expect(resetCrdtProject('New Project')).resolves.toEqual({
            status: 'refused',
            reason: 'session-active',
        });

        expect(mocks.resetCrdtProjectAuthority).not.toHaveBeenCalled();
        expect(mocks.finalizeReset).not.toHaveBeenCalled();
    });

    // U3
    it('refuses without recording anything when the durable authority cannot be read', async () => {
        mocks.readDurableAuthority.mockRejectedValue(new Error('IndexedDB unavailable'));

        await expect(resetCrdtProject('New Project')).resolves.toEqual({
            status: 'refused',
            reason: 'authority-unavailable',
        });

        expect(mocks.beginReset).not.toHaveBeenCalled();
        expect(mocks.resetCrdtProjectAuthority).not.toHaveBeenCalled();
        expect(mocks.loggerError).toHaveBeenCalled();
    });

    // U4 — the switch is not atomic, so a throw out of it is past the point of
    // no return and must reach the caller with the marker still pending.
    it('rethrows a failed switch and never finalizes it', async () => {
        const onAuthorityReplaced = vi.fn();
        mocks.resetCrdtProjectAuthority.mockImplementation(() => {
            throw new Error('createProject failed');
        });

        await expect(resetCrdtProject('New Project', onAuthorityReplaced)).rejects.toThrow('createProject failed');

        expect(mocks.beginReset).toHaveBeenCalledTimes(1);
        expect(mocks.finalizeReset).not.toHaveBeenCalled();
    });

    // U5 — nothing of the replacement reached storage, so the marker has to
    // stay: only the authority decides that, and it needs the honest answer.
    it('finalizes with no authority at all when no save of the replacement committed', async () => {
        mocks.finalizeReset.mockResolvedValue('authority-mismatch');
        const result = await resetCrdtProject('New Project');
        if (result.status !== 'replaced') {
            throw new Error(`Expected the reset to be replaced, got ${result.status}`);
        }

        await expect(result.finalize()).resolves.toBe('authority-mismatch');

        expect(mocks.finalizeReset).toHaveBeenCalledWith(resetHandle, null);
    });

    // U6 — a save that committed something other than the recorded target is
    // not the replacement becoming durable; the outcome is the authority's to
    // decide and this caller must not launder it.
    it('reports the outcome verbatim when a foreign authority committed instead', async () => {
        mocks.finalizeReset.mockResolvedValue('authority-mismatch');
        const foreignAuthority = { epoch: 'epoch-foreign', revision: 9, rootLineage: 'main' };
        const result = await resetCrdtProject('New Project');
        if (result.status !== 'replaced') {
            throw new Error(`Expected the reset to be replaced, got ${result.status}`);
        }
        mocks.committedAuthority.mockReturnValue(foreignAuthority);

        await expect(result.finalize()).resolves.toBe('authority-mismatch');

        expect(mocks.finalizeReset).toHaveBeenCalledWith(resetHandle, foreignAuthority);
    });
});
