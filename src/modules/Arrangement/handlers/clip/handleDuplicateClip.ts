import { createHandler } from '#/utils/createHandler';

import { duplicateClip } from '../../useCases/clip/duplicateClip';

export const handleDuplicateClip = createHandler<'duplicateClip'>({
    execute: (a) => {
        duplicateClip(a.payload.clipId);
    },
    describe: () => ({ label: 'Duplicate clip' }),
    undoable: true,
});
