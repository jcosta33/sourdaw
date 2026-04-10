import { createHandler } from '#/helpers/createHandler';
import { notifyUser } from '#/helpers/Notification/notifyUser';
import { togglePunchRecording } from '#/modules/Transport';

export const handleTogglePunchRecording = createHandler<'togglePunchRecording'>({
    execute: () => {
        togglePunchRecording();
        notifyUser('Punch recording toggled');
    },
    describe: () => ({ label: 'Toggle Punch Recording' }),
    undoable: false,
});
