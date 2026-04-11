import { createHandler } from '#/helpers/createHandler';
import { logger } from '#/infra/logger/appLogger';
import { audioToMidi as runAudioToMidiConversion } from '#/modules/Arrangement/useCases';

export const handleAudioToMidiAiMidi = createHandler<'audioToMidi'>({
    execute: async (a) => {
        await runAudioToMidiConversion(a.payload.clipId);
        logger.info(`[Analysis] Audio-to-MIDI mapped for clip ${a.payload.clipId}`);
    },
    describe: () => ({ label: 'Convert audio to MIDI' }),
    undoable: true,
});
