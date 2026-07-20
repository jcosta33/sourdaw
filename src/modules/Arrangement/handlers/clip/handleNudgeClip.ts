import { createHandler } from '#/utils/createHandler';

import { nudgeClip } from '../../useCases/clipEditing/nudgeClip';

export const handleNudgeClip = createHandler<'nudgeClip'>({
    execute: (alpha) => {
        nudgeClip(alpha.payload.clipId, alpha.payload.beats);
    },
    describe: (alpha) => ({
        label: `Nudge clip ${alpha.payload.beats > 0 ? 'right' : 'left'}`,
        inverseAction: { type: 'nudgeClip', payload: { clipId: alpha.payload.clipId, beats: -alpha.payload.beats } },
    }),
    undoable: true,
});
