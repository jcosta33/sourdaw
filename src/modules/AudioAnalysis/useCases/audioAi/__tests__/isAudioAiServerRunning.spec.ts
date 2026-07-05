import { describe, it, expect, vi, beforeEach } from 'vitest';

import { isAudioAiServerRunning } from '../isAudioAiServerRunning';

const mocks = vi.hoisted(() => ({
    check: vi.fn(),
}));

vi.mock('../../../repositories/isAudioAiServerRunning', () => ({
    isAudioAiServerRunning: mocks.check,
}));

describe('isAudioAiServerRunning', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should return the repository boolean', async () => {
        mocks.check.mockResolvedValue(true);

        await expect(isAudioAiServerRunning()).resolves.toBe(true);
        expect(mocks.check).toHaveBeenCalledTimes(1);
    });
});
