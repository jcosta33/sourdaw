import { createHandler } from '#/utils/createHandler';

import { stopMacroRecording } from '../../useCases/macro/recording/stopMacroRecording';

export const handleStopMacroRecording = createHandler<'stopMacroRecording'>({
    execute: (action) => {
        stopMacroRecording(action.payload.name);
    },
    describe: () => ({ label: 'Stop Macro Recording' }),
    undoable: false,
});
