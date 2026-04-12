import { createHandler } from '#/utils/createHandler';
import { stretchAutomationTime } from '../../useCases/automation/stretchAutomationTime';

export const handleStretchAutomation = createHandler<'stretchAutomation'>({
    execute: (a) => {
        stretchAutomationTime(a.payload.laneId, a.payload.factor, a.payload.anchorBeat);
    },
    describe: (a) => ({ label: `Stretch automation ×${a.payload.factor}` }),
    undoable: true,
});
