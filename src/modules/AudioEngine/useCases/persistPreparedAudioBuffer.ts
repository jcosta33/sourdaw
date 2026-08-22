import { audioBufferCache } from '../stores/audioBufferCache';

type PersistPreparedAudioBufferInput = {
    buffer: AudioBuffer;
    bufferId: string;
};

export async function persistPreparedAudioBuffer({ buffer, bufferId }: PersistPreparedAudioBufferInput) {
    try {
        return await audioBufferCache.persistPreparedBuffer({ id: bufferId, buffer });
    } catch (error) {
        return { status: 'failed' as const, reason: error instanceof Error ? error.message : String(error) };
    }
}
