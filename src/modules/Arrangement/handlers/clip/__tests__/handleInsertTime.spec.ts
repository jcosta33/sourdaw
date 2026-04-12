import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleInsertTime } from '../handleInsertTime';

const mocks = vi.hoisted(() => ({
    insertTime: vi.fn(),
}));

vi.mock('../../../useCases/timeOperations/duplicateTimeRange', () => ({
    insertTime: mocks.insertTime,
}));

describe('handleInsertTime', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('executes insertTime with the provided payload', () => {
        handleInsertTime.execute({
            type: 'insertTime',
            payload: { atBeat: 4, durationBeats: 2 },
        });

        expect(mocks.insertTime).toHaveBeenCalledWith(4, 2);
    });

    it('provides a description', () => {
        const desc = handleInsertTime.describe({
            type: 'insertTime',
            payload: { atBeat: 4, durationBeats: 2 },
        });
        expect(desc.label).toBe('Insert time');
    });

    it('is undoable', () => {
        expect(handleInsertTime.undoable).toBe(true);
    });
});
