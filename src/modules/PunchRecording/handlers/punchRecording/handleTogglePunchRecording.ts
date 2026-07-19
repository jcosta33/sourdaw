import { createHandler } from '#/utils/createHandler';
import { notifyUser } from '#/utils/Notification/notifyUser';

import { togglePunchRecordingUnderCommand } from '../../useCases/punchRecording/togglePunchRecordingUnderCommand';

export const handleTogglePunchRecording = createHandler<'togglePunchRecording'>({
    execute: async (_action, context) => {
        if (!context?.runLegacyCommandMutation) {
            throw new Error('Command execution context is required to toggle punch recording');
        }
        await togglePunchRecordingUnderCommand(context.runLegacyCommandMutation);
        notifyUser('Punch recording toggled');
    },
    describe: () => ({ label: 'Toggle Punch Recording' }),
    undoable: false,
});
