import { createHandler } from '#/utils/createHandler';

import { commitScratchPadToArrangement } from '../../useCases/scratchPad/captureCommit/commitScratchPadToArrangement';

export const handleCommitScratchPad = createHandler<'commitScratchPad'>({
    execute: () => {
        commitScratchPadToArrangement();
    },
    describe: () => ({ label: 'Apply Scratch Pad to Arrangement' }),
    undoable: false,
});
