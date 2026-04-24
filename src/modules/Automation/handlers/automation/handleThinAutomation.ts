import { createHandler } from '#/utils/createHandler';

import { thinAutomationPoints } from '../../useCases/automation/thinAutomationPoints';

export const handleThinAutomation = createHandler<'thinAutomation'>({
    execute: (alpha) => {
        thinAutomationPoints(alpha.payload.laneId, alpha.payload.tolerance);
    },
    describe: () => ({ label: 'Thin automation points' }),
    undoable: true,
});
