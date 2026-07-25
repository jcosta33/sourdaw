import { describe, it, expect, vi, beforeEach } from 'vitest';

import * as subject from '../restoreMixerChannels';

type TrackSnapshot = {
    id: string;
    gain: number;
    pan: number;
    muted: boolean;
    soloed: boolean;
    extra: string;
};

const mocks = vi.hoisted(() => ({
    getTrackState: vi.fn<() => { tracks: TrackSnapshot[] } | null>(),
    setTrackState: vi.fn(),
}));

vi.mock('../../../../repositories/track/getTrackState', () => ({
    getTrackState: mocks.getTrackState,
}));

vi.mock('../../../../repositories/track/setTrackState', () => ({
    setTrackState: mocks.setTrackState,
}));

describe('restoreMixerChannels', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.getTrackState.mockReturnValue(null);
    });

    it('restores gain/pan/mute/solo for tracks present in the snapshot and leaves others unchanged', () => {
        mocks.getTrackState.mockReturnValue({
            tracks: [
                { id: 't1', gain: 1, pan: 0, muted: false, soloed: false, extra: 'keep' },
                { id: 't2', gain: 0.5, pan: 0.25, muted: true, soloed: false, extra: 'keep' },
                { id: 't3', gain: 1, pan: 0, muted: false, soloed: false, extra: 'untouched' },
            ],
        });

        subject.restoreMixerChannels([
            { trackId: 't1', gain: 0.8, pan: -0.5, muted: true, soloed: true },
            { trackId: 't2', gain: 0.9, pan: 0.5, muted: false, soloed: false },
        ]);

        const next = mocks.setTrackState.mock.calls[0]?.[0] as { tracks: TrackSnapshot[] };
        expect(next.tracks).toEqual([
            { id: 't1', gain: 0.8, pan: -0.5, muted: true, soloed: true, extra: 'keep' },
            { id: 't2', gain: 0.9, pan: 0.5, muted: false, soloed: false, extra: 'keep' },
            { id: 't3', gain: 1, pan: 0, muted: false, soloed: false, extra: 'untouched' },
        ]);
    });

    it('preserves tracks that have no entry in the restored snapshot', () => {
        mocks.getTrackState.mockReturnValue({
            tracks: [{ id: 'solo', gain: 1, pan: 0, muted: false, soloed: false, extra: 'x' }],
        });

        subject.restoreMixerChannels([]);

        expect(mocks.setTrackState).toHaveBeenCalledTimes(1);
        const next = mocks.setTrackState.mock.calls[0]?.[0] as { tracks: TrackSnapshot[] };
        expect(next.tracks).toEqual([{ id: 'solo', gain: 1, pan: 0, muted: false, soloed: false, extra: 'x' }]);
    });

    it('writes nothing when the track store has not loaded', () => {
        mocks.getTrackState.mockReturnValue(null);

        subject.restoreMixerChannels([{ trackId: 't1', gain: 1, pan: 0, muted: false, soloed: false }]);

        expect(mocks.setTrackState).not.toHaveBeenCalled();
    });
});
