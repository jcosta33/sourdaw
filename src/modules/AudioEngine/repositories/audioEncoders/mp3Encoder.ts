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

    for (let i = 0; i < buffer.length; i++) {
        left[i] = Math.max(-32768, Math.min(32767, Math.round(leftFloat[i]! * 32767)));
        right[i] = Math.max(-32768, Math.min(32767, Math.round(rightFloat[i]! * 32767)));
    }

    const chunks: Uint8Array[] = [];
    const BLOCK = 1152;
    let yieldCounter = 0;

    for (let i = 0; i < buffer.length; i += BLOCK) {
        const leftChunk = left.subarray(i, i + BLOCK);
        const rightChunk = numChannels === 2 ? right.subarray(i, i + BLOCK) : undefined;
        const mp3buf = encoder.encodeBuffer(leftChunk, rightChunk);
        if (mp3buf.length > 0) {
            chunks.push(mp3buf);
        }
        yieldCounter++;
        if (yieldCounter % 64 === 0) {
            onProgress?.(i / buffer.length);
            await new Promise<void>((r) => setTimeout(r, 0));
        }
    }

    const tail = encoder.flush();
    if (tail.length > 0) {
        chunks.push(tail);
    }

    const totalLength = chunks.reduce((sum, c) => sum + c.length, 0);
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
