import { createHandler } from '#/utils/createHandler';

import { stretchAutomationTime } from '../../useCases/automation/stretchAutomationTime';

export const handleStretchAutomation = createHandler<'stretchAutomation'>({
    execute: (alpha) => {
        stretchAutomationTime(alpha.payload.laneId, alpha.payload.factor, alpha.payload.anchorBeat);
    },
    describe: (alpha) => ({ label: `Stretch automation ×${alpha.payload.factor}` }),
    undoable: true,
});
