import { createHandler } from '#/utils/createHandler';

import { setWorkspaceMode } from '../../useCases/setWorkspaceMode';

export const handleSetWorkspaceMode = createHandler<'setWorkspaceMode'>({
    execute: (a) => {
        setWorkspaceMode(a.payload.mode);
    },
    describe: () => ({ label: 'Switch view' }),
    undoable: false,
});
