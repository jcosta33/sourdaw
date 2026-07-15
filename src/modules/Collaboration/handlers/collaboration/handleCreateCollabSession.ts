import { createHandler } from '#/utils/createHandler';

import { createSession } from '../../useCases/collaboration/createSession';

export const handleCreateCollabSession = createHandler<'createCollabSession'>({
    execute: (alpha) => {
        createSession(alpha.payload.name ?? 'Host');
    },
    describe: () => ({ label: 'Create collaboration session' }),
    undoable: false,
});
