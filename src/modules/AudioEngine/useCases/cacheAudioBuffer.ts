import { audioBufferCache } from '../stores/audioBufferCache';

type CacheAudioBufferInput = {
    buffer: AudioBuffer;
};

export function cacheAudioBuffer({ buffer }: CacheAudioBufferInput): string {
    const buffer_id = `generated-${crypto.randomUUID()}`;
    audioBufferCache.set(buffer_id, buffer);
    return buffer_id;
}
