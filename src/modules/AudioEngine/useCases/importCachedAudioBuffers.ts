import { type ExportedAudioBuffer, audioBufferCache } from '../stores/audioBufferCache';

type ImportCachedAudioBuffersInput = {
    audioContext: BaseAudioContext;
    /** Base64 PCM read back out of a `.sourdaw` file. */
    buffers: Record<string, ExportedAudioBuffer>;
    /** Buffers the caller already decoded — no encode/decode round trip. */
    decodedBuffers?: Record<string, AudioBuffer>;
    cacheIds?: string[];
    shouldContinue?: () => boolean;
};

type ImportCachedAudioBuffersOutput = Promise<ReturnType<typeof audioBufferCache.importBuffers>>;

export function importCachedAudioBuffers({
    audioContext,
    buffers,
    decodedBuffers,
    cacheIds,
    shouldContinue,
}: ImportCachedAudioBuffersInput): ImportCachedAudioBuffersOutput {
    return Promise.resolve(
        audioBufferCache.importBuffers({ context: audioContext, buffers, decodedBuffers, cacheIds, shouldContinue })
    );
}
