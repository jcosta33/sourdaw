import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Container } from '#/infra/di/Container';
import { injectDependencies } from '#/infra/di/testing/injectDependencies';
import { handleAiDenoiseClip } from './handleAiDenoiseClip';

describe('handleAiDenoiseClip', () => {
    beforeEach(() => {
        Container.clear();
    });

    it('records an error task when the clip buffer is missing', async () => {
        const addTask = vi.fn().mockReturnValue('task-1');
        const updateTask = vi.fn();
        const denoiseAudio = vi.fn();
        const isTauri = vi.fn();
        injectDependencies(handleAiDenoiseClip, {
            denoiseAudio,
            isTauri,
            addTask,
            updateTask,
        });

        await handleAiDenoiseClip('missing-buffer-id');

        expect(denoiseAudio).not.toHaveBeenCalled();
        expect(updateTask).toHaveBeenCalledWith(
            'task-1',
            expect.objectContaining({
                status: 'error',
            })
        );
    });
});
