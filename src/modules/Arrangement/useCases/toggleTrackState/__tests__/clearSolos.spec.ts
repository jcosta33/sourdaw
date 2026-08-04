import { describe, it, expect, vi, beforeEach } from 'vitest';

import { clearSolos } from '../clearSolos';

const mocks = vi.hoisted(() => ({
    mapAllTracks: vi.fn(),
    getTrackState: vi.fn(),
    applySoloLogic: vi.fn(),
}));

vi.mock('#/modules/Arrangement/repositories/track/mapAllTracks', () => ({
    mapAllTracks: mocks.mapAllTracks,
}));

vi.mock('#/modules/Arrangement/repositories/track/getTrackState', () => ({
    getTrackState: mocks.getTrackState,
}));

vi.mock('../applySoloLogic', () => ({
    applySoloLogic: mocks.applySoloLogic,
}));

describe('clearSolos', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.getTrackState.mockReturnValue({ tracks: [{ id: 't1', soloed: true }] });
    });

    it('should map all tracks to soloed false and apply solo routing', () => {
        expect(clearSolos()).toBe(true);

        expect(mocks.mapAllTracks).toHaveBeenCalledTimes(1);
        expect(mocks.mapAllTracks).toHaveBeenCalledWith(expect.any(Function));

        const mapper = mocks.mapAllTracks.mock.calls[0]![0] as (t: { soloed: boolean; id: string }) => {
            soloed: boolean;
            id: string;
        };
        expect(mapper({ soloed: true, id: 't1' })).toEqual({ soloed: false, id: 't1' });

        expect(mocks.applySoloLogic).toHaveBeenCalledTimes(1);
    });

    it('reports no write when no track is soloed', () => {
        mocks.getTrackState.mockReturnValue({ tracks: [{ id: 't1', soloed: false }] });

        expect(clearSolos()).toBe(false);
        expect(mocks.mapAllTracks).not.toHaveBeenCalled();
        expect(mocks.applySoloLogic).not.toHaveBeenCalled();
    });

    it('can defer live-engine reconciliation for an owning AppAction transaction', () => {
        expect(clearSolos({ deferRuntimeEffect: true })).toBe(true);

        expect(mocks.mapAllTracks).toHaveBeenCalledTimes(1);
        expect(mocks.applySoloLogic).not.toHaveBeenCalled();
    });
});
