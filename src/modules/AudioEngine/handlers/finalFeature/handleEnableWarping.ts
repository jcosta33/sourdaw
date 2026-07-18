import { enableWarping } from '#/modules/ElasticAudio/useCases';
import { createHandler } from '#/utils/createHandler';

export const handleEnableWarping = createHandler<'enableWarping'>({
    execute: (alpha) => {
        enableWarping(alpha.payload.clipId);
    },
    describe: () => ({ label: 'Enable Audio Warping' }),
    undoable: true,
});
