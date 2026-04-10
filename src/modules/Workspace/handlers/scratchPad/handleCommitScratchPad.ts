import { createHandler } from '#/helpers/createHandler';
import { commitScratchPadToArrangement } from '#/modules/Arrangement';

export const handleCommitScratchPad = createHandler<'commitScratchPad'>({
    execute: () => {
        commitScratchPadToArrangement();
    },
    describe: () => ({ label: 'Apply Scratch Pad to Arrangement' }),
    undoable: true,
});
