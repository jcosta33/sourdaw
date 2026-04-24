import { describe, it, expect, vi, beforeEach } from 'vitest';

import { handleMoveAdjustmentRegion } from '../handleMoveAdjustmentRegion';

const mocks = vi.hoisted(() => ({
    moveAdjustmentRegion: vi.fn(),
}));

vi.mock('../../../useCases/adjustmentLayer/moveAdjustmentRegion', () => ({
    moveAdjustmentRegion: mocks.moveAdjustmentRegion,
}));

describe('handleMoveAdjustmentRegion', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('forwards region id, startBeat, endBeat', () => {
        handleMoveAdjustmentRegion.execute({
            type: 'moveAdjustmentRegion',
            payload: { regionId: 'R', startBeat: 4, endBeat: 8 },
        });
        expect(mocks.moveAdjustmentRegion).toHaveBeenCalledWith('R', 4, 8);
    });
});
