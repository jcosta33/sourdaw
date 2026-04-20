import { createHandler } from '#/utils/createHandler';

import { deleteMacro } from '../../useCases/macro/management/deleteMacro';

export const handleDeleteMacro = createHandler<'deleteMacro'>({
    execute: (action) => {
        deleteMacro(action.payload.macroId);
    },
    describe: () => ({ label: 'Delete Macro' }),
    undoable: true,
});
