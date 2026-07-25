import { describe, it, expect, vi, beforeEach } from 'vitest';

import { handleMuteTrack } from '../muteTrack';

const mocks = vi.hoisted(() => ({
    muteTrack: vi.fn(),
}));

vi.mock('../../../useCases/toggleTrackState/muteTrack', () => ({
    muteTrack: mocks.muteTrack,
}));

describe('handleMuteTrack', () => {
    beforeEach(() => vi.clearAllMocks());

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
        const desc = handleMuteTrack.describe({ type: 'muteTrack', payload: { trackId: 't1', muted: false } });
        expect(desc.label).toBe('Unmute track');
        expect(desc.inverseAction).toEqual({ type: 'muteTrack', payload: { trackId: 't1', muted: true } });
    });

    it('is undoable', () => {
        expect(handleMuteTrack.undoable).toBe(true);
    });
});
