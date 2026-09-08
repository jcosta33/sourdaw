import { beforeEach, describe, expect, it, vi } from 'vitest';

import { pickFiles, saveProjectBeforeReplacement } from '#/modules/Project/useCases';

import { importDawProject } from '../importDawProject';
import { pickAndImportDawProject } from '../pickAndImportDawProject';

vi.mock('#/modules/Project/useCases', () => ({
    pickFiles: vi.fn(),
    saveProjectBeforeReplacement: vi.fn(),
}));

vi.mock('../importDawProject', () => ({
    importDawProject: vi.fn(),
}));

describe('pickAndImportDawProject', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(saveProjectBeforeReplacement).mockResolvedValue(true);
        vi.mocked(importDawProject).mockResolvedValue(true);
    });

    it('returns false without importing when the file picker is cancelled', async () => {
        vi.mocked(pickFiles).mockResolvedValue(null);

        await expect(pickAndImportDawProject()).resolves.toBe(false);

        expect(saveProjectBeforeReplacement).not.toHaveBeenCalled();
        expect(importDawProject).not.toHaveBeenCalled();
    });

    it('pre-saves the open project, then imports the picked file', async () => {
        vi.mocked(pickFiles).mockResolvedValue([new File([new Uint8Array([1, 2, 3])], 'song.dawproject')]);

        await expect(pickAndImportDawProject()).resolves.toBe(true);

        expect(saveProjectBeforeReplacement).toHaveBeenCalledTimes(1);
        expect(importDawProject).toHaveBeenCalledWith({ buffer: expect.any(ArrayBuffer), fileName: 'song.dawproject' });
    });

    // Issue 3694: the import replaces the open project, so a pre-switch save
    // that resolved with the project still dirty (a plugin capture rejected
    // before commit) must refuse the replacement entirely.
    it('refuses the import when the pre-switch save resolved with the project still dirty', async () => {
        vi.mocked(pickFiles).mockResolvedValue([new File([new Uint8Array([1])], 'song.dawproject')]);
        vi.mocked(saveProjectBeforeReplacement).mockResolvedValue(false);

        await expect(pickAndImportDawProject()).resolves.toBe(false);

        expect(importDawProject).not.toHaveBeenCalled();
    });
});
