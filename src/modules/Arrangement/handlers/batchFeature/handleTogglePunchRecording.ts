import { togglePunchRecording } from '#/modules/Transport/useCases';
import { createHandler } from '#/utils/createHandler';
import { notifyUser } from '#/utils/Notification/notifyUser';

export const handleTogglePunchRecording = createHandler<'togglePunchRecording'>({
    execute: () => {
        togglePunchRecording();
        notifyUser('Punch recording toggled');
    },
    describe: () => ({ label: 'Toggle Punch Recording' }),
    undoable: false,
});
