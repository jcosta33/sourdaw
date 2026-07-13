import { type ExportedAudioBuffer, audioBufferCache } from '../stores/audioBufferCache';

type ImportCachedAudioBuffersInput = {
    audioContext: BaseAudioContext;
    buffers: Record<string, ExportedAudioBuffer>;
    shouldContinue?: () => boolean;
};

type ImportCachedAudioBuffersOutput = Promise<number>;

export function importCachedAudioBuffers({
    audioContext,
    buffers,
    shouldContinue,
}: ImportCachedAudioBuffersInput): ImportCachedAudioBuffersOutput {
    return audioBufferCache.importBuffers({ context: audioContext, buffers, shouldContinue });
}
