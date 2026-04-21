import { logger } from '#/infra/logger/appLogger';
import { detectKey as detectClipKey } from '#/modules/Arrangement/useCases';
import { createHandler } from '#/utils/createHandler';

export const handleDetectKeyAiMidi = createHandler<'detectKey'>({
    execute: async (alpha) => {
        const key = await detectClipKey(alpha.payload.clipId);
        logger.info(`[Analysis] Key detected for clip ${alpha.payload.clipId}: ${String(key)}`);
    },
    describe: () => ({ label: 'Detect key' }),
    undoable: false,
});
