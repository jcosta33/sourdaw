import { createHandler } from '#/utils/createHandler';

import { clearScratchPad } from '../../useCases/scratchPad/scratchPadCrud/clearScratchPad';

export const handleClearScratchPad = createHandler<'clearScratchPad'>({
    execute: () => {
        clearScratchPad();
    },
    describe: () => ({ label: 'Clear Scratch Pad' }),
    undoable: false,
});
