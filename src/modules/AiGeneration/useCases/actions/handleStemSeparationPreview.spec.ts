import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Container } from '#/infra/di/Container';
import { injectDependencies } from '#/infra/di/testing/injectDependencies';
import { handleStemSeparationPreview } from './handleStemSeparationPreview';

describe('handleStemSeparationPreview', () => {
    beforeEach(() => {
        Container.clear();
    });

    it('records an error task when the clip buffer is missing', async () => {
        const addTask = vi.fn().mockReturnValue('task-1');
        const updateTask = vi.fn();
        const separateStems = vi.fn();
        injectDependencies(handleStemSeparationPreview, {
            addTask,
            updateTask,
            separateStems,
        });

        await handleStemSeparationPreview('missing-buffer-id');

        expect(separateStems).not.toHaveBeenCalled();
        expect(updateTask).toHaveBeenCalledWith(
            'task-1',
            expect.objectContaining({
                status: 'error',
            })
        );
    });
});
