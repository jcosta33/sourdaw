import { createHandler } from '#/utils/createHandler';

import { setClipGain } from '../../useCases/clipEditing/setClipGain';

export const handleSetClipGain = createHandler<'setClipGain'>({
    execute: (alpha) => {
        setClipGain(alpha.payload.clipId, alpha.payload.gain);
    },
    describe: () => ({ label: 'Set clip gain' }),
    undoable: true,
});
