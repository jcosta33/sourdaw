import { createHandler } from '#/utils/createHandler';

import { reverseClip } from '../../useCases/clipEditing/reverseClip';

export const handleReverseClip = createHandler<'reverseClip'>({
    execute: (alpha) => {
        reverseClip(alpha.payload.clipId);
    },
    describe: () => ({ label: 'Reverse clip' }),
    undoable: true,
});
