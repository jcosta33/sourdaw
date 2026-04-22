import { describe, it, expect, vi, beforeEach } from 'vitest';

import { handleSetLayerAffectedTracks } from '../handleSetLayerAffectedTracks';

const mocks = vi.hoisted(() => ({
    setLayerAffectedTracks: vi.fn(),
}));

vi.mock('../../../useCases/adjustmentLayer/setLayerAffectedTracks', () => ({
    setLayerAffectedTracks: mocks.setLayerAffectedTracks,
}));

describe('handleSetLayerAffectedTracks', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('forwards layer id and track ids', () => {
        handleSetLayerAffectedTracks.execute({
            type: 'setLayerAffectedTracks',
            payload: { layerId: 'L', trackIds: ['t1', 't2'] },
        });
        expect(mocks.setLayerAffectedTracks).toHaveBeenCalledWith('L', ['t1', 't2']);
    });
});
