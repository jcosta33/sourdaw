import { describe, it, expect, vi, beforeEach } from 'vitest';

import { soloTrackExclusive } from '../soloTrackExclusive';

const mocks = vi.hoisted(() => ({
    getTrackState: vi.fn<() => { tracks: { id: string; soloed: boolean }[]; selectedTrackId: string | null } | null>(),
    mapAllTracks: vi.fn<(...args: unknown[]) => unknown>(),
    applySoloLogic: vi.fn<(...args: unknown[]) => void>(),
}));

vi.mock('#/modules/Arrangement/repositories/track/getTrackState', () => ({
    getTrackState: mocks.getTrackState,
}));

vi.mock('#/modules/Arrangement/repositories/track/mapAllTracks', () => ({
    mapAllTracks: mocks.mapAllTracks,
}));

vi.mock('../applySoloLogic', () => ({
    applySoloLogic: mocks.applySoloLogic,
}));

describe('soloTrackExclusive', () => {
    beforeEach(() => vi.clearAllMocks());

    it('should do nothing when there is no track state', () => {
        mocks.getTrackState.mockReturnValue(null);

        soloTrackExclusive('t1');

        expect(mocks.mapAllTracks).not.toHaveBeenCalled();
        expect(mocks.applySoloLogic).not.toHaveBeenCalled();
    });

    it('should clear all solos when that track is the only soloed track', () => {
        mocks.getTrackState.mockReturnValue({
            tracks: [
                { id: 'a', soloed: true },
                { id: 'b', soloed: false },
            ],
            selectedTrackId: null,
        });

        soloTrackExclusive('a');

        const mapper = mocks.mapAllTracks.mock.calls[0]![0] as (t: { id: string; soloed: boolean }) => {
            id: string;
            soloed: boolean;
        };
        expect(mapper({ id: 'a', soloed: true })).toEqual({ id: 'a', soloed: false });
        expect(mapper({ id: 'b', soloed: false })).toEqual({ id: 'b', soloed: false });

        expect(mocks.applySoloLogic).toHaveBeenCalledTimes(1);
    });

    it('should solo only the target track when it is not the lone solo case', () => {
        mocks.getTrackState.mockReturnValue({
            tracks: [
                { id: 'a', soloed: true },
                { id: 'b', soloed: false },
            ],
            selectedTrackId: null,
        });

        soloTrackExclusive('b');

        const mapper = mocks.mapAllTracks.mock.calls[0]![0] as (t: { id: string; soloed: boolean }) => {
            id: string;
            soloed: boolean;
        };
        expect(mapper({ id: 'a', soloed: true })).toEqual({ id: 'a', soloed: false });
        expect(mapper({ id: 'b', soloed: false })).toEqual({ id: 'b', soloed: true });

        expect(mocks.applySoloLogic).toHaveBeenCalledTimes(1);
    });
});
