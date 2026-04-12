import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleDuplicateTimeRange } from '../handleDuplicateTimeRange';

const mocks = vi.hoisted(() => ({
    duplicateTimeRange: vi.fn(),
}));

vi.mock('../../../useCases/timeOperations/duplicateTimeRange', () => ({
    duplicateTimeRange: mocks.duplicateTimeRange,
}));

describe('handleDuplicateTimeRange', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('executes duplicateTimeRange with the provided payload', () => {
        handleDuplicateTimeRange.execute({
            type: 'duplicateTimeRange',
            payload: { startBeat: 4, endBeat: 8 },
        });

        expect(mocks.duplicateTimeRange).toHaveBeenCalledWith(4, 8);
    });

    it('provides a description', () => {
        const desc = handleDuplicateTimeRange.describe({
            type: 'duplicateTimeRange',
            payload: { startBeat: 4, endBeat: 8 },
        });
        expect(desc.label).toBe('Duplicate time range');
    });

    it('is undoable', () => {
        expect(handleDuplicateTimeRange.undoable).toBe(true);
    });
});
