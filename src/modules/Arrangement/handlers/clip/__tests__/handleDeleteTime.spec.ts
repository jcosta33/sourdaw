import { describe, it, expect, vi, beforeEach } from 'vitest';

import { handleDeleteTime } from '../handleDeleteTime';

const mocks = vi.hoisted(() => ({
    deleteTime: vi.fn(),
}));

vi.mock('../../../useCases/timeOperations/deleteTime', () => ({
    deleteTime: mocks.deleteTime,
}));

describe('handleDeleteTime', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('executes deleteTime with the provided payload', () => {
        void handleDeleteTime.execute({
            type: 'deleteTime',
            payload: { startBeat: 4, endBeat: 8 },
        });

        expect(mocks.deleteTime).toHaveBeenCalledWith(4, 8);
    });

    it('provides a description', () => {
        const desc = handleDeleteTime.describe({
            type: 'deleteTime',
            payload: { startBeat: 4, endBeat: 8 },
        });
        expect(desc.label).toBe('Delete time');
    });

    it('is undoable', () => {
        expect(handleDeleteTime.undoable).toBe(true);
    });
});
