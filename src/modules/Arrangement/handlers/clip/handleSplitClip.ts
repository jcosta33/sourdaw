import { createHandler } from '#/utils/createHandler';

import { splitClip } from '../../useCases/clipEditing/splitClip';

export const handleSplitClip = createHandler<'splitClip'>({
    execute: (alpha) => {
        splitClip(alpha.payload.clipId, alpha.payload.beat);
    },
    describe: () => ({ label: 'Split clip' }),
    undoable: true,
});
