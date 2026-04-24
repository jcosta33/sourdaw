import { createHandler } from '#/utils/createHandler';

import { setClipStretchRatio } from '../../useCases/clipStretch/setClipStretchRatio';

export const handleSetClipStretchRatio = createHandler<'setClipStretchRatio'>({
    execute: (action) => {
        setClipStretchRatio(action.payload.clipId, action.payload.ratio);
    },
    describe: (alpha) => ({ label: `Set clip stretch ratio to ${alpha.payload.ratio}` }),
    undoable: true,
});
