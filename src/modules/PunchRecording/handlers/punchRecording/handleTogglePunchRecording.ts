import { createHandler } from '#/utils/createHandler';
import { notifyUser } from '#/utils/Notification/notifyUser';

import { togglePunchRecordingUnderCommand } from '../../useCases/punchRecording/togglePunchRecordingUnderCommand';

export const handleTogglePunchRecording = createHandler<'togglePunchRecording'>({
    execute: () => {
        togglePunchRecordingUnderCommand();
        notifyUser('Punch recording toggled');
    },
    describe: () => ({ label: 'Toggle Punch Recording' }),
    undoable: false,
});
