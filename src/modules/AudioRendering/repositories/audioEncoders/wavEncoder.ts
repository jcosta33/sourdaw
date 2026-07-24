import { convertFloatChannelsToPcm, type PcmDitherOptions } from './convertFloatChannelsToPcm';

export async function audioBufferToWav(
    buffer: AudioBuffer,
    bitDepth: 16 | 24 | 32 = 16,
    onProgress?: (frac: number) => void,
    dither?: PcmDitherOptions
): Promise<ArrayBuffer> {
    const numChannels = buffer.numberOfChannels;
    const sampleRate = buffer.sampleRate;
    const isFloat = bitDepth === 32;
    const bitsPerSample = bitDepth;
    const bytesPerSample = bitsPerSample / 8;
    const blockAlign = numChannels * bytesPerSample;
    const dataLength = buffer.length * blockAlign;
    const fmtSize = isFloat ? 18 : 16;
    const headerLength = 20 + fmtSize + 8;
    const totalLength = headerLength + dataLength;

    const arrayBuffer = new ArrayBuffer(totalLength);
    const view = new DataView(arrayBuffer);

    function writeString(offset: number, str: string) {
        for (let index = 0; index < str.length; index++) {
            view.setUint8(offset + index, str.charCodeAt(index));
        }
    }

    writeString(0, 'RIFF');
    view.setUint32(4, totalLength - 8, true);
    writeString(8, 'WAVE');
    writeString(12, 'fmt ');
    view.setUint32(16, fmtSize, true);
    view.setUint16(20, isFloat ? 3 : 1, true);
    view.setUint16(22, numChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * blockAlign, true);
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, bitsPerSample, true);
    if (isFloat) {
        view.setUint16(36, 0, true);
    }

    const dataOffset = 12 + 8 + fmtSize;
    writeString(dataOffset, 'data');
    view.setUint32(dataOffset + 4, dataLength, true);

    const channels: Float32Array[] = [];
    for (let ch = 0; ch < numChannels; ch++) {
        channels.push(buffer.getChannelData(ch));
    }

    // Gain/normalization, TPDF dither on bit-depth reduction, and quantization
    // all live in the shared stage, so WAV, FLAC and MP3 deliver the same level
    // and the same quantization treatment (OE-1).
    const pcm = convertFloatChannelsToPcm({ channels, length: buffer.length, bitDepth, dither });
    const pcmChannels: readonly (Int32Array | Float32Array)[] = pcm.channels;

    const YIELD_INTERVAL = 32768;
    const totalSamples = buffer.length * numChannels || 1;
    let processed = 0;

    // Channel-outer / sample-inner: each channel's array is read sequentially
    // (cache-friendly) rather than striding across N separate channel arrays
    // every frame. Writes stride by blockAlign back into the same interleaved
    // layout, so the emitted bytes are identical.
    for (let ch = 0; ch < numChannels; ch++) {
        const data = pcmChannels[ch]!;
        let offset = dataOffset + 8 + ch * bytesPerSample;
        for (let index = 0; index < buffer.length; index++) {
            const value = data[index]!;
            if (bitDepth === 16) {
                view.setInt16(offset, value, true);
            } else if (bitDepth === 24) {
                view.setUint8(offset, value & 0xff);
                view.setUint8(offset + 1, (value >> 8) & 0xff);
                view.setUint8(offset + 2, (value >> 16) & 0xff);
            } else {
                view.setFloat32(offset, value, true);
            }
            offset += blockAlign;

            processed++;
            if (processed % YIELD_INTERVAL === 0) {
                onProgress?.(processed / totalSamples);
                await new Promise<void>((resolve) => setTimeout(resolve, 0));
            }
        }
    }

    onProgress?.(1);
    return arrayBuffer;
}
