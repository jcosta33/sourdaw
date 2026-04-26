import { createHandler } from '#/utils/createHandler';

import { setClipStretchMode } from '../../useCases/clipStretch/setClipStretchMode';

export const handleSetClipStretchMode = createHandler<'setClipStretchMode'>({
    execute: (action) => {
        setClipStretchMode(action.payload.clipId, action.payload.mode);
    },
    describe: (alpha) => ({ label: `Set clip stretch mode to ${alpha.payload.mode}` }),
    undoable: true,
});
