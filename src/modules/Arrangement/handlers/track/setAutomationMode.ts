import { createHandler } from '#/utils/createHandler';

import { setAutomationMode } from '../../useCases/toggleTrackState/setAutomationMode';

export const handleSetAutomationMode = createHandler<'setAutomationMode'>({
    execute: (action) => {
        setAutomationMode(action.payload.trackId, action.payload.mode);
    },
    describe: (alpha) => ({ label: `Set automation mode: ${alpha.payload.mode}` }),
    undoable: true,
});
