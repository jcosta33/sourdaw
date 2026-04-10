import { createHandler } from '#/helpers/createHandler';
import { deleteMacro } from '../../useCases/macro/management';

export const handleDeleteMacro = createHandler<'deleteMacro'>({
    execute: (action) => {
        deleteMacro(action.payload.macroId);
    },
    describe: () => ({ label: 'Delete Macro' }),
    undoable: true,
});
