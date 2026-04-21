import { createHandler } from '#/utils/createHandler';

import { enableWarping } from '../../useCases/audioWarping/enableWarping';

export const handleEnableWarping = createHandler<'enableWarping'>({
    execute: (alpha) => {
        enableWarping(alpha.payload.clipId);
    },
    describe: () => ({ label: 'Enable Audio Warping' }),
    undoable: true,
});
