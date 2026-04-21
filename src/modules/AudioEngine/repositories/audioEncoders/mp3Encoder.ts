import { Mp3Encoder } from '@breezystack/lamejs';

type LameEncoder = {
    encodeBuffer(left: Int16Array, right?: Int16Array): Uint8Array;
    flush(): Uint8Array;
};

async function encodePcmToMp3(
    buffer: AudioBuffer,
    encoder: LameEncoder,
    onProgress?: (frac: number) => void
): Promise<Uint8Array> {
    const numChannels = Math.min(buffer.numberOfChannels, 2);
    const left = new Int16Array(buffer.length);
    const right = numChannels === 2 ? new Int16Array(buffer.length) : left;

    const leftFloat = buffer.getChannelData(0);
    const rightFloat = numChannels === 2 ? buffer.getChannelData(1) : leftFloat;

    for (let index = 0; index < buffer.length; index++) {
        left[index] = Math.max(-32768, Math.min(32767, Math.round(leftFloat[index]! * 32767)));
        right[index] = Math.max(-32768, Math.min(32767, Math.round(rightFloat[index]! * 32767)));
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
            await new Promise<void>((r) => setTimeout(r, 0));
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
    onProgress?: (frac: number) => void
): Promise<Uint8Array> {
    const numChannels = Math.min(buffer.numberOfChannels, 2);
    const encoder = new Mp3Encoder(numChannels, buffer.sampleRate, bitRate);
    return await encodePcmToMp3(buffer, encoder, onProgress);
}
