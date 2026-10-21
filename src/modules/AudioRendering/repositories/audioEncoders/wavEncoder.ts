import { type ExportAudioSource, type ExportByteWriter } from '../../models/ExportAudioSource';

import { type PcmDitherOptions } from './convertFloatChannelsToPcm';
import { createPcmBlockReader } from './createPcmBlockReader';

export function audioBufferToWav(buffer: ExportAudioSource, bitDepth?: 16 | 24 | 32, onProgress?: (frac: number) => void, dither?: PcmDitherOptions): Promise<ArrayBuffer>;
export function audioBufferToWav(buffer: ExportAudioSource, bitDepth: 16 | 24 | 32, onProgress: ((frac: number) => void) | undefined, dither: PcmDitherOptions | undefined, writer: ExportByteWriter): Promise<void>;
/** The product writer awaits every bounded PCM block; legacy callers may still collect one file. */
export async function audioBufferToWav(
    buffer: ExportAudioSource, bitDepth: 16 | 24 | 32 = 16, onProgress?: (frac: number) => void,
    dither?: PcmDitherOptions, writer?: ExportByteWriter
): Promise<ArrayBuffer | void> {
    const numChannels = buffer.numberOfChannels;
    const sampleRate = buffer.sampleRate;
    const isFloat = bitDepth === 32;
    const bytesPerSample = bitDepth / 8;
    const blockAlign = numChannels * bytesPerSample;
    const dataLength = buffer.length * blockAlign;
    const fmtSize = isFloat ? 18 : 16;
    const headerLength = 28 + fmtSize;
    const totalLength = headerLength + dataLength;
    if (![16, 24, 32].includes(bitDepth) || !Number.isSafeInteger(buffer.length) || buffer.length < 0 ||
        !Number.isInteger(numChannels) || numChannels < 1 || blockAlign > 0xffff ||
        !Number.isInteger(sampleRate) || sampleRate <= 0 || sampleRate * blockAlign > 0xffffffff ||
        !Number.isSafeInteger(totalLength) || totalLength - 8 > 0xffffffff) {
        throw new Error('WAV export exceeds RIFF32 limits or has invalid PCM settings.');
    }
    const chunks: Uint8Array[] = [];
    const destination = writer ?? { write: async (bytes: Uint8Array) => { chunks.push(bytes); } };
    destination.checkCancelled?.();
    const header = new Uint8Array(headerLength);
    const view = new DataView(header.buffer);
    const text = (offset: number, value: string) => header.set(new TextEncoder().encode(value), offset);
    text(0, 'RIFF'); view.setUint32(4, totalLength - 8, true); text(8, 'WAVE'); text(12, 'fmt ');
    view.setUint32(16, fmtSize, true); view.setUint16(20, isFloat ? 3 : 1, true);
    view.setUint16(22, numChannels, true); view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * blockAlign, true); view.setUint16(32, blockAlign, true);
    view.setUint16(34, bitDepth, true);
    text(20 + fmtSize, 'data'); view.setUint32(24 + fmtSize, dataLength, true);
    const pcm = createPcmBlockReader({ source: buffer, bitDepth, dither });
    await destination.write(header);
    for (let start = 0; start < buffer.length; start += 4096) {
        destination.checkCancelled?.();
        const block = pcm.read(4096);
        const bytes = new Uint8Array(block.length * blockAlign);
        const blockView = new DataView(bytes.buffer);
        let offset = 0;
        for (let frame = 0; frame < block.length; frame++) {
            for (const channel of block.channels) {
                const value = channel[frame]!;
                if (bitDepth === 16) blockView.setInt16(offset, value, true);
                else if (bitDepth === 24) {
                    bytes[offset] = value & 0xff; bytes[offset + 1] = (value >> 8) & 0xff;
                    bytes[offset + 2] = (value >> 16) & 0xff;
                } else blockView.setFloat32(offset, value, true);
                offset += bytesPerSample;
            }
        }
        await destination.write(bytes);
        onProgress?.((start + block.length) / Math.max(1, buffer.length));
        if ((start + block.length) % 32768 === 0) await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
    destination.checkCancelled?.();
    onProgress?.(1);
    if (!writer) {
        const result = new Uint8Array(totalLength);
        let offset = 0;
        for (const bytes of chunks) { result.set(bytes, offset); offset += bytes.length; }
        return result.buffer;
    }
}
