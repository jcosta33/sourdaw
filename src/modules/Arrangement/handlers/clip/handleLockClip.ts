import { createHandler } from '#/utils/createHandler';

import { lockClip } from '../../useCases/clipEditing/lockClip';

export const handleLockClip = createHandler<'lockClip'>({
    execute: (a) => {
        lockClip(a.payload.clipId, a.payload.locked);
    },
    describe: (a) => ({ label: a.payload.locked ? 'Lock clip' : 'Unlock clip' }),
    undoable: true,
});
