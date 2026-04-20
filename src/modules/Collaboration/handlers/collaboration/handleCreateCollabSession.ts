import { createHandler } from '#/utils/createHandler';

import { createSession } from '../../useCases/collaboration/sessionManagement';

export const handleCreateCollabSession = createHandler<'createCollabSession'>({
    execute: (a) => {
        createSession(a.payload.name ?? 'Host');
    },
    describe: () => ({ label: 'Create collaboration session' }),
    undoable: false,
});
