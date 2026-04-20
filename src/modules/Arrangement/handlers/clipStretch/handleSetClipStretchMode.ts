import { createHandler } from '#/utils/createHandler';

import { setClipStretchMode } from '../../useCases/clipStretch/setClipStretchMode';

export const handleSetClipStretchMode = createHandler<'setClipStretchMode'>({
    execute: (action) => {
        setClipStretchMode(action.payload.clipId, action.payload.mode);
    },
    describe: (a) => ({ label: `Set clip stretch mode to ${a.payload.mode}` }),
    undoable: true,
});
