import { describe, it, expect, vi, beforeEach } from 'vitest';

import { saveProjectBeforeReplacement } from '../saveProjectBeforeReplacement';

const mocks = vi.hoisted(() => {
    const takes = {
        /** Commits a Stop has started that have not landed yet. */
        closing: [] as Promise<void>[],
        settledCommits: 0,
    };
    return {
        saveProject: vi.fn<() => Promise<boolean>>(),
        projectStoreValue: { value: null as { dirty: boolean } | null },
        takes,
    };
});

// The Transport contract this route reads: waiting resolves once every closing
// take has landed, and a watch reports a take whose commit settled after it was
// created. The recording lifecycle itself is exercised by the real-recording
// integration spec.
vi.mock('#/modules/Transport/useCases', () => ({
    waitForClosedTakes: async () => {
        while (mocks.takes.closing.length > 0) {
            await Promise.all(mocks.takes.closing.splice(0));
        }
    },
    watchClosedTakes: () => {
        const settledAtStart = mocks.takes.settledCommits;
        return { acknowledge: () => undefined, hasClosedTake: () => mocks.takes.settledCommits !== settledAtStart };
    },
}));
vi.mock('../saveProject', () => ({ saveProject: mocks.saveProject }));
vi.mock('../../../../stores/projectStore', () => ({ projectStore: mocks.projectStoreValue }));

/** A take the user's Stop has started committing; it counts as settled once `landed` resolves. */
function startClosingATake(landed: Promise<void>): void {
    mocks.takes.closing.push(
        landed.then(() => {
            mocks.takes.settledCommits++;
        })
    );
}

describe('saveProjectBeforeReplacement', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.projectStoreValue.value = null;
        mocks.takes.closing.length = 0;
        mocks.takes.settledCommits = 0;
    });

    it('refuses the replacement when the pre-switch save fails', async () => {
        mocks.saveProject.mockResolvedValue(false);

        await expect(saveProjectBeforeReplacement()).resolves.toBe(false);
        expect(mocks.saveProject).toHaveBeenCalledTimes(1);
    });

    it('proceeds when the save succeeds and the project is clean', async () => {
        mocks.saveProject.mockResolvedValue(true);
        mocks.projectStoreValue.value = { dirty: false };

        await expect(saveProjectBeforeReplacement()).resolves.toBe(true);
    });

    // Issue 3694: a save can resolve true while the project is still dirty —
    // a plugin state capture rejected before commit warns the user, leaves
    // that edit out of the persisted truth, and holds the dirty flag so the
    // next save retries. Replacing the project over it would destroy the edit.
    it('refuses when the save resolves but the project is still dirty', async () => {
        mocks.saveProject.mockResolvedValue(true);
        mocks.projectStoreValue.value = { dirty: true };

        await expect(saveProjectBeforeReplacement()).resolves.toBe(false);
    });

    it('proceeds without an open project — there is nothing to destroy', async () => {
        mocks.saveProject.mockResolvedValue(true);

        await expect(saveProjectBeforeReplacement()).resolves.toBe(true);
    });

    // A user's Stop turns the transport idle at once and lands the take's commit
    // afterwards, so a click on "open recent" right after Stop would otherwise
    // save the project without the take it is about to be replaced over.
    it('saves only after a take whose commit is still in flight has landed', async () => {
        mocks.saveProject.mockResolvedValue(true);
        const commit = Promise.withResolvers<void>();
        startClosingATake(commit.promise);

        const pending = saveProjectBeforeReplacement();
        await Promise.resolve();
        expect(mocks.saveProject).not.toHaveBeenCalled();

        commit.resolve();
        await expect(pending).resolves.toBe(true);
        expect(mocks.saveProject).toHaveBeenCalledOnce();
    });

    it('saves again when a take lands while the save is running', async () => {
        mocks.saveProject.mockImplementationOnce(() => {
            startClosingATake(Promise.resolve());
            return Promise.resolve(true);
        });
        mocks.saveProject.mockResolvedValue(true);

        await expect(saveProjectBeforeReplacement()).resolves.toBe(true);

        expect(mocks.saveProject).toHaveBeenCalledTimes(2);
    });

    it('refuses when the save that follows a take landing during the first save fails', async () => {
        mocks.saveProject.mockImplementationOnce(() => {
            startClosingATake(Promise.resolve());
            return Promise.resolve(true);
        });
        mocks.saveProject.mockResolvedValueOnce(false);

        await expect(saveProjectBeforeReplacement()).resolves.toBe(false);
    });
});
