import { type ExportAudioSource } from '../../models/ExportAudioSource';

/** Readonly borrowed PCM until the awaited consumer finishes; callers never rewrite these views. */
export function readExportPcmBlock(input: {
    source: ExportAudioSource;
    start: number;
    length: number;
}): readonly Float32Array[] {
    const { source, start, length } = input;
    if (
        !Number.isSafeInteger(source.length) ||
        source.length < 0 ||
        !Number.isSafeInteger(start) ||
        start < 0 ||
        !Number.isSafeInteger(length) ||
        length < 0 ||
        start + length > source.length ||
        !Number.isSafeInteger(source.numberOfChannels) ||
        source.numberOfChannels < 1
    ) {
        throw new Error('Invalid export PCM window.');
    }
    const readChannels = source.readChannels;
    const getChannelData = source.getChannelData;
    if (!readChannels && !getChannelData) {
        throw new Error('Export PCM reader is unavailable.');
    }
    let channels: readonly Float32Array[];
    if (readChannels) {
        channels = readChannels.call(source, start, length);
    } else {
        channels = Array.from({ length: source.numberOfChannels }, (_, channel) => {
            if (!getChannelData) {
                throw new Error('Export PCM reader is unavailable.');
            }
            return getChannelData.call(source, channel).subarray(start, start + length);
        });
    }
    if (channels.length !== source.numberOfChannels || channels.some((channel) => channel.length !== length)) {
        throw new Error('Invalid export PCM block.');
    }
    return channels;
}
