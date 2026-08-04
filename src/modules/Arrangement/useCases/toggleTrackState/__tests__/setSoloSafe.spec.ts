import { beforeEach, describe, expect, it, vi } from 'vitest';

import { setSoloSafe } from '../setSoloSafe';

const mocks = vi.hoisted(() => ({
    getTrackState: vi.fn(),
    updateTrack: vi.fn(),
    applySoloLogic: vi.fn(),
}));

vi.mock('../../../repositories/track/getTrackState', () => ({ getTrackState: mocks.getTrackState }));
vi.mock('../../../repositories/track/updateTrack', () => ({ updateTrack: mocks.updateTrack }));
vi.mock('../applySoloLogic', () => ({ applySoloLogic: mocks.applySoloLogic }));

describe('setSoloSafe', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.getTrackState.mockReturnValue({ tracks: [{ id: 'track-1', soloSafe: false }] });
    });

    it('sets the explicit solo-safe state and reapplies solo routing', () => {
        expect(setSoloSafe({ trackId: 'track-1', soloSafe: true })).toBe(true);

        const updater = mocks.updateTrack.mock.calls[0]![1] as (track: { id: string; soloSafe: boolean }) => {
            id: string;
            soloSafe: boolean;
        };
        expect(updater({ id: 'track-1', soloSafe: false })).toEqual({ id: 'track-1', soloSafe: true });
        expect(mocks.applySoloLogic).toHaveBeenCalledTimes(1);
    });

    it('does not write when the target is missing or already has the requested state', () => {
        expect(setSoloSafe({ trackId: 'track-1', soloSafe: false })).toBe(false);
        mocks.getTrackState.mockReturnValue({ tracks: [] });
        expect(setSoloSafe({ trackId: 'track-1', soloSafe: true })).toBe(false);

        expect(mocks.updateTrack).not.toHaveBeenCalled();
        expect(mocks.applySoloLogic).not.toHaveBeenCalled();
    });

    it('can defer live-engine reconciliation for an owning AppAction transaction', () => {
        expect(setSoloSafe({ trackId: 'track-1', soloSafe: true, deferRuntimeEffect: true })).toBe(true);

        expect(mocks.updateTrack).toHaveBeenCalledTimes(1);
        expect(mocks.applySoloLogic).not.toHaveBeenCalled();
    });
});
