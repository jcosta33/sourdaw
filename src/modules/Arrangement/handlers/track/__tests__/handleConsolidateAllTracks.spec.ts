import { describe, it, expect, vi, beforeEach } from 'vitest';

import { handleConsolidateAllTracks } from '../handleConsolidateAllTracks';

const mocks = vi.hoisted(() => ({
    getTrackStoreState: vi.fn(),
    bounceInPlace: vi.fn(),
}));

vi.mock('../../../useCases/getTrackStoreState', () => ({
    getTrackStoreState: mocks.getTrackStoreState,
}));

vi.mock('#/modules/Arrangement/useCases/freezeBounce/bounceInPlace', () => ({
    bounceInPlace: mocks.bounceInPlace,
}));

describe('handleConsolidateAllTracks', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('bails if track store state is unavailable', async () => {
        mocks.getTrackStoreState.mockReturnValue(null);

        await handleConsolidateAllTracks.execute({ type: 'consolidateAllTracks', payload: undefined });

        expect(mocks.bounceInPlace).not.toHaveBeenCalled();
    });

    it('bounces audio and midi tracks that have clips', async () => {
        mocks.getTrackStoreState.mockReturnValue({
            tracks: [
                { id: 't1', kind: 'audio', clips: [{ id: 'c1' }] },
                { id: 't2', kind: 'midi', clips: [{ id: 'c2' }] },
                { id: 't3', kind: 'audio', clips: [] }, // No clips, should be skipped
                { id: 't4', kind: 'bus', clips: [{ id: 'c3' }] }, // Bus, should be skipped
            ],
        });

        await handleConsolidateAllTracks.execute({ type: 'consolidateAllTracks', payload: undefined });

        expect(mocks.bounceInPlace).toHaveBeenCalledTimes(2);
        expect(mocks.bounceInPlace).toHaveBeenCalledWith('t1');
        expect(mocks.bounceInPlace).toHaveBeenCalledWith('t2');
    });

    it('provides a description', () => {
        const desc = handleConsolidateAllTracks.describe({ type: 'consolidateAllTracks', payload: undefined });
        expect(desc.label).toBe('Consolidate all tracks');
    });

    it('is undoable', () => {
        expect(handleConsolidateAllTracks.undoable).toBe(true);
    });
});
