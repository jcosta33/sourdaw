import { clearRuntimeAudioBufferCache } from '../stores/audioBufferCache';

type ClearRuntimeCachedAudioBuffersInput = {
    retainedIds?: Iterable<string>;
};

export function clearRuntimeCachedAudioBuffers(input: ClearRuntimeCachedAudioBuffersInput = {}): void {
    clearRuntimeAudioBufferCache(input);
}
