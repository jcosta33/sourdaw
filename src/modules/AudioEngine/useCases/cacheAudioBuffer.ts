import { audioBufferCache } from '../stores/audioBufferCache';

type CacheAudioBufferInput = {
    buffer: AudioBuffer;
    bufferId?: string;
};

export function cacheAudioBuffer({ buffer, bufferId }: CacheAudioBufferInput): string {
    const buffer_id = bufferId ?? `generated-${crypto.randomUUID()}`;
    audioBufferCache.set(buffer_id, buffer);
    return buffer_id;
}
