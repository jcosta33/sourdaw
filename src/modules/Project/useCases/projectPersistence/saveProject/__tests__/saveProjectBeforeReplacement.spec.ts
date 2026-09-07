import { describe, it, expect, vi, beforeEach } from 'vitest';

import { saveProjectBeforeReplacement } from '../saveProjectBeforeReplacement';

const mocks = vi.hoisted(() => ({
    saveProject: vi.fn<() => Promise<boolean>>(),
    projectStoreValue: { value: null as { dirty: boolean } | null },
}));

vi.mock('../saveProject', () => ({ saveProject: mocks.saveProject }));
vi.mock('../../../../stores/projectStore', () => ({ projectStore: mocks.projectStoreValue }));

describe('saveProjectBeforeReplacement', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.projectStoreValue.value = null;
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
});
