import { audioBufferCache } from '../stores/audioBufferCache';

type GarbageCollectCachedAudioBuffersBySizeInput = {
    maxSizeBytes: number;
};

type GarbageCollectCachedAudioBuffersBySizeOutput = Promise<number>;

export function garbageCollectCachedAudioBuffersBySize({
    maxSizeBytes,
}: GarbageCollectCachedAudioBuffersBySizeInput): GarbageCollectCachedAudioBuffersBySizeOutput {
    return audioBufferCache.garbageCollectBySize(maxSizeBytes);
}
