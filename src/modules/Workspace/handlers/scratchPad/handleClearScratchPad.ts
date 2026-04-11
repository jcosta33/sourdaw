import { createHandler } from '#/helpers/createHandler';
import { clearScratchPad } from '#/modules/Arrangement/useCases';

export const handleClearScratchPad = createHandler<'clearScratchPad'>({
    execute: () => {
        clearScratchPad();
    },
    describe: () => ({ label: 'Clear Scratch Pad' }),
    undoable: true,
});
