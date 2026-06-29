import { beforeEach, describe, expect, it, vi } from 'vitest';

import { selectNativeAudioExportDirectory } from '../selectNativeAudioExportDirectory';

const mocks = vi.hoisted(() => ({
    selectNativeAudioExportDirectory: vi.fn(),
}));

vi.mock('../../../repositories/audioExport/selectNativeAudioExportDirectory', () => ({
    selectNativeAudioExportDirectory: mocks.selectNativeAudioExportDirectory,
}));

describe('selectNativeAudioExportDirectory', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should return the repository directory selection result', async () => {
        mocks.selectNativeAudioExportDirectory.mockResolvedValue('/exports/stems');

        await expect(selectNativeAudioExportDirectory()).resolves.toBe('/exports/stems');

        expect(mocks.selectNativeAudioExportDirectory).toHaveBeenCalledTimes(1);
    });
});
