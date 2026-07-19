import { describe, it, expect, vi, beforeEach } from 'vitest';

import { handleAddAdjustmentRegion } from '../handleAddAdjustmentRegion';

import type { AppAction } from '#/utils/handlerContract';
import type { AddAdjustmentRegionInput } from '../../../useCases/adjustmentLayer/addAdjustmentRegion';

const mocks = vi.hoisted(() => ({
    addAdjustmentRegion: vi.fn<(input: AddAdjustmentRegionInput) => void>(),
}));

vi.mock('../../../useCases/adjustmentLayer/addAdjustmentRegion', () => ({
    addAdjustmentRegion: mocks.addAdjustmentRegion,
}));

describe('handleAddAdjustmentRegion', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('forwards the region fields with a replay-stable id', () => {
        const action: Extract<AppAction, { type: 'addAdjustmentRegion' }> = {
            type: 'addAdjustmentRegion',
            payload: { layerId: 'L', startBeat: 0, endBeat: 8, blend: 0.75 },
        };

        void handleAddAdjustmentRegion.execute(action);

        const regionId = action.payload.regionId;
        if (!regionId) {
            throw new Error('Expected the handler to assign a region id');
        }
        expect(mocks.addAdjustmentRegion).toHaveBeenCalledWith({
            layerId: 'L',
            startBeat: 0,
            endBeat: 8,
            blend: 0.75,
            regionId,
        });
    });

    it('omits blend when undefined', () => {
        const action: Extract<AppAction, { type: 'addAdjustmentRegion' }> = {
            type: 'addAdjustmentRegion',
            payload: { layerId: 'L', startBeat: 0, endBeat: 8 },
        };

        void handleAddAdjustmentRegion.execute(action);

        const regionId = action.payload.regionId;
        if (!regionId) {
            throw new Error('Expected the handler to assign a region id');
        }
        expect(mocks.addAdjustmentRegion).toHaveBeenCalledWith({
            layerId: 'L',
            startBeat: 0,
            endBeat: 8,
            blend: undefined,
            regionId,
        });
    });
});
