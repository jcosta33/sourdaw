import { createHandler } from '#/utils/createHandler';
import { splitClip } from '../../useCases/clipEditing/splitClip';

export const handleSplitClip = createHandler<'splitClip'>({
    execute: (a) => {
        splitClip(a.payload.clipId, a.payload.beat);
    },
    describe: () => ({ label: 'Split clip' }),
    undoable: true,
});
