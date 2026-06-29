import { beforeEach, describe, expect, it, vi } from 'vitest';

import { open } from '@tauri-apps/plugin-dialog';

import { pickTauriSampleFolder } from '../pickTauriSampleFolder';

vi.mock('@tauri-apps/plugin-dialog', () => ({
    open: vi.fn(),
}));

describe('pickTauriSampleFolder', () => {
    beforeEach(() => {
        vi.resetAllMocks();
    });

    it('should open a native single-directory picker with the SampleLibrary title', async () => {
        vi.mocked(open).mockResolvedValue('/Users/jose/Samples');

        const selectedPath = await pickTauriSampleFolder();

        expect(open).toHaveBeenCalledWith({
            directory: true,
            multiple: false,
            title: 'Connect Sample Folder',
        });
        expect(selectedPath).toBe('/Users/jose/Samples');
    });

    it('should return null when the native picker is cancelled or returns a non-string value', async () => {
        vi.mocked(open).mockResolvedValue(null);
        await expect(pickTauriSampleFolder()).resolves.toBeNull();

        vi.mocked(open).mockResolvedValue(['/Users/jose/Samples']);
        await expect(pickTauriSampleFolder()).resolves.toBeNull();
    });
});
