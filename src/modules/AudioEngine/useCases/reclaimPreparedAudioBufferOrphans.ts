import { reclaimPreparedBufferOrphans } from '../stores/audioBufferCache';

type ReclaimPreparedAudioBufferOrphansInput = {
    createdBeforeMs: number;
    liveLeaseIds: readonly string[];
};

export async function reclaimPreparedAudioBufferOrphans(input: ReclaimPreparedAudioBufferOrphansInput) {
    try {
        return await reclaimPreparedBufferOrphans(input);
    } catch (error) {
        return { status: 'failed' as const, reason: error instanceof Error ? error.message : String(error) };
    }
}
