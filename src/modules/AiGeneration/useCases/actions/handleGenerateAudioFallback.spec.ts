import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Container } from '#/infra/di/Container';
import { injectDependencies } from '#/infra/di/testing/injectDependencies';
import { handleGenerateAudioFallback } from './handleGenerateAudioFallback';

describe('handleGenerateAudioFallback', () => {
    beforeEach(() => {
        Container.clear();
    });

    it('marks the task as error when audio generation is unavailable', async () => {
        const addTask = vi.fn().mockReturnValue('task-1');
        const updateTask = vi.fn();
        const generateAudio = vi.fn();
        const isAudioGenerationAvailable = vi.fn().mockReturnValue(false);
        injectDependencies(handleGenerateAudioFallback, {
            addTask,
            updateTask,
            generateAudio,
            isAudioGenerationAvailable,
            audioBufferCache: { set: vi.fn(), get: vi.fn() },
        });

        await handleGenerateAudioFallback('prompt', '8');

        expect(generateAudio).not.toHaveBeenCalled();
        expect(updateTask).toHaveBeenCalledWith(
            'task-1',
            expect.objectContaining({
                status: 'error',
            })
        );
    });
});
