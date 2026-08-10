import { audioBufferCache } from '../stores/audioBufferCache';

type CacheAudioBufferInput = {
    buffer: AudioBuffer;
    bufferId?: string;
    freezeProjectId?: number;
};

export function cacheAudioBuffer({ buffer, bufferId, freezeProjectId }: CacheAudioBufferInput): string {
    const buffer_id = bufferId ?? `generated-${crypto.randomUUID()}`;
    if (freezeProjectId === undefined) {
        audioBufferCache.set(buffer_id, buffer);
        return buffer_id;
    }
    audioBufferCache.set(buffer_id, buffer, { freezeProjectId });
    return buffer_id;
}
