import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
    isStemSeparationAvailable: vi.fn(() => true),
    isAudioGenerationAvailable: vi.fn(() => false),
    isAudioAiServerRunning: vi.fn().mockResolvedValue(true),
    generateAudio: vi.fn().mockResolvedValue({} as AudioBuffer),
    separateStems: vi.fn().mockResolvedValue({} as Record<string, AudioBuffer>),
}));

vi.mock('../../repositories/isStemSeparationAvailable', () => ({
    isStemSeparationAvailable: mocks.isStemSeparationAvailable,
}));

vi.mock('../../repositories/isAudioGenerationAvailable', () => ({
    isAudioGenerationAvailable: mocks.isAudioGenerationAvailable,
}));

vi.mock('../../repositories/isAudioAiServerRunning', () => ({
    isAudioAiServerRunning: mocks.isAudioAiServerRunning,
}));

vi.mock('../../repositories/generateAudio', () => ({
    generateAudio: mocks.generateAudio,
}));

vi.mock('../../repositories/separateStems', () => ({
    separateStems: mocks.separateStems,
}));

import { generateAudio } from '../audioAi/generateAudio';
import { isAudioAiServerRunning } from '../audioAi/isAudioAiServerRunning';
import { isAudioGenerationAvailable } from '../audioAi/isAudioGenerationAvailable';
import { isStemSeparationAvailable } from '../audioAi/isStemSeparationAvailable';
import { separateStems } from '../audioAi/separateStems';

describe('audioAi delegates', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('forwards each query/command to the repository', async () => {
        expect(isStemSeparationAvailable()).toBe(true);
        expect(isAudioGenerationAvailable()).toBe(false);
        await expect(isAudioAiServerRunning()).resolves.toBe(true);
        await generateAudio('test prompt', 5);
        await separateStems(new ArrayBuffer(0), ['drums']);

        expect(mocks.isStemSeparationAvailable).toHaveBeenCalled();
        expect(mocks.isAudioGenerationAvailable).toHaveBeenCalled();
        expect(mocks.isAudioAiServerRunning).toHaveBeenCalled();
        expect(mocks.generateAudio).toHaveBeenCalledWith('test prompt', 5, undefined);
        expect(mocks.separateStems).toHaveBeenCalledWith(expect.any(ArrayBuffer), ['drums']);
    });
});
