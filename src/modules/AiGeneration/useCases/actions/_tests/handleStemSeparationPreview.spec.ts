import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleStemSeparationPreview } from '../handleStemSeparationPreview';

const { separateStemsMock, updateTaskMock } = vi.hoisted(() => ({
    separateStemsMock: vi.fn(),
    updateTaskMock: vi.fn(),
}));

vi.mock('#/modules/AudioAnalysis/useCases', () => ({
    separateStems: separateStemsMock,
}));

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
});
