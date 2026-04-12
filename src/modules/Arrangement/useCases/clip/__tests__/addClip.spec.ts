import { describe, it, expect, vi, beforeEach } from 'vitest';
import { addClip } from '../addClip';

const mocks = vi.hoisted(() => ({
    getTrackState: vi.fn(),
    updateTrack: vi.fn(),
    getNextClipId: vi.fn(() => 'clip-123'),
}));

vi.mock('#/modules/Arrangement/repositories/track/getTrackState', () => ({
    getTrackState: mocks.getTrackState,
}));

vi.mock('#/modules/Arrangement/repositories/track/updateTrack', () => ({
    updateTrack: mocks.updateTrack,
}));

vi.mock('#/modules/Arrangement/repositories/clipIdCounter', () => ({
    getNextClipId: mocks.getNextClipId,
}));

describe('addClip', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('creates and adds a clip to the track', () => {
        mocks.getTrackState.mockReturnValue({
            tracks: [{ id: 't1', kind: 'audio', clips: [] }]
        });

        const result = addClip({
            trackId: 't1',
            startBeat: 0,
            endBeat: 4,
            name: 'Vocal',
        });

        expect(result).toMatchObject({
            id: 'clip-123',
            trackId: 't1',
            name: 'Vocal',
            startBeat: 0,
            endBeat: 4,
            type: 'audio',
        });

        expect(mocks.updateTrack).toHaveBeenCalledWith('t1', expect.any(Function));
    });

    it('infers type from track kind if not provided', () => {
        mocks.getTrackState.mockReturnValue({
            tracks: [{ id: 't1', kind: 'midi', clips: [] }]
        });

        const result = addClip({
            trackId: 't1',
            startBeat: 0,
            endBeat: 4,
            name: 'Synth',
        });

        expect(result?.type).toBe('midi');
    });

    it('respects explicitly provided type', () => {
        mocks.getTrackState.mockReturnValue({
            tracks: [{ id: 't1', kind: 'audio', clips: [] }]
        });

        const result = addClip({
            trackId: 't1',
            startBeat: 0,
            endBeat: 4,
            name: 'MIDI on Audio?',
            type: 'midi',
        });

        expect(result?.type).toBe('midi');
    });

    it('returns null if state is missing', () => {
        mocks.getTrackState.mockReturnValue(null);
        const result = addClip({ trackId: 't1', startBeat: 0, endBeat: 4, name: 'X' });
        expect(result).toBeNull();
    });
});
