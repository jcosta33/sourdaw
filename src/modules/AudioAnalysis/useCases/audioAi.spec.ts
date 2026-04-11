import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../repositories/audioAiEngine', () => ({
    isStemSeparationAvailable: vi.fn(() => true),
    isAudioGenerationAvailable: vi.fn(() => false),
    isAudioAiServerRunning: vi.fn().mockResolvedValue(true),
    generateAudio: vi.fn().mockResolvedValue({} as AudioBuffer),
    separateStems: vi.fn().mockResolvedValue({} as Record<string, AudioBuffer>),
}));

import { isStemSeparationAvailable } from './audioAi/isStemSeparationAvailable';
import { isAudioGenerationAvailable } from './audioAi/isAudioGenerationAvailable';
import { isAudioAiServerRunning } from './audioAi/isAudioAiServerRunning';
import { generateAudio } from './audioAi/generateAudio';
import { separateStems } from './audioAi/separateStems';
import * as repo from '../repositories/audioAiEngine';

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

        expect(repo.isStemSeparationAvailable).toHaveBeenCalled();
        expect(repo.isAudioGenerationAvailable).toHaveBeenCalled();
        expect(repo.isAudioAiServerRunning).toHaveBeenCalled();
        expect(repo.generateAudio).toHaveBeenCalledWith('test prompt', 5, undefined);
        expect(repo.separateStems).toHaveBeenCalledWith(expect.any(ArrayBuffer), ['drums']);
    });
});
