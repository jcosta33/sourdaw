import { createHandler } from '#/helpers/createHandler';
import { startMacroRecording } from '../../useCases/macro/recording/startMacroRecording';

export const handleStartMacroRecording = createHandler<'startMacroRecording'>({
    execute: () => {
        startMacroRecording();
    },
    describe: () => ({ label: 'Start Macro Recording' }),
    undoable: false,
});
