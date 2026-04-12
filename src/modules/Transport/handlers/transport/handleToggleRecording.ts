import { createHandler } from '#/utils/createHandler';
import { toggleRecording } from '../../useCases/transportControls/toggleRecording';

export const handleToggleRecording = createHandler<'toggleRecording'>({
    execute: () => {
        toggleRecording();
    },
    describe: () => ({ label: 'Toggle recording' }),
    undoable: false,
});
