import { logger } from '#/infra/logger/appLogger';
import { audioToMidi as runAudioToMidiConversion } from '#/modules/AudioAnalysis/useCases';
import { createHandler } from '#/utils/createHandler';
import { notifyUser } from '#/utils/Notification/notifyUser';

export const handleAudioToMidiAiMidi = createHandler<'audioToMidi'>({
    execute: async (a) => {
        try {
            runAudioToMidiConversion({
                clipId: a.payload.clipId,
                trackId: a.payload.trackId ?? '',
                sensitivity: a.payload.sensitivity,
                mode: a.payload.mode === 'pitched' ? 'pitched' : 'rhythm',
            });
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
