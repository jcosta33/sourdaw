import { createHandler } from '#/utils/createHandler';

import { setWorkspaceMode } from '../../useCases/setWorkspaceMode';

export const handleSetWorkspaceMode = createHandler<'setWorkspaceMode'>({
    execute: (alpha) => {
        setWorkspaceMode(alpha.payload.mode);
    },
    describe: () => ({ label: 'Switch view' }),
    undoable: false,
});
