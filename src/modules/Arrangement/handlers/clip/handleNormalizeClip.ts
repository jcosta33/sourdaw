import { createHandler } from '#/helpers/createHandler';
import { normalizeClip } from '../../useCases/clipEditing/normalizeClip';

export const handleNormalizeClip = createHandler<'normalizeClip'>({
    execute: (a) => {
        normalizeClip(a.payload.clipId, a.payload.mode, a.payload.targetDb);
    },
    describe: (a) => ({ label: `Normalize clip (${a.payload.mode ?? 'peak'})` }),
    undoable: true,
});
