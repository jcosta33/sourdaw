import { describe, it, expect, vi, beforeEach } from 'vitest';

import { handleRemoveSend } from '../handleRemoveSend';

const mocks = vi.hoisted(() => ({
    removeSend: vi.fn(),
}));

vi.mock('../../../useCases/device/sendManagement/removeSend', () => ({
    removeSend: mocks.removeSend,
}));

describe('handleRemoveSend', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('executes removeSend with the provided payload', () => {
        handleRemoveSend.execute({
            type: 'removeSend',
            payload: { trackId: 't1', busId: 'bus-1' },
        });

        expect(mocks.removeSend).toHaveBeenCalledWith('t1', 'bus-1');
    });

    it('provides a description', () => {
        const desc = handleRemoveSend.describe({
            type: 'removeSend',
            payload: { trackId: 't1', busId: 'bus-1' },
        });
        expect(desc.label).toBe('Remove send');
    });

    it('is undoable', () => {
        expect(handleRemoveSend.undoable).toBe(true);
    });
});
