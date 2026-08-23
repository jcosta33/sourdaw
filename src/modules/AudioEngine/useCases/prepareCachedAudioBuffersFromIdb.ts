import { audioBufferCache } from '../stores/audioBufferCache';

type PrepareCachedAudioBuffersFromIdbInput = {
    audioContext: Pick<BaseAudioContext, 'createBuffer'>;
    bufferIds?: string[];
    shouldContinue?: () => boolean;
};

type PrepareCachedAudioBuffersFromIdbOutput = Promise<{
    cancel: () => void;
    publish: () => number;
} | null>;

export function prepareCachedAudioBuffersFromIdb({
    audioContext,
    bufferIds,
    shouldContinue,
}: PrepareCachedAudioBuffersFromIdbInput): PrepareCachedAudioBuffersFromIdbOutput {
    return audioBufferCache.prepareFromIdb({
        context: audioContext,
        ids: bufferIds,
        shouldContinue,
    });
}
