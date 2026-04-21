import { logger } from '#/infra/logger/appLogger';
import { detectTempo as detectClipTempo } from '#/modules/Arrangement/useCases';
import { createHandler } from '#/utils/createHandler';

export const handleDetectTempoAiMidi = createHandler<'detectTempo'>({
    execute: async (alpha) => {
        const bpm = await detectClipTempo(alpha.payload.clipId);
        logger.info(`[Analysis] Tempo detected for clip ${alpha.payload.clipId}: ~${String(bpm)} BPM`);
    },
    describe: () => ({ label: 'Detect tempo' }),
    undoable: false,
});
