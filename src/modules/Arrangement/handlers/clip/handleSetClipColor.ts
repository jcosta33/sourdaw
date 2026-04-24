import { createHandler } from '#/utils/createHandler';

import { setClipColor } from '../../useCases/clipEditing/setClipColor';

export const handleSetClipColor = createHandler<'setClipColor'>({
    execute: (alpha) => {
        setClipColor(alpha.payload.clipId, alpha.payload.color);
    },
    describe: () => ({ label: 'Set clip color' }),
    undoable: true,
});
