import { createHandler } from '#/utils/createHandler';

import { lockClip } from '../../useCases/clipEditing/lockClip';

export const handleLockClip = createHandler<'lockClip'>({
    execute: (alpha) => {
        lockClip(alpha.payload.clipId, alpha.payload.locked);
    },
    describe: (alpha) => ({ label: alpha.payload.locked ? 'Lock clip' : 'Unlock clip' }),
    undoable: true,
});
