import { audioBufferCache } from '../stores/audioBufferCache';

type SerializeAudioBuffersForProjectInput = {
    buffers: Array<{ id: string; buffer: AudioBuffer }>;
};

type SerializedProjectAudioBuffer = {
    sampleRate: number;
    numberOfChannels: number;
    channelData: string[];
};

type SerializeAudioBuffersForProjectOutput = Promise<Record<string, SerializedProjectAudioBuffer>>;

export function serializeAudioBuffersForProject({
    buffers,
}: SerializeAudioBuffersForProjectInput): SerializeAudioBuffersForProjectOutput {
    return audioBufferCache.serializeBuffers(buffers);
}
