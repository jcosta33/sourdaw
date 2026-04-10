import { createHandler } from '#/helpers/createHandler';
import { logger } from '#/infra/logger/appLogger';
import { addClip, addTrack, trackStore } from '#/modules/Arrangement';
import { audioBufferCache } from '#/modules/AudioEngine';
import { audioBufferToWav } from './audioBufferToWav';

export const handleStemSeparate = createHandler<'stemSeparate'>({
    execute: async (a) => {
        const { separateStems: doSeparateStems } = await import('#/modules/AudioAnalysis');

        const stems = a.payload.stems ?? ['all'];
        logger.info(`[Audio AI] Separating stems: ${stems.join(', ')} for clip ${a.payload.clipId}`);

        try {
            const state = trackStore.value;
            const track = state?.tracks.find((t) => t.clips.some((c) => c.id === a.payload.clipId));
            if (!track) {
                logger.warn('[Audio AI] Clip not found');
                return;
            }
            const clip = track.clips.find((c) => c.id === a.payload.clipId);
            if (!clip || clip.type !== 'audio' || !clip.audioBufferId) {
                logger.warn('[Audio AI] Clip has no audio buffer');
                return;
            }
            const sourceBuffer = audioBufferCache.get(clip.audioBufferId);
            if (!sourceBuffer) {
                logger.warn('[Audio AI] Audio buffer not found in cache');
                return;
            }

            const wavData = audioBufferToWav(sourceBuffer);

            const stemResults = await doSeparateStems(wavData, stems);

            const durationBeats = clip.endBeat - clip.startBeat;
            for (const [stemName, stemBuffer] of Object.entries(stemResults)) {
                const stemTrack = addTrack({ name: `${clip.name} — ${stemName}`, kind: 'audio' });
                if (!stemTrack) {
                    continue;
                }
                const stemBufferId = crypto.randomUUID();
                audioBufferCache.set(stemBufferId, stemBuffer);
                addClip({
                    trackId: stemTrack.id,
                    startBeat: clip.startBeat,
                    endBeat: clip.startBeat + durationBeats,
                    name: `${stemName}`,
                    type: 'audio',
                    audioBufferId: stemBufferId,
                });
            }

            logger.info(`[Audio AI] Separated into ${String(Object.keys(stemResults).length)} stems`);
        } catch (error) {
            logger.warn(`[Audio AI] Stem separation failed: ${String(error)}`);
        }
    },
    describe: () => ({ label: 'AI: separate stems' }),
    undoable: true,
});
