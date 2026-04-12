import { setAutomationMode } from '../../useCases/toggleTrackState/setAutomationMode';
import { createHandler } from '#/utils/createHandler';

export const handleSetAutomationMode = createHandler<'setAutomationMode'>({
    execute: (action) => {
        setAutomationMode(action.payload.trackId, action.payload.mode);
    },
    describe: (a) => ({ label: `Set automation mode: ${a.payload.mode}` }),
    undoable: true,
});
