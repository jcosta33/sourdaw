import { createHandler } from '#/utils/createHandler';
import { thinAutomationPoints } from '../../useCases/automation/thinAutomationPoints';

export const handleThinAutomation = createHandler<'thinAutomation'>({
    execute: (a) => {
        thinAutomationPoints(a.payload.laneId, a.payload.tolerance);
    },
    describe: () => ({ label: 'Thin automation points' }),
    undoable: true,
});
