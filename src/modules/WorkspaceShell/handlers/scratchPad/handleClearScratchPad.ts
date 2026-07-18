import { clearScratchPad } from '#/modules/Arrangement/useCases';
import { createHandler } from '#/utils/createHandler';

export const handleClearScratchPad = createHandler<'clearScratchPad'>({
    execute: () => {
        clearScratchPad();
    },
    describe: () => ({ label: 'Clear Scratch Pad' }),
    undoable: true,
});
