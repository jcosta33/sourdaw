import { audioBufferCache } from '../stores/audioBufferCache';
import { openAudioBufferResidencyHold } from '../stores/audioBufferResidencyHolds';

type RestoreUnpinnedAudioBuffersFromIdbInput = {
    bufferIds: readonly string[];
    isCurrent?: () => boolean;
};

type RestoreUnpinnedAudioBuffersFromIdbOutput = {
    /** Ids storage holds no record for and this session holds no PCM for. */
    absentIds: readonly string[];
    /** Ids that were not resident when this restoration began. */
    initiallyUncachedIds: readonly string[];
    /** The exact PCM objects this restoration made resident. */
    restoredBuffers: ReadonlyMap<string, AudioBuffer>;
    release: () => void;
};

/**
 * Make buffers resident from the PCM storage holds for them, stored this
 * session or an earlier one, or from the PCM a write of this session that has
 * not landed still holds, for a caller about to play them outside a project
 * load. The pinned set and project reservations stay as they are, and
 * no record is rewritten. Every named id is held until the returned release
 * runs. Only an id reported absent may be cached anew without overwriting
 * stored audio.
 */
export async function restoreUnpinnedAudioBuffersFromIdb({
    bufferIds,
    isCurrent,
}: RestoreUnpinnedAudioBuffersFromIdbInput): Promise<RestoreUnpinnedAudioBuffersFromIdbOutput> {
    const hold = openAudioBufferResidencyHold();
    for (const id of bufferIds) {
        hold.retain(id);
    }
    try {
        const { absent, initiallyUncached, restored } = await audioBufferCache.restoreUnpinned(bufferIds, isCurrent);
        return {
            absentIds: absent,
            initiallyUncachedIds: initiallyUncached,
            restoredBuffers: restored,
            release: hold.release,
        };
    } catch (error) {
        hold.release();
        throw error;
    }
}
