import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../../repositories/nativeProjectFiles/loadProjectFromFile', () => ({
    loadProjectFromFile: vi.fn(),
}));

import { loadProjectFromFile } from '../../../../repositories/nativeProjectFiles/loadProjectFromFile';
import { importProjectFile, importProjectFromNativePath } from '../pickAndImportProjectFile';

function fileWithText(text: string): File {
    return { text: async () => text } as File;
}

describe('importProjectFile', () => {
    it('should return false when the file is not valid JSON', async () => {
        const ok = await importProjectFile(fileWithText('not json {'));

        expect(ok).toBe(false);
    });

    it('should return false when version is not 1', async () => {
        const ok = await importProjectFile(
            fileWithText(JSON.stringify({ version: 2, tracks: {}, transport: {} }))
        );

        expect(ok).toBe(false);
    });

    it('should return false when tracks are missing', async () => {
        const ok = await importProjectFile(
            fileWithText(JSON.stringify({ version: 1, transport: {} }))
        );

        expect(ok).toBe(false);
    });

    it('should return false when transport is missing', async () => {
        const ok = await importProjectFile(
            fileWithText(JSON.stringify({ version: 1, tracks: {} }))
        );

        expect(ok).toBe(false);
    });
});

describe('importProjectFromNativePath', () => {
    beforeEach(() => {
        vi.mocked(loadProjectFromFile).mockReset();
    });

    it('should return false when loadProjectFromFile throws', async () => {
        vi.mocked(loadProjectFromFile).mockRejectedValue(new Error('read failed'));

        const ok = await importProjectFromNativePath('/path/project.sourdaw');

        expect(ok).toBe(false);
    });

    it('should return false when loaded data fails validation', async () => {
        vi.mocked(loadProjectFromFile).mockResolvedValue({
            version: 0,
            tracks: {},
            transport: {},
        } as never);

        const ok = await importProjectFromNativePath('/path/project.sourdaw');

        expect(ok).toBe(false);
        expect(loadProjectFromFile).toHaveBeenCalledWith('/path/project.sourdaw');
    });
});
