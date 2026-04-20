import { logger } from '#/infra/logger/appLogger';
import { detectTempo as detectClipTempo } from '#/modules/Arrangement/useCases';
import { createHandler } from '#/utils/createHandler';

export const handleDetectTempoAiMidi = createHandler<'detectTempo'>({
    execute: async (a) => {
        const bpm = await detectClipTempo(a.payload.clipId);
        logger.info(`[Analysis] Tempo detected for clip ${a.payload.clipId}: ~${String(bpm)} BPM`);
    },
    describe: () => ({ label: 'Detect tempo' }),
    undoable: false,
});
