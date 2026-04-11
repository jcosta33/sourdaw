import { createHandler } from '#/helpers/createHandler';
import { logger } from '#/infra/logger/appLogger';
import { addClip, addTrack } from '#/modules/Arrangement/useCases';
import { audioBufferCache } from '#/modules/AudioEngine/stores';

export const handleGenerateAudioAiMidi = createHandler<'generateAudio'>({
    execute: async (a) => {
        const { generateAudio: genAudio, isAudioGenerationAvailable } = await import('#/modules/AudioAnalysis/useCases');

        if (!isAudioGenerationAvailable()) {
            logger.warn('[Audio AI] Audio generation requires the Sourdaw desktop app');
            return;
        }

        let trackId = a.payload.trackId;
        if (!trackId) {
            const newTrack = addTrack({ name: `AI Audio`, kind: 'audio' });
            trackId = newTrack?.id;
        }
        if (!trackId) {
            return;
        }

        const duration = a.payload.durationSeconds ?? 8;
        logger.info(`[Audio AI] Generating: "${a.payload.prompt}" (${String(duration)}s)`);

        try {
            const audioBuffer = await genAudio(a.payload.prompt, duration);
            logger.info(
                `[Audio AI] Generated ${String(audioBuffer.duration.toFixed(1))}s of audio (${String(audioBuffer.sampleRate)}Hz)`
            );

            const bufferId = crypto.randomUUID();
            audioBufferCache.set(bufferId, audioBuffer);

            const durationBeats = Math.max(1, Math.ceil(audioBuffer.duration * 2));

            const promptLabel = a.payload.prompt.slice(0, 40);
            addClip({
                trackId,
                startBeat: 0,
                endBeat: durationBeats,
                name: `AI: ${promptLabel}`,
                type: 'audio',
                audioBufferId: bufferId,
            });

            logger.info(`[Audio AI] Created clip "${promptLabel}" (${String(durationBeats)} beats) on track ${trackId}`);
        } catch (error) {
            logger.warn(`[Audio AI] Generation failed: ${String(error)}`);
        }
    },
    describe: (a) => ({ label: `AI: generate audio "${a.payload.prompt.slice(0, 30)}"` }),
    undoable: true,
});
