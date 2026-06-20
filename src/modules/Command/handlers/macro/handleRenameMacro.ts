import { createHandler } from '#/utils/createHandler';

import { renameMacro } from '../../useCases/macro/management/renameMacro';

export const handleRenameMacro = createHandler<'renameMacro'>({
    execute: (action) => {
        renameMacro(action.payload.macroId, action.payload.name);
    },
    describe: () => ({ label: 'Rename Macro' }),
    // Not undoable, mirroring `handleDeleteMacro`: `describe` emits no
    // `inverseAction`, so the undo engine would otherwise leave an inverse-less
    // entry that consumes Cmd+Z without restoring anything. A lossless inverse
    // *is* expressible here (re-`renameMacro` with the pre-edit name captured in
    // `describe`), but wiring macro undo is a separate decision tracked with the
    // other macro handlers' undo posture — out of scope for this dispatch fix.
    undoable: false,
});
