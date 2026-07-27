import { describe, it, expect, vi, beforeEach } from 'vitest';

import { handleMuteTrack } from '../muteTrack';

const mocks = vi.hoisted(() => ({
    muteTrack: vi.fn(),
    trackStoreState: {
        value: {
            tracks: [{ id: 't1', muted: false }],
        },
    },
}));

vi.mock('../../../useCases/toggleTrackState/muteTrack', () => ({
    muteTrack: mocks.muteTrack,
}));

vi.mock('../../../useCases/getTrackStoreState', () => ({
    getTrackStoreState: () => mocks.trackStoreState.value,
}));

describe('handleMuteTrack', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.trackStoreState.value = {
            tracks: [{ id: 't1', muted: false }],
        };
    });

    it('delegates to muteTrack use case', () => {
        void handleMuteTrack.execute({
            type: 'muteTrack',
            payload: { trackId: 't1', muted: true },
        });
        expect(mocks.muteTrack).toHaveBeenCalledWith('t1', true);
    });

    it('describes a muting label and a negating inverse', () => {
        const desc = handleMuteTrack.describe({ type: 'muteTrack', payload: { trackId: 't1', muted: true } });
        expect(desc.label).toBe('Mute track');
        expect(desc.inverseAction).toEqual({ type: 'muteTrack', payload: { trackId: 't1', muted: false } });
    });

    it('describes an unmuting label and a negating inverse', () => {
        mocks.trackStoreState.value.tracks[0] = { id: 't1', muted: true };
        const desc = handleMuteTrack.describe({ type: 'muteTrack', payload: { trackId: 't1', muted: false } });
        expect(desc.label).toBe('Unmute track');
        expect(desc.inverseAction).toEqual({ type: 'muteTrack', payload: { trackId: 't1', muted: true } });
    });

    it('does not manufacture an inverse for a missing track', () => {
        mocks.trackStoreState.value = { tracks: [] };

        const desc = handleMuteTrack.describe({
            type: 'muteTrack',
            payload: { trackId: 'missing', muted: true },
        });

        expect(desc.inverseAction).toBeNull();
    });

    it('is undoable', () => {
        expect(handleMuteTrack.undoable).toBe(true);
    });
});
