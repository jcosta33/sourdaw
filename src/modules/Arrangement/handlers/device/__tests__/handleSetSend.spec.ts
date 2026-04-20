import { describe, it, expect, vi, beforeEach } from 'vitest';

import { handleSetSend } from '../handleSetSend';

const mocks = vi.hoisted(() => ({
    setSend: vi.fn(),
}));

vi.mock('../../../useCases/device/sendManagement/setSend', () => ({
    setSend: mocks.setSend,
}));

describe('handleSetSend', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('executes setSend with the provided payload', () => {
        handleSetSend.execute({
            type: 'setSend',
            payload: { trackId: 't1', busId: 'bus-1', level: 0.5 },
        });

        expect(mocks.setSend).toHaveBeenCalledWith('t1', 'bus-1', 0.5);
    });

    it('provides a description', () => {
        const desc = handleSetSend.describe({
            type: 'setSend',
            payload: { trackId: 't1', busId: 'bus-1', level: 0.5 },
        });
        expect(desc.label).toBe('Set send level');
    });

    it('is undoable', () => {
        expect(handleSetSend.undoable).toBe(true);
    });
});
