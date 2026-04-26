import { createHandler } from '#/utils/createHandler';

import { duplicateClipToNextBar } from '../../useCases/clip/duplicateClipToNextBar';

export const handleDuplicateClipToNextBar = createHandler<'duplicateClipToNextBar'>({
    execute: (alpha) => {
        duplicateClipToNextBar(alpha.payload.clipId);
    },
    describe: () => ({ label: 'Duplicate clip to next bar' }),
    undoable: true,
});
