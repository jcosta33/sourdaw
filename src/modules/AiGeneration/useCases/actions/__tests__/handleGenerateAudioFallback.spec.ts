import { describe, it, expect, vi, beforeEach } from 'vitest';

import { handleGenerateAudioFallback } from '../handleGenerateAudioFallback';

const { generateAudioMock, updateTaskMock } = vi.hoisted(() => ({
    generateAudioMock: vi.fn(),
    updateTaskMock: vi.fn(),
}));

vi.mock('#/modules/AudioAnalysis/useCases', () => ({
    generateAudio: generateAudioMock,
    isAudioGenerationAvailable: vi.fn().mockReturnValue(false),
}));

vi.mock('#/modules/AudioEngine/stores', () => ({
    audioBufferCache: { set: vi.fn(), get: vi.fn() },
}));

vi.mock('../addTask', () => ({
    addTask: vi.fn().mockReturnValue('task-1'),
}));

vi.mock('../updateTask', () => ({
    updateTask: updateTaskMock,
}));

describe('handleGenerateAudioFallback', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('marks the task as error when audio generation is unavailable', async () => {
        await handleGenerateAudioFallback('prompt', '8');

        expect(generateAudioMock).not.toHaveBeenCalled();
        expect(updateTaskMock).toHaveBeenCalledWith(
            'task-1',
            expect.objectContaining({
                status: 'error',
            })
        );
    });
});
