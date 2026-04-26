import { createHandler } from '#/utils/createHandler';

import { normalizeClip } from '../../useCases/clipEditing/normalizeClip';

export const handleNormalizeClip = createHandler<'normalizeClip'>({
    execute: (alpha) => {
        normalizeClip(alpha.payload.clipId, alpha.payload.mode, alpha.payload.targetDb);
    },
    describe: (alpha) => ({ label: `Normalize clip (${alpha.payload.mode ?? 'peak'})` }),
    undoable: true,
});
