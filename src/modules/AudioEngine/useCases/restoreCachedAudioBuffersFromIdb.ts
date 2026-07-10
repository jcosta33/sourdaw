import { audioBufferCache } from '../stores/audioBufferCache';

type RestoreCachedAudioBuffersFromIdbInput = {
    audioContext: BaseAudioContext;
    bufferIds?: string[];
};

type RestoreCachedAudioBuffersFromIdbOutput = Promise<number>;

export function restoreCachedAudioBuffersFromIdb({
    audioContext,
    bufferIds,
}: RestoreCachedAudioBuffersFromIdbInput): RestoreCachedAudioBuffersFromIdbOutput {
    return audioBufferCache.restoreFromIdb(audioContext, bufferIds);
}
