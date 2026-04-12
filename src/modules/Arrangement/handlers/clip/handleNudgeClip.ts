import { createHandler } from '#/utils/createHandler';
import { nudgeClip } from '../../useCases/clipEditing/nudgeClip';

export const handleNudgeClip = createHandler<'nudgeClip'>({
    execute: (a) => {
        nudgeClip(a.payload.clipId, a.payload.beats);
    },
    describe: (a) => ({ label: `Nudge clip ${a.payload.beats > 0 ? 'right' : 'left'}` }),
    undoable: true,
});
