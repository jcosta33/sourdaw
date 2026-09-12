export type SerializedAudioBuffer = {
    sampleRate: number;
    numberOfChannels: number;
    channelData: Float32Array[];
    sizeInBytes: number;
};

function isFloat32Array(value: unknown): value is Float32Array {
    return Object.prototype.toString.call(value) === '[object Float32Array]';
}

export function isValidSerializedAudioBuffer(value: unknown): value is SerializedAudioBuffer {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        return false;
    }
    const candidate = value as Record<string, unknown>;
    const channelData = candidate.channelData;
    if (!Array.isArray(channelData) || !channelData.every(isFloat32Array)) {
        return false;
    }
    const length = channelData[0]?.length ?? 0;
    const sizeInBytes = channelData.reduce((total, channel) => total + channel.byteLength, 0);
    return (
        typeof candidate.sampleRate === 'number' &&
        Number.isFinite(candidate.sampleRate) &&
        candidate.sampleRate > 0 &&
        typeof candidate.numberOfChannels === 'number' &&
        Number.isInteger(candidate.numberOfChannels) &&
        candidate.numberOfChannels > 0 &&
        length > 0 &&
        channelData.length === candidate.numberOfChannels &&
        channelData.every((channel) => channel.length === length) &&
        candidate.sizeInBytes === sizeInBytes
    );
}
