import { logger } from '#/infra/logger/appLogger';
import { audioToMidi as runAudioToMidiConversion } from '#/modules/Arrangement/useCases';
import { createHandler } from '#/utils/createHandler';
import { notifyUser } from '#/utils/Notification/notifyUser';

export const handleAudioToMidiAiMidi = createHandler<'audioToMidi'>({
    execute: async (a) => {
        try {
            await runAudioToMidiConversion(a.payload.clipId);
            logger.info(`[Analysis] Audio-to-MIDI mapped for clip ${a.payload.clipId}`);
        } catch (error) {
            logger.warn(`[Audio AI] Audio-to-MIDI conversion failed: ${String(error)}`);
            notifyUser(`Audio-to-MIDI conversion failed: ${String(error)}`, 'error');
            throw error;
        }
    },
    describe: () => ({ label: 'Convert audio to MIDI' }),
    undoable: true,
});
