import { createHandler } from '#/helpers/createHandler';
import { leaveSession } from '../../useCases/collaboration/sessionManagement';

export const handleLeaveCollabSession = createHandler<'leaveCollabSession'>({
    execute: () => {
        leaveSession();
    },
    describe: () => ({ label: 'Leave collaboration session' }),
    undoable: false,
});
