import { describe, it, expect, vi, beforeEach } from 'vitest';

import { handleAddAdjustmentRegion } from '../handleAddAdjustmentRegion';

const mocks = vi.hoisted(() => ({
    addAdjustmentRegion: vi.fn(),
}));

vi.mock('../../../useCases/adjustmentLayer/addAdjustmentRegion', () => ({
    addAdjustmentRegion: mocks.addAdjustmentRegion,
}));

describe('handleAddAdjustmentRegion', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('forwards layer id, startBeat, endBeat, blend', () => {
        void handleAddAdjustmentRegion.execute({
            type: 'addAdjustmentRegion',
            payload: { layerId: 'L', startBeat: 0, endBeat: 8, blend: 0.75 },
        });
        expect(mocks.addAdjustmentRegion).toHaveBeenCalledWith('L', 0, 8, 0.75, expect.any(String));
    });

    it('omits blend when undefined', () => {
        void handleAddAdjustmentRegion.execute({
            type: 'addAdjustmentRegion',
            payload: { layerId: 'L', startBeat: 0, endBeat: 8 },
        });
        expect(mocks.addAdjustmentRegion).toHaveBeenCalledWith('L', 0, 8, undefined, expect.any(String));
    });
});
