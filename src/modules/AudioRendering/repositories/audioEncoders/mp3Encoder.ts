import { Mp3Encoder } from '@breezystack/lamejs';

import { convertFloatChannelsToPcm, type PcmDitherOptions } from './convertFloatChannelsToPcm';

type LameEncoder = {
    encodeBuffer(left: Int16Array, right?: Int16Array): Uint8Array;
    flush(): Uint8Array;
};

async function encodePcmToMp3(
    buffer: AudioBuffer,
    encoder: LameEncoder,
    onProgress?: (frac: number) => void,
    dither?: PcmDitherOptions
): Promise<Uint8Array> {
    const numChannels = Math.min(buffer.numberOfChannels, 2);
    const left = new Int16Array(buffer.length);
    const right = numChannels === 2 ? new Int16Array(buffer.length) : left;

    const floatChannels: Float32Array[] = [];
    for (let ch = 0; ch < numChannels; ch++) {
        floatChannels.push(buffer.getChannelData(ch));
    }

    // lame takes 16-bit PCM, so MP3 is a bit-depth reduction like any other and
    // goes through the shared gain/dither/quantize stage (OE-1) rather than the
    // hard clamp it used to apply on its own.
    const pcm = convertFloatChannelsToPcm({ channels: floatChannels, length: buffer.length, bitDepth: 16, dither });
    const leftPcm = pcm.channels[0]!;
    const rightPcm = numChannels === 2 ? pcm.channels[1]! : leftPcm;

    for (let index = 0; index < buffer.length; index++) {
        left[index] = leftPcm[index]!;
        right[index] = rightPcm[index]!;
    }

    const chunks: Uint8Array[] = [];
    const BLOCK = 1152;
    let yieldCounter = 0;

    for (let index = 0; index < buffer.length; index += BLOCK) {
        const leftChunk = left.subarray(index, index + BLOCK);
        const rightChunk = numChannels === 2 ? right.subarray(index, index + BLOCK) : undefined;
        const mp3buf = encoder.encodeBuffer(leftChunk, rightChunk);
        if (mp3buf.length > 0) {
            chunks.push(mp3buf);
        }
        yieldCounter++;
        if (yieldCounter % 64 === 0) {
            onProgress?.(index / buffer.length);
            await new Promise<void>((resolve) => setTimeout(resolve, 0));
        }
    }

    const tail = encoder.flush();
    if (tail.length > 0) {
        chunks.push(tail);
    }

    const totalLength = chunks.reduce((sum, context) => sum + context.length, 0);
    const result = new Uint8Array(totalLength);
    let offset = 0;
    for (const chunk of chunks) {
        result.set(chunk, offset);
        offset += chunk.length;
    }

    onProgress?.(1);
    return result;
}

export async function audioBufferToMp3(
    buffer: AudioBuffer,
    bitRate = 128,
    onProgress?: (frac: number) => void,
    dither?: PcmDitherOptions
): Promise<Uint8Array> {
    const numChannels = Math.min(buffer.numberOfChannels, 2);
    const encoder = new Mp3Encoder(numChannels, buffer.sampleRate, bitRate);
    return await encodePcmToMp3(buffer, encoder, onProgress, dither);
}
