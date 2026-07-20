import { describe, it, expect, vi, beforeEach } from 'vitest';

import { handleFoldTrack } from '../foldTrack';

const mocks = vi.hoisted(() => ({
    foldTrack: vi.fn(),
    getTrackStoreState: vi.fn<() => { tracks: { id: string; collapsed: boolean }[] } | null>(),
}));

vi.mock('#/modules/Arrangement/useCases/toggleTrackState/foldTrack', () => ({
    foldTrack: mocks.foldTrack,
}));

vi.mock('#/modules/Arrangement/useCases/getTrackStoreState', () => ({
    getTrackStoreState: mocks.getTrackStoreState,
}));

describe('handleFoldTrack', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.getTrackStoreState.mockReturnValue(null);
    });

    it('executes foldTrack with the provided payload', () => {
        void handleFoldTrack.execute({
            type: 'foldTrack',
            payload: { trackId: 't1', folded: true },
        });

        expect(mocks.foldTrack).toHaveBeenCalledWith('t1', true);
    });

    it('provides a description reflecting folded state', () => {
        const desc1 = handleFoldTrack.describe({
            type: 'foldTrack',
            payload: { trackId: 't1', folded: true },
        });
        expect(desc1.label).toBe('Fold track');

        const desc2 = handleFoldTrack.describe({
            type: 'foldTrack',
            payload: { trackId: 't1', folded: false },
        });
        expect(desc2.label).toBe('Unfold track');
    });

    it('describes an inverse restoring the previous collapsed state', () => {
        mocks.getTrackStoreState.mockReturnValue({ tracks: [{ id: 't1', collapsed: false }] });

        const desc = handleFoldTrack.describe({
            type: 'foldTrack',
            payload: { trackId: 't1', folded: true },
        });

        expect(desc.inverseAction).toEqual({
            type: 'foldTrack',
            payload: { trackId: 't1', folded: false },
        });
    });

    it('does not negate the payload when the forward fold is a no-op', () => {
        mocks.getTrackStoreState.mockReturnValue({ tracks: [{ id: 't1', collapsed: true }] });

        const desc = handleFoldTrack.describe({
            type: 'foldTrack',
            payload: { trackId: 't1', folded: true },
        });

        // Folding an already-folded track changes nothing; a negating inverse
        // would wrongly unfold it. The inverse restores the captured pre-state.
        expect(desc.inverseAction).toEqual({
            type: 'foldTrack',
            payload: { trackId: 't1', folded: true },
        });
    });

    it('is undoable', () => {
        expect(handleFoldTrack.undoable).toBe(true);
    });
});
