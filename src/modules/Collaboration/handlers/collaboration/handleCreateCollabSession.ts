import { createHandler } from '#/utils/createHandler';

import { createSession } from '../../useCases/collaboration/createSession';

export const handleCreateCollabSession = createHandler<'createCollabSession'>({
    execute: async (alpha) => {
        await createSession(alpha.payload.name ?? 'Host');
    },
    describe: () => ({ label: 'Create collaboration session' }),
    undoable: false,
    executionKind: 'runtime',
    previewExecution: 'unsupported-external',
    requiresAbortCompensation: false,
    batchExecution: 'singleton',
});
