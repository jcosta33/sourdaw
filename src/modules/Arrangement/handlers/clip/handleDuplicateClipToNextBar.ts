import { createHandler } from '#/helpers/createHandler';
import { duplicateClipToNextBar } from '../../useCases/clip/duplicateClipToNextBar';

export const handleDuplicateClipToNextBar = createHandler<'duplicateClipToNextBar'>({
    execute: (a) => {
        duplicateClipToNextBar(a.payload.clipId);
    },
    describe: () => ({ label: 'Duplicate clip to next bar' }),
    undoable: true,
});
