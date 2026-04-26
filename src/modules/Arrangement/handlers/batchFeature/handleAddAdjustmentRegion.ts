import { createHandler } from '#/utils/createHandler';

import { addAdjustmentRegion } from '../../useCases/adjustmentLayer/addAdjustmentRegion';

export const handleAddAdjustmentRegion = createHandler<'addAdjustmentRegion'>({
    execute: (a) => {
        addAdjustmentRegion(a.payload.layerId, a.payload.startBeat, a.payload.endBeat, a.payload.blend);
    },
    describe: () => ({ label: 'Add Adjustment Region' }),
    undoable: true,
});
