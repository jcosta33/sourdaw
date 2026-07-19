import { createHandler } from '#/utils/createHandler';

import { getNextRegionId } from '../../stores/adjustmentLayer';
import { addAdjustmentRegion } from '../../useCases/adjustmentLayer/addAdjustmentRegion';

export const handleAddAdjustmentRegion = createHandler<'addAdjustmentRegion'>({
    execute: (a) => {
        a.payload.regionId ??= getNextRegionId();
        addAdjustmentRegion({
            layerId: a.payload.layerId,
            startBeat: a.payload.startBeat,
            endBeat: a.payload.endBeat,
            blend: a.payload.blend,
            regionId: a.payload.regionId,
        });
    },
    describe: () => ({ label: 'Add Adjustment Region' }),
    undoable: true,
});
