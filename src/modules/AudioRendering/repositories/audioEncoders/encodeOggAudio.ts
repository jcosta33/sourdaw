import { type ExportAudioSource, type ExportByteWriter } from '../../models/ExportAudioSource';
import { OGG_CODEC_BLOCK_FRAMES } from '../../models/OggCodecWorkerProtocol';

import { createOggCodecWorker } from './createOggCodecWorker';
import { createPcmBlockReader } from './createPcmBlockReader';

/** Float PCM uses the existing whole-window gain/clip law without quantization or dither. */
export async function encodeOggAudio(input: {
    codec: 'ogg' | 'opus';
    source: ExportAudioSource;
    writer: ExportByteWriter;
    onProgress?: (fraction: number) => void;
    signal?: AbortSignal;
}) {
    const { source, writer, signal } = input;
    if (signal?.aborted) {
        throw new Error('Export cancelled');
    }
    writer.checkCancelled?.();
    if (source.numberOfChannels !== 1 && source.numberOfChannels !== 2) {
        throw new Error('Ogg export requires mono or stereo PCM');
    }
    if (input.codec === 'opus' && source.sampleRate !== 48000) {
        throw new Error('Opus requires prepared 48 kHz PCM');
    }
    const pcm = createPcmBlockReader({ source, bitDepth: 32, dither: { mode: 'none' } });
    const encoder = await createOggCodecWorker({
        codec: input.codec,
        sampleRate: source.sampleRate,
        channels: source.numberOfChannels,
        writer,
        signal,
    });
    try {
        for (let start = 0; start < source.length; start += OGG_CODEC_BLOCK_FRAMES) {
            writer.checkCancelled?.();
            const block = pcm.read(OGG_CODEC_BLOCK_FRAMES);
            const channels = block.channels.map((channel) => {
                if (!(channel instanceof Float32Array)) {
                    throw new Error('Ogg requires float PCM');
                }
                return channel;
            });
            await encoder.encode(channels);
            input.onProgress?.((start + block.length) / Math.max(1, source.length));
        }
        writer.checkCancelled?.();
        await encoder.flush();
        writer.checkCancelled?.();
        input.onProgress?.(1);
    } finally {
        encoder.close();
    }
}
