import { createHandler } from '#/utils/createHandler';
import { logger } from '#/infra/logger/appLogger';
import { notifyUser } from '#/utils/Notification/notifyUser';
import { addClip, addTrack } from '#/modules/Arrangement/useCases';
import { trackStore } from '#/modules/Arrangement/stores';
import { audioBufferCache } from '#/modules/AudioEngine/stores';
import { audioBufferToWav } from './audioBufferToWav';

export const handleStemSeparate = createHandler<'stemSeparate'>({
    execute: async (a) => {
        const { separateStems: doSeparateStems } = await import('#/modules/AudioAnalysis/useCases');

        const stems = a.payload.stems ?? ['all'];
        logger.info(`[Audio AI] Separating stems: ${stems.join(', ')} for clip ${a.payload.clipId}`);

        try {
            const state = trackStore.value;
            const track = state?.tracks.find((t) => t.clips.some((c) => c.id === a.payload.clipId));
            if (!track) {
                notifyUser('Stem separation failed: clip not found', 'error');
                throw new Error('Clip not found');
            }
            const clip = track.clips.find((c) => c.id === a.payload.clipId);
            if (!clip || clip.type !== 'audio' || !clip.audioBufferId) {
                notifyUser('Stem separation failed: clip has no audio buffer', 'error');
                throw new Error('Clip has no audio buffer');
            }
            const sourceBuffer = audioBufferCache.get(clip.audioBufferId);
            if (!sourceBuffer) {
                notifyUser('Stem separation failed: audio buffer not found in cache', 'error');
                throw new Error('Audio buffer not found in cache');
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
            notifyUser(`Stem separation failed: ${String(error)}`, 'error');
            throw error;
        }
    },
    describe: () => ({ label: 'AI: separate stems' }),
    undoable: true,
});
