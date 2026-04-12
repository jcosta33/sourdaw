import { createHandler } from '#/utils/createHandler';
import { notifyUser } from '#/utils/Notification/notifyUser';
import { togglePunchRecording } from '#/modules/Transport/useCases';

export const handleTogglePunchRecording = createHandler<'togglePunchRecording'>({
    execute: () => {
        togglePunchRecording();
        notifyUser('Punch recording toggled');
    },
    describe: () => ({ label: 'Toggle Punch Recording' }),
    undoable: false,
});
