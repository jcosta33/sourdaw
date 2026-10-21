import { type ExportAudioSource } from '../../models/ExportAudioSource';
import { type PcmDitherOptions } from '../../repositories/audioEncoders/convertFloatChannelsToPcm';
import { audioBufferToFlac } from '../../repositories/audioEncoders/flacEncoder';
import { audioBufferToWav } from '../../repositories/audioEncoders/wavEncoder';
import { streamExportToBrowser } from '../../repositories/audioExport/streamExportToBrowser';
import { streamExportToNative } from '../../repositories/audioExport/streamExportToNative';
import { audioBufferToMp3 } from '../audioBufferToMp3';
import { normalizeExportBuffer } from '../normalizeExportBuffer';

/** Acquire output storage before rendering; every render then drains into this one staged batch. */
export async function streamExport(input: {
    destination: { kind: 'native'; directoryPath?: string; selectedFilePath?: string } |
        { kind: 'browser'; suggestedName: string; extension: string; mime: string; archive: boolean };
    formats: readonly ('wav' | 'mp3' | 'flac')[];
    bitDepth: 16 | 24 | 32;
    mp3BitRate: number;
    dither: PcmDitherOptions;
    metadata?: Parameters<typeof audioBufferToMp3>[4];
    normalization?: { targetLufs: number; ceilingDbTp: number };
    checkCancelled: () => void;
}) {
    const destination = input.destination.kind === 'native'
        ? await streamExportToNative({ ...input.destination, checkCancelled: input.checkCancelled })
        : await streamExportToBrowser({ ...input.destination, checkCancelled: input.checkCancelled });
    return {
        async writeAudio(options: {
            source: ExportAudioSource;
            name: string;
            onProgress: (format: 'wav' | 'mp3' | 'flac', fraction: number) => void;
            onLimited: () => void;
        }) {
            input.checkCancelled();
            let source = options.source;
            if (input.normalization) {
                const result = normalizeExportBuffer({ buffer: source, ...input.normalization, apply: false });
                source = { length: source.length, numberOfChannels: source.numberOfChannels, sampleRate: source.sampleRate,
                    getChannelData: (channel) => options.source.getChannelData(channel), gain: result.appliedGain };
                if (result.limitedByCeiling) options.onLimited();
            }
            for (const format of input.formats) {
                input.checkCancelled();
                const entry = await destination.beginFile(`${options.name}.${format}`);
                const progress = (fraction: number) => options.onProgress(format, fraction);
                if (format === 'wav') await audioBufferToWav(source, input.bitDepth, progress, input.dither, entry.writer);
                else if (format === 'mp3') await audioBufferToMp3(source, input.mp3BitRate, progress, input.dither, input.metadata, entry.writer);
                else {
                    if (input.bitDepth === 32) throw new Error('FLAC export supports 16-bit or 24-bit only.');
                    await audioBufferToFlac(source, input.bitDepth, progress, input.dither, entry.writer);
                }
                await entry.finish();
            }
        },
        commit: destination.commit,
        abort: destination.abort,
    };
}
