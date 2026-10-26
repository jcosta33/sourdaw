import { beforeEach, describe, expect, it, vi } from 'vitest';

import { pendingProjectReplacements, pickFiles, saveProjectBeforeReplacement } from '#/modules/Project/useCases';

import { importDawProject } from '../importDawProject';
import { pickAndImportDawProject } from '../pickAndImportDawProject';

const withdrawals = vi.hoisted(() => ({ count: 0 }));

// The registry's contract, kept behind plain functions: a withdrawal turns
// false every check captured before it. Importing the real module would cross
// the Project barrel, which loads half the app.
vi.mock('#/modules/Project/useCases', () => ({
    pendingProjectReplacements: {
        capture: () => {
            const captured = withdrawals.count;
            return () => withdrawals.count === captured;
        },
        withdraw: () => {
            withdrawals.count += 1;
        },
    },
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
        vi.mocked(importDawProject).mockResolvedValue({ ok: true, warnings: [] });
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
        expect(importDawProject).toHaveBeenCalledWith({
            buffer: expect.any(ArrayBuffer),
            fileName: 'song.dawproject',
            shouldProceed: expect.any(Function),
        });
    });

    // Choosing the open project's Recent entry while the import is pending
    // withdraws it, so the session stays in the project the user chose last.
    it('does not import once a pre-save that the open project choice outlasted finishes', async () => {
        vi.mocked(pickFiles).mockResolvedValue([new File([new Uint8Array([1])], 'song.dawproject')]);
        const save = Promise.withResolvers<boolean>();
        vi.mocked(saveProjectBeforeReplacement).mockReturnValueOnce(save.promise);

        const importOperation = pickAndImportDawProject();
        await vi.waitFor(() => expect(saveProjectBeforeReplacement).toHaveBeenCalledOnce());
        pendingProjectReplacements.withdraw();
        save.resolve(true);

        await expect(importOperation).resolves.toBe(false);
        expect(importDawProject).not.toHaveBeenCalled();
    });

    it('hands the import a check that the open project choice turns false', async () => {
        vi.mocked(pickFiles).mockResolvedValue([new File([new Uint8Array([1])], 'song.dawproject')]);

        await pickAndImportDawProject();

        const shouldProceed = vi.mocked(importDawProject).mock.calls[0]?.[0].shouldProceed;
        expect(shouldProceed?.()).toBe(true);
        pendingProjectReplacements.withdraw();
        expect(shouldProceed?.()).toBe(false);
    });

    it('returns false when the import does not commit', async () => {
        vi.mocked(pickFiles).mockResolvedValue([new File([new Uint8Array([1])], 'song.dawproject')]);
        vi.mocked(importDawProject).mockResolvedValue({ ok: false, warnings: [] });

        await expect(pickAndImportDawProject()).resolves.toBe(false);
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
