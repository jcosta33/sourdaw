import { describe, it, expect, vi, beforeEach } from 'vitest';

import { handleRemoveSend } from '../handleRemoveSend';

const mocks = vi.hoisted(() => ({
    removeSend: vi.fn(),
    getTrackStoreState: vi.fn<() => { tracks: { id: string; sends: { busId: string; level: number }[] }[] } | null>(),
}));

vi.mock('../../../useCases/device/sendManagement/removeSend', () => ({
    removeSend: mocks.removeSend,
}));

vi.mock('../../../useCases/getTrackStoreState', () => ({
    getTrackStoreState: mocks.getTrackStoreState,
}));

describe('handleRemoveSend', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.getTrackStoreState.mockReturnValue(null);
    });

    it('executes removeSend with the provided payload', () => {
        void handleRemoveSend.execute({
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
        expect(desc.inverseAction).toBeNull();
    });

    it('describes an inverse re-creating the send at its previous level', () => {
        mocks.getTrackStoreState.mockReturnValue({
            tracks: [{ id: 't1', sends: [{ busId: 'bus-1', level: 0.7 }] }],
        });

        const desc = handleRemoveSend.describe({
            type: 'removeSend',
            payload: { trackId: 't1', busId: 'bus-1' },
        });

        expect(desc.inverseAction).toEqual({
            type: 'setSend',
            payload: { trackId: 't1', busId: 'bus-1', level: 0.7 },
        });
    });

    it('is undoable', () => {
        expect(handleRemoveSend.undoable).toBe(true);
    });
});
