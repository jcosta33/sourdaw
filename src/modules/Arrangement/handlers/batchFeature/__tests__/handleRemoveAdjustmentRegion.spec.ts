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

    it('admits divergent compensation only when the generated region is guarded', () => {
        expect(
            handleRemoveAdjustmentRegion.canReapplyAfterDivergence?.({
                type: 'removeAdjustmentRegion',
                payload: { layerId: 'L', regionId: 'R' },
            })
        ).toBe(false);
        expect(
            handleRemoveAdjustmentRegion.canReapplyAfterDivergence?.({
                type: 'removeAdjustmentRegion',
                payload: {
                    layerId: 'L',
                    regionId: 'R',
                    expectedRegion: {
                        id: 'R',
                        startBeat: 16,
                        endBeat: 32,
                        blend: 1,
                        fadeInBeats: 0,
                        fadeOutBeats: 0,
                    },
                },
            })
        ).toBe(true);
    });
});
