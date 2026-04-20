import { describe, it, expect, vi, beforeEach } from 'vitest';

import { pickFiles } from '../fileDialog';

const mocks = vi.hoisted(() => ({
    pickFiles: vi.fn(),
}));

vi.mock('../../repositories/nativeFileDialog/pickFiles', () => ({
    pickFiles: mocks.pickFiles,
}));

describe('pickFiles', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should forward arguments and return the repository result', async () => {
        const opts = { multiple: true };
        mocks.pickFiles.mockResolvedValue([]);

        await expect(pickFiles(opts)).resolves.toEqual([]);

        expect(mocks.pickFiles).toHaveBeenCalledTimes(1);
        expect(mocks.pickFiles).toHaveBeenCalledWith(opts);
    });

    it('should forward a no-arg call to the repository', async () => {
        mocks.pickFiles.mockResolvedValue(null);

        await expect(pickFiles()).resolves.toBeNull();

        expect(mocks.pickFiles).toHaveBeenCalledWith();
    });
});
