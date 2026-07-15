import { type ExportedAudioBuffer, audioBufferCache } from '../stores/audioBufferCache';

type ImportCachedAudioBuffersInput = {
    audioContext: BaseAudioContext;
    buffers: Record<string, ExportedAudioBuffer>;
    cacheIds?: string[];
    shouldContinue?: () => boolean;
};

type ImportCachedAudioBuffersOutput = Promise<ReturnType<typeof audioBufferCache.importBuffers>>;

export function importCachedAudioBuffers({
    audioContext,
    buffers,
    cacheIds,
    shouldContinue,
}: ImportCachedAudioBuffersInput): ImportCachedAudioBuffersOutput {
    return Promise.resolve(
        audioBufferCache.importBuffers({ context: audioContext, buffers, cacheIds, shouldContinue })
    );
}
