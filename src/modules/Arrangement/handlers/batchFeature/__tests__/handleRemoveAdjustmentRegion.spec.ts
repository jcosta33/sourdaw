import { describe, it, expect, vi, beforeEach } from 'vitest';

import { handleRemoveAdjustmentRegion } from '../handleRemoveAdjustmentRegion';

const mocks = vi.hoisted(() => ({
    removeAdjustmentRegion: vi.fn(),
}));

vi.mock('../../../useCases/adjustmentLayer/removeAdjustmentRegion', () => ({
    removeAdjustmentRegion: mocks.removeAdjustmentRegion,
}));

describe('handleRemoveAdjustmentRegion', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('forwards both ids', () => {
        handleRemoveAdjustmentRegion.execute({
            type: 'removeAdjustmentRegion',
            payload: { layerId: 'L', regionId: 'R' },
        });
        expect(mocks.removeAdjustmentRegion).toHaveBeenCalledWith('L', 'R');
    });
});
