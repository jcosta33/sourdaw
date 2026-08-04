import { beforeEach, describe, expect, it, vi } from 'vitest';

import { restoreTrackSoloStates } from '../restoreTrackSoloStates';

const mocks = vi.hoisted(() => ({
    getTrackState: vi.fn(),
    mapAllTracks: vi.fn(),
    applySoloLogic: vi.fn(),
}));

vi.mock('../../../repositories/track/getTrackState', () => ({ getTrackState: mocks.getTrackState }));
vi.mock('../../../repositories/track/mapAllTracks', () => ({ mapAllTracks: mocks.mapAllTracks }));
vi.mock('../applySoloLogic', () => ({ applySoloLogic: mocks.applySoloLogic }));

describe('restoreTrackSoloStates', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.getTrackState.mockReturnValue({ tracks: [{ id: 'a' }, { id: 'b' }, { id: 'untouched' }] });
    });

    it('restores only the named tracks and reapplies solo routing', () => {
        expect(
            restoreTrackSoloStates({
                states: [
                    { trackId: 'a', soloed: true },
                    { trackId: 'b', soloed: false },
                ],
            })
        ).toBe(true);

        const mapper = mocks.mapAllTracks.mock.calls[0]![0] as (track: { id: string; soloed: boolean }) => {
            id: string;
            soloed: boolean;
        };
        expect(mapper({ id: 'a', soloed: false })).toEqual({ id: 'a', soloed: true });
        expect(mapper({ id: 'untouched', soloed: true })).toEqual({ id: 'untouched', soloed: true });
        expect(mocks.applySoloLogic).toHaveBeenCalledTimes(1);
    });

    it('rejects empty, duplicate, or missing track snapshots without writing', () => {
        expect(restoreTrackSoloStates({ states: [] })).toBe(false);
        expect(
            restoreTrackSoloStates({
                states: [
                    { trackId: 'a', soloed: true },
                    { trackId: 'a', soloed: false },
                ],
            })
        ).toBe(false);
        expect(restoreTrackSoloStates({ states: [{ trackId: 'missing', soloed: true }] })).toBe(false);

        expect(mocks.mapAllTracks).not.toHaveBeenCalled();
        expect(mocks.applySoloLogic).not.toHaveBeenCalled();
    });

    it('can defer live-engine reconciliation for guarded replay', () => {
        expect(
            restoreTrackSoloStates({
                states: [{ trackId: 'a', soloed: true }],
                deferRuntimeEffect: true,
            })
        ).toBe(true);

        expect(mocks.mapAllTracks).toHaveBeenCalledTimes(1);
        expect(mocks.applySoloLogic).not.toHaveBeenCalled();
    });
});
