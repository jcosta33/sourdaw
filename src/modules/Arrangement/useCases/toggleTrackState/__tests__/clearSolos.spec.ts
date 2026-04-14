import { describe, it, expect, vi, beforeEach } from 'vitest';
import { clearSolos } from '../clearSolos';

const mocks = vi.hoisted(() => ({
    mapAllTracks: vi.fn(),
    applySoloLogic: vi.fn(),
}));

vi.mock('#/modules/Arrangement/repositories/track/mapAllTracks', () => ({
    mapAllTracks: mocks.mapAllTracks,
}));

vi.mock('#/modules/Arrangement/services/applySoloLogic', () => ({
    applySoloLogic: mocks.applySoloLogic,
}));

describe('clearSolos', () => {
    beforeEach(() => vi.clearAllMocks());

    it('should map all tracks to soloed false and apply solo routing', () => {
        clearSolos();

        expect(mocks.mapAllTracks).toHaveBeenCalledTimes(1);
        expect(mocks.mapAllTracks).toHaveBeenCalledWith(expect.any(Function));

        const mapper = mocks.mapAllTracks.mock.calls[0]![0] as (t: { soloed: boolean; id: string }) => {
            soloed: boolean;
            id: string;
        };
        expect(mapper({ soloed: true, id: 't1' })).toEqual({ soloed: false, id: 't1' });

        expect(mocks.applySoloLogic).toHaveBeenCalledTimes(1);
    });
});
