import { Mp3Encoder } from '@breezystack/lamejs';

import { type ExportAudioSource, type ExportByteWriter } from '../../models/ExportAudioSource';

import { type PcmDitherOptions } from './convertFloatChannelsToPcm';
import { createPcmBlockReader } from './createPcmBlockReader';

export function audioBufferToMp3(
    buffer: ExportAudioSource,
    bitRate: number,
    onProgress: ((frac: number) => void) | undefined,
    dither: PcmDitherOptions | undefined,
    writer: ExportByteWriter
): Promise<void>;
export function audioBufferToMp3(
    buffer: ExportAudioSource,
    bitRate?: number,
    onProgress?: (frac: number) => void,
    dither?: PcmDitherOptions
): Promise<Uint8Array>;
/** LAME retains its own bounded frame state; no whole-file PCM or packet list on the writer route. */
export async function audioBufferToMp3(
    buffer: ExportAudioSource,
    bitRate = 128,
    onProgress?: (frac: number) => void,
    dither?: PcmDitherOptions,
    writer?: ExportByteWriter
): Promise<Uint8Array | void> {
    const numChannels = Math.min(buffer.numberOfChannels, 2);
    const encoder = new Mp3Encoder(numChannels, buffer.sampleRate, bitRate);
    const pcm = createPcmBlockReader({ source: buffer, bitDepth: 16, dither, channelLimit: 2 });
    const chunks: Uint8Array[] = [];
    const destination = writer ?? {
        write: async (bytes: Uint8Array) => {
            chunks.push(bytes.slice());
        },
    };
    for (let start = 0; start < buffer.length; start += 1152) {
        destination.checkCancelled?.();
        const block = pcm.read(1152);
        const left = Int16Array.from(block.channels[0]!);
        const right = numChannels === 2 ? Int16Array.from(block.channels[1]!) : undefined;
        const packet = encoder.encodeBuffer(left, right);
        if (packet.length > 0) {
            await destination.write(packet);
        }
        onProgress?.((start + block.length) / Math.max(1, buffer.length));
        if ((start + block.length) % (1152 * 64) === 0) {
            await new Promise<void>((resolve) => setTimeout(resolve, 0));
        }
    }
    destination.checkCancelled?.();
    const tail = encoder.flush();
    if (tail.length > 0) {
        await destination.write(tail);
    }
    destination.checkCancelled?.();
    onProgress?.(1);
    if (!writer) {
        const result = new Uint8Array(chunks.reduce((sum, bytes) => sum + bytes.length, 0));
        let offset = 0;
        for (const bytes of chunks) {
            result.set(bytes, offset);
            offset += bytes.length;
        }
        return result;
    }
}
