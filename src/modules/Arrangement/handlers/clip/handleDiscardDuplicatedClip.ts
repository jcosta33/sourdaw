import { createHandler } from '#/utils/createHandler';

import { removeClip } from '../../useCases/clip/removeClip';

export const handleDiscardDuplicatedClip = createHandler<'discardDuplicatedClip'>({
    execute: (alpha) => {
        removeClip(alpha.payload.clipId);
    },
    describe: () => ({ label: 'Discard duplicated clip' }),
    undoable: false,
});
