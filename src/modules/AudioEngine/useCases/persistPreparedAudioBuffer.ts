import { audioBufferCache } from '../stores/audioBufferCache';

type PersistPreparedAudioBufferInput = {
    buffer: AudioBuffer;
    bufferId: string;
    leaseId: string;
};

export async function persistPreparedAudioBuffer({ buffer, bufferId, leaseId }: PersistPreparedAudioBufferInput) {
    try {
        return await audioBufferCache.persistPreparedBuffer({ id: bufferId, buffer, leaseId });
    } catch (error) {
        return { status: 'failed' as const, reason: error instanceof Error ? error.message : String(error) };
    }
}
