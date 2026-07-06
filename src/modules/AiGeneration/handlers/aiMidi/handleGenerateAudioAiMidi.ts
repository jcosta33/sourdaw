import { logger } from '#/infra/logger/appLogger';
import { addClip, addTrack } from '#/modules/Arrangement/useCases';
import { generateAudio as genAudio } from '#/modules/AudioAnalysis/useCases';
import { cacheAudioBuffer } from '#/modules/AudioEngine/useCases';
import { getTransportState } from '#/modules/Transport/useCases';
import { createHandler } from '#/utils/createHandler';
import { notifyUser } from '#/utils/Notification/notifyUser';

import {
    AUDIO_GENERATION_UNAVAILABLE_MESSAGE,
    ensureAudioGenerationAvailable,
} from '../../useCases/actions/ensureAudioGenerationAvailable';

export const handleGenerateAudioAiMidi = createHandler<'generateAudio'>({
    execute: async (alpha) => {
        try {
            ensureAudioGenerationAvailable();
        } catch (error) {
            notifyUser(AUDIO_GENERATION_UNAVAILABLE_MESSAGE, 'warning');
            throw error;
        }

        let trackId = alpha.payload.trackId;
        if (!trackId) {
            const newTrack = addTrack({ name: `AI Audio`, kind: 'audio' });
            trackId = newTrack?.id;
        }
        if (!trackId) {
            notifyUser('Audio generation failed: could not create track', 'error');
            throw new Error('Could not create track for audio generation');
        }

        const duration = alpha.payload.durationSeconds ?? 8;
        logger.info(`[Audio AI] Generating: "${alpha.payload.prompt}" (${String(duration)}s)`);

        try {
            const audioBuffer = await genAudio(alpha.payload.prompt, duration);
            logger.info(
                `[Audio AI] Generated ${String(audioBuffer.duration.toFixed(1))}s of audio (${String(audioBuffer.sampleRate)}Hz)`
            );

            const bufferId = cacheAudioBuffer({ buffer: audioBuffer });

            // Convert the rendered audio's real-time duration into beats using the
            // project tempo (beats = seconds * BPM / 60) rather than assuming
            // 120 BPM. Place the clip at the transport playhead so the generated
            // audio lands where the user is working instead of always at beat 0.
            const transport = getTransportState();
            const tempo = transport?.tempo ?? 120;
            const startBeat = transport?.playheadPosition ?? 0;
            const durationBeats = Math.max(1, Math.ceil((audioBuffer.duration * tempo) / 60));

            const promptLabel = alpha.payload.prompt.slice(0, 40);
            addClip({
                trackId,
                startBeat,
                endBeat: startBeat + durationBeats,
                name: `AI: ${promptLabel}`,
                type: 'audio',
                audioBufferId: bufferId,
            });

            logger.info(
                `[Audio AI] Created clip "${promptLabel}" (${String(durationBeats)} beats at beat ${String(startBeat)}) on track ${trackId}`
            );
        } catch (error) {
            logger.warn(`[Audio AI] Generation failed: ${String(error)}`);
            notifyUser(`Audio generation failed: ${String(error)}`, 'error');
            throw error;
        }
    },
    describe: (alpha) => ({ label: `AI: generate audio "${alpha.payload.prompt.slice(0, 30)}"` }),
    undoable: true,
});
