import { createHandler } from '#/utils/createHandler';

import { trimClipEnd } from '../../useCases/clipEditing/trimClipEnd';
import { getTrackStoreState } from '../../useCases/getTrackStoreState';

export const handleTrimClipEnd = createHandler<'trimClipEnd'>({
    execute: (alpha) => {
        trimClipEnd(alpha.payload.clipId, alpha.payload.newEndBeat);
    },
    describe: (alpha) => {
        const state = getTrackStoreState();
        const clip = state?.tracks.flatMap((time) => time.clips).find((context) => context.id === alpha.payload.clipId);
        return {
            label: 'Trim clip end',
            inverseAction: clip
                ? { type: 'trimClipEnd', payload: { clipId: clip.id, newEndBeat: clip.endBeat } }
                : null,
        };
    },
    undoable: true,
});
