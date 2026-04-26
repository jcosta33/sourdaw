import { logger } from '#/infra/logger/appLogger';
import { audioToMidi as runAudioToMidiConversion } from '#/modules/AudioAnalysis/useCases';
import { createHandler } from '#/utils/createHandler';
import { notifyUser } from '#/utils/Notification/notifyUser';

export const handleAudioToMidiAiMidi = createHandler<'audioToMidi'>({
    execute: async (alpha) => {
        try {
            runAudioToMidiConversion({
                clipId: alpha.payload.clipId,
                trackId: alpha.payload.trackId ?? '',
                sensitivity: alpha.payload.sensitivity,
                mode: alpha.payload.mode === 'pitched' ? 'pitched' : 'rhythm',
            });
            logger.info(`[Analysis] Audio-to-MIDI mapped for clip ${alpha.payload.clipId}`);
        } catch (error) {
            logger.warn(`[Audio AI] Audio-to-MIDI conversion failed: ${String(error)}`);
            notifyUser(`Audio-to-MIDI conversion failed: ${String(error)}`, 'error');
            throw error;
        }
    },
    describe: () => ({ label: 'Convert audio to MIDI' }),
    undoable: true,
});
