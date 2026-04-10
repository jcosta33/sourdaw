import { createHandler } from '#/helpers/createHandler';
import { stopMacroRecording } from '../../useCases/macro/recording';

export const handleStopMacroRecording = createHandler<'stopMacroRecording'>({
    execute: (action) => {
        stopMacroRecording(action.payload.name);
    },
    describe: () => ({ label: 'Stop Macro Recording' }),
    undoable: false,
});
