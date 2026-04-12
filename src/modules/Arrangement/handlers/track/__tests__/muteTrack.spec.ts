import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleMuteTrack } from '../muteTrack';

const mocks = vi.hoisted(() => ({
    muteTrack: vi.fn(),
}));

vi.mock('../../../useCases/toggleTrackState/muteTrack', () => ({
    muteTrack: mocks.muteTrack,
}));

describe('handleMuteTrack', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('executes muteTrack with payload', () => {
        handleMuteTrack.execute({
            type: 'muteTrack',
            payload: { trackId: 't1', muted: true },
        });

        expect(mocks.muteTrack).toHaveBeenCalledWith('t1', true);
    });

    it('provides a description and inverse action based on muted state', () => {
        const desc1 = handleMuteTrack.describe({
            type: 'muteTrack',
            payload: { trackId: 't1', muted: true },
        });
        expect(desc1.label).toBe('Mute track');
        expect(desc1.inverseAction).toEqual({
            type: 'muteTrack',
            payload: { trackId: 't1', muted: false }
        });

        const desc2 = handleMuteTrack.describe({
            type: 'muteTrack',
            payload: { trackId: 't1', muted: false },
        });
        expect(desc2.label).toBe('Unmute track');
        expect(desc2.inverseAction).toEqual({
            type: 'muteTrack',
            payload: { trackId: 't1', muted: true }
        });
    });

    it('is undoable', () => {
        expect(handleMuteTrack.undoable).toBe(true);
    });
});
