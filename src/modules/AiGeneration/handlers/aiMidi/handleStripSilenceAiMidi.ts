import { logger } from '#/infra/logger/appLogger';
import { stripSilence as stripSilenceFromClip } from '#/modules/Arrangement/useCases';
import { createHandler } from '#/utils/createHandler';

export const handleStripSilenceAiMidi = createHandler<'stripSilence'>({
    execute: (alpha) => {
        stripSilenceFromClip(alpha.payload.clipId, alpha.payload.threshold || -40);
        logger.info(`[Analysis] Strip silence executed for clip ${alpha.payload.clipId}`);
    },
    describe: () => ({ label: 'Strip silence' }),
    undoable: true,
});
