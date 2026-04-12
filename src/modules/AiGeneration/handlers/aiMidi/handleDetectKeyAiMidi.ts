import { createHandler } from '#/utils/createHandler';
import { logger } from '#/infra/logger/appLogger';
import { detectKey as detectClipKey } from '#/modules/Arrangement/useCases';

export const handleDetectKeyAiMidi = createHandler<'detectKey'>({
    execute: async (a) => {
        const key = await detectClipKey(a.payload.clipId);
        logger.info(`[Analysis] Key detected for clip ${a.payload.clipId}: ${String(key)}`);
    },
    describe: () => ({ label: 'Detect key' }),
    undoable: false,
});
