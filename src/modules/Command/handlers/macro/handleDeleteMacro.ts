import { createHandler } from '#/utils/createHandler';

import { deleteMacro } from '../../useCases/macro/management/deleteMacro';

export const handleDeleteMacro = createHandler<'deleteMacro'>({
    execute: (action) => {
        deleteMacro(action.payload.macroId);
    },
    describe: () => ({ label: 'Delete Macro' }),
    // Not undoable: `describe` emits no `inverseAction`, and no `restoreMacro`/`addMacro`
    // action exists to reinstate a deleted macro. Marking this `undoable: true` made
    // Cmd+Z on "Delete Macro" a silent no-op that still consumed the keypress — the undo
    // engine leaves an inverse-less entry on the stack and returns without undoing
    // anything (see useCases/undoRedo.ts `executeUndo`). Until a restore action is
    // modelled, the honest behaviour is to leave this action out of the undo history
    // entirely (audit #4).
    undoable: false,
});
