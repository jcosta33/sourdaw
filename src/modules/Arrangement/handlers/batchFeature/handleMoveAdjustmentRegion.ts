import { createHandler } from '#/utils/createHandler';

import { moveAdjustmentRegion } from '../../useCases/adjustmentLayer/moveAdjustmentRegion';

export const handleMoveAdjustmentRegion = createHandler<'moveAdjustmentRegion'>({
    execute: (a) => {
        moveAdjustmentRegion(a.payload.regionId, a.payload.startBeat, a.payload.endBeat);
    },
    describe: () => ({ label: 'Move Adjustment Region' }),
    undoable: false,
});
