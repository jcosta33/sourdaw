import { logger } from '#/infra/logger/appLogger';
import { addClip, addTrack, getTrackStoreState, removeTrack } from '#/modules/Arrangement/useCases';
import { isStemSeparationAvailable, separateStems as doSeparateStems } from '#/modules/AudioAnalysis/useCases';
import { cacheAudioBuffer, getCachedAudioBuffer } from '#/modules/AudioEngine/useCases';
import { audioBufferToWav } from '#/modules/AudioRendering/useCases';
import { createHandler } from '#/utils/createHandler';
import { notifyUser } from '#/utils/Notification/notifyUser';

/** Targets `separateStems` accepts. The `stemSeparate` AppAction payload types
 *  `stems` as a bare `string[]` (see `src/utils/handlerContract.ts`), so
 *  this local allow-list is the only runtime guard — garbage like `['voccals']`
 *  is stopped here at the boundary. */
const VALID_STEMS = ['all', 'vocals', 'drums', 'bass', 'other'] as const;
type StemSelection = (typeof VALID_STEMS)[number];

function isValidStem(value: string): value is StemSelection {
    return (VALID_STEMS as readonly string[]).includes(value);
}

export const handleStemSeparate = createHandler<'stemSeparate'>({
    execute: async (alpha) => {
        if (!isStemSeparationAvailable()) {
            const message = 'Stem separation is unavailable until a compatible model is admitted.';
            notifyUser(message, 'error');
            throw new Error(message);
        }

        const requested = alpha.payload.stems ?? ['all'];

        // Validate at the boundary: reject any stem name outside the allow-list
        // rather than forwarding garbage (e.g. ['voccals']) to separateStems.
        const invalid = requested.filter((stem) => !isValidStem(stem));
        if (invalid.length > 0) {
            const message = `Stem separation failed: unknown stem(s) ${invalid.join(', ')}`;
            notifyUser(message, 'error');
            throw new Error(message);
        }
        const stems: StemSelection[] = requested.filter(isValidStem);

        logger.info(`[Audio AI] Separating stems: ${stems.join(', ')} for clip ${alpha.payload.clipId}`);

        const state = getTrackStoreState();
        const track = state?.tracks.find((time) => time.clips.some((context) => context.id === alpha.payload.clipId));
        if (!track) {
            notifyUser('Stem separation failed: clip not found', 'error');
            throw new Error('Clip not found');
        }
        const clip = track.clips.find((context) => context.id === alpha.payload.clipId);
        if (!clip || clip.type !== 'audio' || !clip.audioBufferId) {
            notifyUser('Stem separation failed: clip has no audio buffer', 'error');
            throw new Error('Clip has no audio buffer');
        }
        const sourceBuffer = getCachedAudioBuffer({ bufferId: clip.audioBufferId });
        if (!sourceBuffer) {
            notifyUser('Stem separation failed: audio buffer not found in cache', 'error');
            throw new Error('Audio buffer not found in cache');
        }

        try {
            const wavData = await audioBufferToWav(sourceBuffer);

            const stemResults = await doSeparateStems(wavData, stems);

            const durationBeats = clip.endBeat - clip.startBeat;
            for (const [stemName, stemBuffer] of Object.entries(stemResults)) {
                const stemTrackName = `${clip.name} — ${stemName}`;

                // De-dup: a re-run produces the same deterministic stem-track
                // names, so drop any prior stem track of this name before
                // creating the replacement. Without this, re-running stem
                // separation on the same clip accumulates duplicate tracks.
                const existingStemTracks = (getTrackStoreState()?.tracks ?? []).filter(
                    (existing) => existing.name === stemTrackName
                );
                for (const existing of existingStemTracks) {
                    removeTrack(existing.id);
                }

                const stemTrack = addTrack({ name: stemTrackName, kind: 'audio' });
                if (!stemTrack) {
                    continue;
                }
                const stemBufferId = cacheAudioBuffer({ buffer: stemBuffer });
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
