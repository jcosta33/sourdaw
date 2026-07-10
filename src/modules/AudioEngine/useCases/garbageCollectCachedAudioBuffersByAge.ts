import { audioBufferCache } from '../stores/audioBufferCache';

type GarbageCollectCachedAudioBuffersByAgeInput = {
    maxAgeDays: number;
};

type GarbageCollectCachedAudioBuffersByAgeOutput = Promise<number>;

export function garbageCollectCachedAudioBuffersByAge({
    maxAgeDays,
}: GarbageCollectCachedAudioBuffersByAgeInput): GarbageCollectCachedAudioBuffersByAgeOutput {
    return audioBufferCache.garbageCollectByAge(maxAgeDays);
}
