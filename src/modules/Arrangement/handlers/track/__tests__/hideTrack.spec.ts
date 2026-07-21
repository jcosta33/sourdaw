import { describe, it, expect, vi, beforeEach } from 'vitest';

import { handleHideTrack } from '../hideTrack';

const mocks = vi.hoisted(() => ({
    hideTrack: vi.fn(),
    getTrackStoreState: vi.fn<() => { tracks: { id: string; hidden: boolean }[] } | null>(),
}));

vi.mock('#/modules/Arrangement/useCases/toggleTrackState/hideTrack', () => ({
    hideTrack: mocks.hideTrack,
}));

vi.mock('#/modules/Arrangement/useCases/getTrackStoreState', () => ({
    getTrackStoreState: mocks.getTrackStoreState,
}));

describe('handleHideTrack', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.getTrackStoreState.mockReturnValue(null);
    });

    it('executes hideTrack with payload', () => {
        void handleHideTrack.execute({
            type: 'hideTrack',
            payload: { trackId: 't1', hidden: true },
        });

        expect(mocks.hideTrack).toHaveBeenCalledWith('t1', true);
    });

    it('provides a description based on hidden state', () => {
        const desc1 = handleHideTrack.describe({
            type: 'hideTrack',
            payload: { trackId: 't1', hidden: true },
        });
        expect(desc1.label).toBe('Hide track');

        const desc2 = handleHideTrack.describe({
            type: 'hideTrack',
            payload: { trackId: 't1', hidden: false },
        });
        expect(desc2.label).toBe('Show track');
    });

    it('describes an inverse restoring the previous hidden state', () => {
        mocks.getTrackStoreState.mockReturnValue({ tracks: [{ id: 't1', hidden: false }] });

        const desc = handleHideTrack.describe({
            type: 'hideTrack',
            payload: { trackId: 't1', hidden: true },
        });

        expect(desc.inverseAction).toEqual({
            type: 'hideTrack',
            payload: { trackId: 't1', hidden: false },
        });
    });

    it('does not negate the payload when the forward hide is a no-op', () => {
        mocks.getTrackStoreState.mockReturnValue({ tracks: [{ id: 't1', hidden: true }] });

        const desc = handleHideTrack.describe({
            type: 'hideTrack',
            payload: { trackId: 't1', hidden: true },
        });

        // Hiding an already-hidden track changes nothing; a negating inverse
        // would wrongly unhide it. The inverse restores the captured pre-state.
        expect(desc.inverseAction).toEqual({
            type: 'hideTrack',
            payload: { trackId: 't1', hidden: true },
        });
    });

    it('is undoable', () => {
        expect(handleHideTrack.undoable).toBe(true);
    });
});
