import { audioBufferCache } from '../stores/audioBufferCache';

export function acquireCheckpointAudioRetention(
    input: Parameters<typeof audioBufferCache.acquireCheckpointRetention>[0]
): ReturnType<typeof audioBufferCache.acquireCheckpointRetention> {
    return audioBufferCache.acquireCheckpointRetention(input);
}
