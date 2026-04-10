import { createHandler } from '#/helpers/createHandler';
import { logger } from '#/infra/logger/appLogger';
import { stripSilence as stripSilenceFromClip } from '#/modules/Arrangement';

export const handleStripSilenceAiMidi = createHandler<'stripSilence'>({
    execute: (a) => {
        stripSilenceFromClip(a.payload.clipId, a.payload.threshold || -40);
        logger.info(`[Analysis] Strip silence executed for clip ${a.payload.clipId}`);
    },
    describe: () => ({ label: 'Strip silence' }),
    undoable: true,
});
