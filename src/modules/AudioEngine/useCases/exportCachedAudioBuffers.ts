import { audioBufferCache } from '../stores/audioBufferCache';

type ExportCachedAudioBuffersInput = {
    bufferIds: string[];
};

type ExportCachedAudioBuffer = {
    sampleRate: number;
    numberOfChannels: number;
    channelData: string[];
};

type ExportCachedAudioBuffersOutput = Promise<Record<string, ExportCachedAudioBuffer>>;

export function exportCachedAudioBuffers({ bufferIds }: ExportCachedAudioBuffersInput): ExportCachedAudioBuffersOutput {
    return audioBufferCache.exportBuffers(bufferIds);
}
