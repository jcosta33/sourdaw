import { describe, it, expect, vi, beforeEach } from 'vitest';

import { handleAddSend } from '../handleAddSend';

const mocks = vi.hoisted(() => ({
    setSend: vi.fn(),
}));

vi.mock('../../../useCases/device/sendManagement/setSend', () => ({
    setSend: mocks.setSend,
}));

describe('handleAddSend', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('executes setSend with the provided payload', () => {
        mocks.setSend.mockReturnValue(true);
        const result = handleAddSend.execute({
            type: 'addSend',
            payload: { trackId: 't1', busId: 'bus-1', level: 0.5 },
        });

        expect(mocks.setSend).toHaveBeenCalledWith('t1', 'bus-1', 0.5);
        expect(result).toEqual({ status: 'written' });
    });

    it('returns no-write when the send is rejected', () => {
        mocks.setSend.mockReturnValue(false);
        const result = handleAddSend.execute({
            type: 'addSend',
            payload: { trackId: 't1', busId: 'vca-1', level: 0.5 },
        });

        expect(result).toEqual({ status: 'no-write' });
    });

    it('provides a description', () => {
        const desc = handleAddSend.describe({
            type: 'addSend',
            payload: { trackId: 't1', busId: 'bus-1', level: 0.5 },
        });
        expect(desc.label).toBe('Add send');
    });

    it('is undoable', () => {
        expect(handleAddSend.undoable).toBe(true);
    });
});
