import { beforeEach, describe, expect, it, vi } from 'vitest';

import { desktopOpenDialog } from '#/utils/desktopBridge';

import { pickNativeSampleFolder } from '../pickNativeSampleFolder';

vi.mock('#/utils/desktopBridge', () => ({
    desktopOpenDialog: vi.fn(),
}));

describe('pickNativeSampleFolder', () => {
    beforeEach(() => {
        vi.resetAllMocks();
    });

    it('should open a native single-directory picker with the SampleLibrary title', async () => {
        vi.mocked(desktopOpenDialog).mockResolvedValue('/Users/jose/Samples');

        const selectedPath = await pickNativeSampleFolder();

        expect(desktopOpenDialog).toHaveBeenCalledWith({
            directory: true,
            multiple: false,
            title: 'Connect Sample Folder',
        });
        expect(selectedPath).toBe('/Users/jose/Samples');
    });

    it('should return null when the native picker is cancelled or returns a non-string value', async () => {
        vi.mocked(desktopOpenDialog).mockResolvedValue(null);
        await expect(pickNativeSampleFolder()).resolves.toBeNull();

        vi.mocked(desktopOpenDialog).mockResolvedValue(['/Users/jose/Samples']);
        await expect(pickNativeSampleFolder()).resolves.toBeNull();
    });
});
