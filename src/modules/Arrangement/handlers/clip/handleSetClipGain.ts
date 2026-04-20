import { createHandler } from '#/utils/createHandler';

import { setClipGain } from '../../useCases/clipEditing/setClipGain';

export const handleSetClipGain = createHandler<'setClipGain'>({
    execute: (a) => {
        setClipGain(a.payload.clipId, a.payload.gain);
    },
    describe: () => ({ label: 'Set clip gain' }),
    undoable: true,
});
