import { commitScratchPadToArrangement } from '#/modules/Arrangement/useCases';
import { createHandler } from '#/utils/createHandler';

export const handleCommitScratchPad = createHandler<'commitScratchPad'>({
    execute: () => {
        commitScratchPadToArrangement();
    },
    describe: () => ({ label: 'Apply Scratch Pad to Arrangement' }),
    undoable: true,
});
