import { audioBufferCache } from '../stores/audioBufferCache';

export function clearCachedAudioBuffers(): void {
    audioBufferCache.clear();
}
