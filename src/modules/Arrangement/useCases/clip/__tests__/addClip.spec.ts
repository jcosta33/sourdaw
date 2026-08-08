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
            tracks: [{ id: 't1', kind: 'audio', clips: [], alternatives: [] }],
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
            tracks: [{ id: 't1', kind: 'midi', clips: [], alternatives: [] }],
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
            tracks: [{ id: 't1', kind: 'audio', clips: [], alternatives: [] }],
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

    it('returns null when the target track does not exist (no orphaned clip)', () => {
        mocks.getTrackState.mockReturnValue({ tracks: [{ id: 't1', kind: 'audio', clips: [], alternatives: [] }] });

        const result = addClip({ trackId: 'missing', startBeat: 0, endBeat: 4, name: 'X' });

        expect(result).toBeNull();
        // updateTrack would silently no-op on a missing track, so we must not
        // even attempt the write — and must never hand back a phantom clip.
        expect(mocks.updateTrack).not.toHaveBeenCalled();
    });

    it('rejects an explicit clip ID that is already present anywhere in the project', () => {
        mocks.getTrackState.mockReturnValue({
            tracks: [
                { id: 't1', kind: 'midi', clips: [], alternatives: [] },
                { id: 't2', kind: 'midi', clips: [{ id: 'clip-existing' }], alternatives: [] },
            ],
        });

        const result = addClip({
            id: 'clip-existing',
            trackId: 't1',
            startBeat: 0,
            endBeat: 4,
            name: 'Duplicate identity',
            type: 'midi',
        });

        expect(result).toBeNull();
        expect(mocks.updateTrack).not.toHaveBeenCalled();
    });

    it('rejects a dormant VCA before allocating a clip ID or writing the track', () => {
        mocks.getTrackState.mockReturnValue({ tracks: [{ id: 'vca-1', kind: 'vca', clips: [], alternatives: [] }] });

        const result = addClip({ trackId: 'vca-1', startBeat: 0, endBeat: 4, name: 'Forbidden' });

        expect(result).toBeNull();
        expect(mocks.getNextClipId).not.toHaveBeenCalled();
        expect(mocks.updateTrack).not.toHaveBeenCalled();
    });

    it('returns null when endBeat does not exceed startBeat', () => {
        mocks.getTrackState.mockReturnValue({ tracks: [{ id: 't1', kind: 'audio', clips: [], alternatives: [] }] });

        expect(addClip({ trackId: 't1', startBeat: 4, endBeat: 4, name: 'zero' })).toBeNull();
        expect(addClip({ trackId: 't1', startBeat: 4, endBeat: 2, name: 'inverted' })).toBeNull();
        expect(mocks.updateTrack).not.toHaveBeenCalled();
    });

    it('returns null when startBeat is negative', () => {
        mocks.getTrackState.mockReturnValue({ tracks: [{ id: 't1', kind: 'audio', clips: [], alternatives: [] }] });

        expect(addClip({ trackId: 't1', startBeat: -1, endBeat: 4, name: 'neg' })).toBeNull();
        expect(mocks.updateTrack).not.toHaveBeenCalled();
    });

    it('returns null when startBeat or endBeat is non-finite', () => {
        mocks.getTrackState.mockReturnValue({ tracks: [{ id: 't1', kind: 'audio', clips: [], alternatives: [] }] });

        expect(addClip({ trackId: 't1', startBeat: Number.NaN, endBeat: 4, name: 'nan' })).toBeNull();
        expect(addClip({ trackId: 't1', startBeat: 0, endBeat: Number.POSITIVE_INFINITY, name: 'inf' })).toBeNull();
        expect(mocks.updateTrack).not.toHaveBeenCalled();
    });

    it('preserves passthrough source properties when provided', () => {
        mocks.getTrackState.mockReturnValue({ tracks: [{ id: 't1', kind: 'audio', clips: [], alternatives: [] }] });

        const result = addClip({
            trackId: 't1',
            startBeat: 0,
            endBeat: 4,
            name: 'Vocal',
            fadeInBeats: 0.5,
            fadeOutBeats: 1,
            gain: 0.3,
            color: '#abcdef',
            locked: true,
            muted: true,
            audioOffsetBeats: 2,
            stretchMode: 'timestretch',
            stretchRatio: 1.5,
            loopEnabled: true,
            loopLength: 8,
        });

        expect(result).toMatchObject({
            fadeInBeats: 0.5,
            fadeOutBeats: 1,
            gain: 0.3,
            color: '#abcdef',
            locked: true,
            muted: true,
            audioOffsetBeats: 2,
            stretchMode: 'timestretch',
            stretchRatio: 1.5,
            loopEnabled: true,
            loopLength: 8,
        });
    });
});
