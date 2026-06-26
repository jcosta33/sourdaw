import { describe, it, expect, vi, beforeEach } from 'vitest';

import { handleStemSeparationPreview } from '../handleStemSeparationPreview';

const { separateStemsMock, updateTaskMock } = vi.hoisted(() => ({
    separateStemsMock: vi.fn(),
    updateTaskMock: vi.fn(),
}));

vi.mock('#/modules/AudioAnalysis/useCases', async (importOriginal) => {
    const actual = await importOriginal<typeof import('#/modules/AudioAnalysis/useCases')>();
    return {
        ...actual,
        separateStems: separateStemsMock,
    };
});

vi.mock('../addTask', () => ({
    addTask: vi.fn().mockReturnValue('task-1'),
}));

vi.mock('../updateTask', () => ({
    updateTask: updateTaskMock,
}));

describe('handleStemSeparationPreview', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('records an error task when the clip buffer is missing', async () => {
        await handleStemSeparationPreview('missing-buffer-id');

        expect(separateStemsMock).not.toHaveBeenCalled();
        expect(updateTaskMock).toHaveBeenCalledWith(
            'task-1',
            expect.objectContaining({
                status: 'error',
            })
        );
    });

    it('includes durationMs on the error task so failed runs carry a duration', async () => {
        await handleStemSeparationPreview('missing-buffer-id');

        // The error path must carry a numeric duration like the success path and
        // the sibling handlers, so a failed stem-separation task is not duration-less.
        expect(updateTaskMock).toHaveBeenCalledWith(
            'task-1',
            expect.objectContaining({
                status: 'error',
                durationMs: expect.any(Number),
            })
        );
    });
});
