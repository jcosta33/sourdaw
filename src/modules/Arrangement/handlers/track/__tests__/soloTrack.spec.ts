import { describe, it, expect, vi, beforeEach } from 'vitest';

import { handleSoloTrack } from '../soloTrack';

const mocks = vi.hoisted(() => ({
    soloTrack: vi.fn(),
    trackStoreState: {
        value: {
            tracks: [{ id: 't1', soloed: false }],
        },
    },
}));

vi.mock('../../../useCases/toggleTrackState/soloTrack', () => ({
    soloTrack: mocks.soloTrack,
}));

vi.mock('../../../useCases/getTrackStoreState', () => ({
    getTrackStoreState: () => mocks.trackStoreState.value,
}));

describe('handleSoloTrack', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.trackStoreState.value = {
            tracks: [{ id: 't1', soloed: false }],
        };
    });

    it('executes soloTrack with payload', () => {
        void handleSoloTrack.execute({
            type: 'soloTrack',
            payload: { trackId: 't1', soloed: true },
        });

        expect(mocks.soloTrack).toHaveBeenCalledWith('t1', true);
    });

    it('provides a description and inverse action based on soloed state', () => {
        const desc1 = handleSoloTrack.describe({
            type: 'soloTrack',
            payload: { trackId: 't1', soloed: true },
        });
        expect(desc1.label).toBe('Solo track');
        expect(desc1.inverseAction).toEqual({
            type: 'soloTrack',
            payload: { trackId: 't1', soloed: false, expectedSoloed: true },
        });
        expect(desc1.redoAction).toEqual({
            type: 'soloTrack',
            payload: { trackId: 't1', soloed: true, expectedSoloed: false },
        });

        mocks.trackStoreState.value.tracks[0] = { id: 't1', soloed: true };
        const desc2 = handleSoloTrack.describe({
            type: 'soloTrack',
            payload: { trackId: 't1', soloed: false },
        });
        expect(desc2.label).toBe('Unsolo track');
        expect(desc2.inverseAction).toEqual({
            type: 'soloTrack',
            payload: { trackId: 't1', soloed: true, expectedSoloed: false },
        });
    });

    it('refuses to write over a solo state that diverged from the expected one', () => {
        mocks.trackStoreState.value.tracks[0] = { id: 't1', soloed: true };

        const result = handleSoloTrack.execute({
            type: 'soloTrack',
            payload: { trackId: 't1', soloed: true, expectedSoloed: false },
        });

        expect(result).toEqual({ status: 'conflict' });
        expect(mocks.soloTrack).not.toHaveBeenCalled();
    });

    it('certifies divergence reapplication only for a guarded payload', () => {
        expect(
            handleSoloTrack.canReapplyAfterDivergence?.({
                type: 'soloTrack',
                payload: { trackId: 't1', soloed: true, expectedSoloed: false },
            })
        ).toBe(true);
        expect(
            handleSoloTrack.canReapplyAfterDivergence?.({
                type: 'soloTrack',
                payload: { trackId: 't1', soloed: true },
            })
        ).toBe(false);
    });

    it('does not manufacture an inverse for a missing track', () => {
        mocks.trackStoreState.value = { tracks: [] };

        const desc = handleSoloTrack.describe({
            type: 'soloTrack',
            payload: { trackId: 'missing', soloed: true },
        });

        expect(desc.inverseAction).toBeNull();
    });

    it('is undoable', () => {
        expect(handleSoloTrack.undoable).toBe(true);
    });
});
