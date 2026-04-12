import { createHandler } from '#/utils/createHandler';
import { setClipStretchRatio } from '../../useCases/clipStretch/setClipStretchRatio';

export const handleSetClipStretchRatio = createHandler<'setClipStretchRatio'>({
    execute: (action) => {
        setClipStretchRatio(action.payload.clipId, action.payload.ratio);
    },
    describe: (a) => ({ label: `Set clip stretch ratio to ${a.payload.ratio}` }),
    undoable: true,
});
