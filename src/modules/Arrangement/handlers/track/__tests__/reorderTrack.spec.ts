import { describe, it, expect, vi, beforeEach } from 'vitest';

import { handleReorderTrack } from '../reorderTrack';

const mocks = vi.hoisted(() => ({
    reorderTrack: vi.fn(),
    getTrackStoreState: vi.fn<() => { tracks: { id: string }[] } | null>(),
}));

vi.mock('#/modules/Arrangement/useCases/toggleTrackState/reorderTrack', () => ({
    reorderTrack: mocks.reorderTrack,
}));

vi.mock('#/modules/Arrangement/useCases/getTrackStoreState', () => ({
    getTrackStoreState: mocks.getTrackStoreState,
}));

describe('handleReorderTrack', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.getTrackStoreState.mockReturnValue(null);
    });

    it('executes reorderTrack with the provided payload', () => {
        void handleReorderTrack.execute({
            type: 'reorderTrack',
            payload: { trackId: 't1', newIndex: 5 },
        });

        expect(mocks.reorderTrack).toHaveBeenCalledWith('t1', 5);
    });

    it('provides a description', () => {
        const desc = handleReorderTrack.describe({
            type: 'reorderTrack',
            payload: { trackId: 't1', newIndex: 0 },
        });
        expect(desc.label).toBe('Reorder track');
        expect(desc.inverseAction).toBeNull();
    });

    it('describes an inverse restoring the pre-move index even when the forward index clamps', () => {
        mocks.getTrackStoreState.mockReturnValue({ tracks: [{ id: 't0' }, { id: 't1' }, { id: 't2' }] });

        const desc = handleReorderTrack.describe({
            type: 'reorderTrack',
            payload: { trackId: 't1', newIndex: 99 },
        });

        // The forward reorder clamps 99 into range; the inverse restores the
        // captured index 1, not anything derived from the payload.
        expect(desc.inverseAction).toEqual({
            type: 'reorderTrack',
            payload: { trackId: 't1', newIndex: 1 },
        });
    });

    it('is undoable', () => {
        expect(handleReorderTrack.undoable).toBe(true);
    });
});
