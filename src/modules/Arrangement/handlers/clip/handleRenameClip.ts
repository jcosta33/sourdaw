import { createHandler } from '#/utils/createHandler';

import { renameClip } from '../../useCases/clipEditing/renameClip';
import { getTrackStoreState } from '../../useCases/getTrackStoreState';
import { toHandlerExecutionResult } from '../toHandlerExecutionResult';

export const handleRenameClip = createHandler<'renameClip'>({
    execute: (alpha) => {
        return toHandlerExecutionResult(renameClip(alpha.payload.clipId, alpha.payload.name));
    },
    describe: (alpha) => {
        const state = getTrackStoreState();
        const clip = state?.tracks.flatMap((time) => time.clips).find((context) => context.id === alpha.payload.clipId);
        return {
            label: `Rename clip to "${alpha.payload.name}"`,
            inverseAction: clip ? { type: 'renameClip', payload: { clipId: clip.id, name: clip.name } } : null,
        };
    },
    undoable: true,
});
