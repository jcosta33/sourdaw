import { audioBufferCache } from '../stores/audioBufferCache';
import { openAudioBufferResidencyHold } from '../stores/audioBufferResidencyHolds';

type RestoreUnpinnedAudioBuffersFromIdbInput = {
    bufferIds: readonly string[];
};

type RestoreUnpinnedAudioBuffersFromIdbOutput = {
    /** Ids storage holds no record for and this session never stored. */
    absentIds: readonly string[];
    release: () => void;
};

/**
 * Make buffers resident from the PCM storage holds for them, stored this
 * session or an earlier one, for a caller about to play them outside a
 * project load. The pinned set and project reservations stay as they are, and
 * no record is rewritten. Every named id is held until the returned release
 * runs. Only an id reported absent may be cached anew without overwriting
 * stored audio.
 */
export async function restoreUnpinnedAudioBuffersFromIdb({
    bufferIds,
}: RestoreUnpinnedAudioBuffersFromIdbInput): Promise<RestoreUnpinnedAudioBuffersFromIdbOutput> {
    const hold = openAudioBufferResidencyHold();
    for (const id of bufferIds) {
        hold.retain(id);
    }
    try {
        const { absent } = await audioBufferCache.restoreUnpinned(bufferIds);
        return { absentIds: absent, release: hold.release };
    } catch (error) {
        hold.release();
        throw error;
    }
}
