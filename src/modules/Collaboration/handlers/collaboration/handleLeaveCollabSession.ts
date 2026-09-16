import { createHandler } from '#/utils/createHandler';

import { leaveSession } from '../../useCases/collaboration/leaveSession';

export const handleLeaveCollabSession = createHandler<'leaveCollabSession'>({
    execute: async () => {
        await leaveSession();
    },
    describe: () => ({ label: 'Leave collaboration session' }),
    undoable: false,
    executionKind: 'runtime',
    previewExecution: 'unsupported-external',
    requiresAbortCompensation: false,
    batchExecution: 'singleton',
});
