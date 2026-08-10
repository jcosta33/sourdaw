import { audioBufferCache } from '../stores/audioBufferCache';

export function clearRuntimeCachedAudioBuffers(): void {
    audioBufferCache.clearRuntime();
}
