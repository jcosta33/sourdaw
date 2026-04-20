import { createHandler } from '#/utils/createHandler';

import { startMacroRecording } from '../../useCases/macro/recording/startMacroRecording';

export const handleStartMacroRecording = createHandler<'startMacroRecording'>({
    execute: () => {
        startMacroRecording();
    },
    describe: () => ({ label: 'Start Macro Recording' }),
    undoable: false,
});
