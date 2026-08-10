import { audioBufferCache } from '../stores/audioBufferCache';

type ClearRuntimeCachedAudioBuffersInput = {
    retainedIds?: Iterable<string>;
};

export function clearRuntimeCachedAudioBuffers(input: ClearRuntimeCachedAudioBuffersInput = {}): void {
    audioBufferCache.clearRuntime(input);
}
