import { createHandler } from '#/utils/createHandler';

import { duplicateClip } from '../../useCases/clip/duplicateClip';

export const handleDuplicateClip = createHandler<'duplicateClip'>({
    execute: (alpha) => {
        duplicateClip(alpha.payload.clipId);
    },
    describe: () => ({ label: 'Duplicate clip' }),
    undoable: true,
});
