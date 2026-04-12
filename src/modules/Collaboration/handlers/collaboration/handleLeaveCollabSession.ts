import { createHandler } from '#/utils/createHandler';
import { leaveSession } from '../../useCases/collaboration/sessionManagement';

export const handleLeaveCollabSession = createHandler<'leaveCollabSession'>({
    execute: () => {
        leaveSession();
    },
    describe: () => ({ label: 'Leave collaboration session' }),
    undoable: false,
});
