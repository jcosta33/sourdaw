import { describe, it, expect, vi, beforeEach } from 'vitest';

import { handleAiDenoiseClip } from '../handleAiDenoiseClip';

const { denoiseAudioMock, updateTaskMock } = vi.hoisted(() => ({
    denoiseAudioMock: vi.fn(),
    updateTaskMock: vi.fn(),
}));

vi.mock('#/modules/AudioEngine/useCases', () => ({
    denoiseAudio: denoiseAudioMock,
    isTauri: vi.fn(),
}));

vi.mock('../addTask', () => ({
    addTask: vi.fn().mockReturnValue('task-1'),
}));

vi.mock('../updateTask', () => ({
    updateTask: updateTaskMock,
}));

describe('handleAiDenoiseClip', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('records an error task when the clip buffer is missing', async () => {
        await handleAiDenoiseClip('missing-buffer-id');

        expect(denoiseAudioMock).not.toHaveBeenCalled();
        expect(updateTaskMock).toHaveBeenCalledWith(
            'task-1',
            expect.objectContaining({
                status: 'error',
            })
        );
    });
});
