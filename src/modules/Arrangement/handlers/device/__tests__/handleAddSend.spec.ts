import { describe, it, expect, vi, beforeEach } from 'vitest';

import { handleAddSend } from '../handleAddSend';

const mocks = vi.hoisted(() => ({
    setSend: vi.fn(),
    getTrackStoreState: vi.fn<() => { tracks: { id: string; sends: { busId: string; level: number }[] }[] } | null>(),
}));

vi.mock('../../../useCases/device/sendManagement/setSend', () => ({
    setSend: mocks.setSend,
}));

vi.mock('../../../useCases/getTrackStoreState', () => ({
    getTrackStoreState: mocks.getTrackStoreState,
}));

describe('handleAddSend', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.getTrackStoreState.mockReturnValue(null);
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
        expect(desc.inverseAction).toBeNull();
    });

    it('describes a removeSend inverse when the send is genuinely new', () => {
        mocks.getTrackStoreState.mockReturnValue({ tracks: [{ id: 't1', sends: [] }] });

        const desc = handleAddSend.describe({
            type: 'addSend',
            payload: { trackId: 't1', busId: 'bus-1', level: 0.5 },
        });

        expect(desc.inverseAction).toEqual({
            type: 'removeSend',
            payload: { trackId: 't1', busId: 'bus-1' },
        });
    });

    it('describes a level-restore inverse when the forward call updates an existing send', () => {
        mocks.getTrackStoreState.mockReturnValue({
            tracks: [{ id: 't1', sends: [{ busId: 'bus-1', level: 0.2 }] }],
        });

        const desc = handleAddSend.describe({
            type: 'addSend',
            payload: { trackId: 't1', busId: 'bus-1', level: 0.9 },
        });

        // setSend updates in place — removing the send on undo would destroy a
        // route that existed before the action. Restore the old level instead.
        expect(desc.inverseAction).toEqual({
            type: 'setSend',
            payload: { trackId: 't1', busId: 'bus-1', level: 0.2 },
        });
    });

    it('is undoable', () => {
        expect(handleAddSend.undoable).toBe(true);
    });
});
