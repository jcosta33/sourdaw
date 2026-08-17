import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
    isStemSeparationAvailable: vi.fn(() => true),
    isAudioAiServerRunning: vi.fn().mockResolvedValue(true),
    separateStems: vi.fn().mockResolvedValue({}),
}));

vi.mock('../../repositories/isStemSeparationAvailable', () => ({
    isStemSeparationAvailable: mocks.isStemSeparationAvailable,
}));

vi.mock('../../repositories/isAudioAiServerRunning', () => ({
    isAudioAiServerRunning: mocks.isAudioAiServerRunning,
}));

vi.mock('../../repositories/separateStems', () => ({
    separateStems: mocks.separateStems,
}));

import { isAudioAiServerRunning } from '../audioAi/isAudioAiServerRunning';
import { isStemSeparationAvailable } from '../audioAi/isStemSeparationAvailable';
import { separateStems } from '../audioAi/separateStems';

describe('audioAi delegates', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('forwards each query/command to the repository', async () => {
        expect(isStemSeparationAvailable()).toBe(true);
        await expect(isAudioAiServerRunning()).resolves.toBe(true);
        await separateStems(new ArrayBuffer(0), ['drums']);

        expect(mocks.isStemSeparationAvailable).toHaveBeenCalled();
        expect(mocks.isAudioAiServerRunning).toHaveBeenCalled();
        expect(mocks.separateStems).toHaveBeenCalledWith(expect.any(ArrayBuffer), ['drums']);
    });
});
