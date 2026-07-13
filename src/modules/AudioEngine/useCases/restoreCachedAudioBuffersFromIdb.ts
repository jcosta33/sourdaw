import { audioBufferCache } from '../stores/audioBufferCache';

type RestoreCachedAudioBuffersFromIdbInput = {
    audioContext: BaseAudioContext;
    bufferIds?: string[];
    shouldContinue?: () => boolean;
};

type RestoreCachedAudioBuffersFromIdbOutput = Promise<number>;

export function restoreCachedAudioBuffersFromIdb({
    audioContext,
    bufferIds,
    shouldContinue,
}: RestoreCachedAudioBuffersFromIdbInput): RestoreCachedAudioBuffersFromIdbOutput {
    return audioBufferCache.restoreFromIdb({ context: audioContext, ids: bufferIds, shouldContinue });
}
