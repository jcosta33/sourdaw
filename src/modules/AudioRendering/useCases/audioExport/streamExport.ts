import { type ExportAudioSource } from '../../models/ExportAudioSource';
import { type PcmDitherOptions } from '../../repositories/audioEncoders/convertFloatChannelsToPcm';
import { audioBufferToFlac } from '../../repositories/audioEncoders/flacEncoder';
import { audioBufferToOpus } from '../../repositories/audioEncoders/opusEncoder';
import { audioBufferToVorbis } from '../../repositories/audioEncoders/vorbisEncoder';
import { audioBufferToWav } from '../../repositories/audioEncoders/wavEncoder';
import { streamExportToBrowser } from '../../repositories/audioExport/streamExportToBrowser';
import { streamExportToNative } from '../../repositories/audioExport/streamExportToNative';
import { audioBufferToMp3 } from '../audioBufferToMp3';

import { prepareDeliveryTarget } from './prepareDeliveryTarget';

function awaitExportOperation<TValue>(operation: Promise<TValue>, signal?: AbortSignal): Promise<TValue> {
    if (!signal) {
        return operation;
    }
    if (signal.aborted) {
        return Promise.reject(new Error('Export cancelled'));
    }

    return new Promise<TValue>((resolve, reject) => {
        const onAbort = () => {
            signal.removeEventListener('abort', onAbort);
            reject(new Error('Export cancelled'));
        };
        signal.addEventListener('abort', onAbort, { once: true });
        operation.then(
            (value) => {
                signal.removeEventListener('abort', onAbort);
                resolve(value);
            },
            (error: unknown) => {
                signal.removeEventListener('abort', onAbort);
                reject(error);
            }
        );
    });
}

type StreamExportInput = {
    destination:
        | { kind: 'native'; directoryPath?: string; selectedFilePath?: string }
        | { kind: 'browser'; suggestedName: string; extension: string; mime: string; archive: boolean };
    formats: readonly ('wav' | 'mp3' | 'flac' | 'ogg' | 'opus')[];
    bitDepth: 16 | 24 | 32;
    mp3BitRate: number;
    dither: PcmDitherOptions;
    metadata?: Parameters<typeof audioBufferToMp3>[4];
    normalization?: { targetLufs: number; ceilingDbTp: number };
    checkCancelled: () => void;
    signal?: AbortSignal;
};

type StreamExportAudioOptions = {
    source: ExportAudioSource;
    name: string;
    onProgress: (format: StreamExportInput['formats'][number], fraction: number) => void;
    onLimited: () => void;
};

/** Acquire output storage before rendering; every render then drains into this one staged batch. */
export async function streamExport(input: StreamExportInput) {
    if (
        input.formats.length === 0 ||
        input.formats.some((format) => !['wav', 'mp3', 'flac', 'ogg', 'opus'].includes(format))
    ) {
        throw new Error('Unsupported export format.');
    }
    let destination:
        Awaited<ReturnType<typeof streamExportToNative>> | Awaited<ReturnType<typeof streamExportToBrowser>>;
    if (input.destination.kind === 'native') {
        destination = await streamExportToNative({ ...input.destination, checkCancelled: input.checkCancelled });
    } else {
        destination = await streamExportToBrowser({
            ...input.destination,
            checkCancelled: input.checkCancelled,
            signal: input.signal,
        });
    }
    return {
        async writeAudio(options: StreamExportAudioOptions) {
            input.checkCancelled();
            let preparation: Awaited<ReturnType<typeof prepareDeliveryTarget>> | undefined;
            let preparedRate: number | undefined;
            let reportedCeiling = false;
            for (const format of input.formats) {
                input.checkCancelled();
                const rate = format === 'opus' ? 48000 : options.source.sampleRate;
                if (rate !== preparedRate) {
                    // Each codec rate starts at the borrowed render, never previously converted PCM.
                    preparation = await awaitExportOperation(
                        prepareDeliveryTarget({
                            source: options.source,
                            target: {
                                sampleRate: rate,
                                channels: options.source.numberOfChannels,
                                normalization: input.normalization ? 'r128' : 'off',
                                targetLufs: input.normalization?.targetLufs ?? -14,
                                ceilingDbTp: input.normalization?.ceilingDbTp ?? -1,
                            },
                            checkCancelled: input.checkCancelled,
                        }),
                        input.signal
                    );
                    preparedRate = rate;
                    if (preparation.normalization?.limitedByCeiling && !reportedCeiling) {
                        reportedCeiling = true;
                        options.onLimited();
                    }
                }
                if (!preparation) {
                    throw new Error('Export PCM preparation is unavailable.');
                }
                const source = preparation.source;
                const entry = await awaitExportOperation(
                    destination.beginFile(`${options.name}.${format}`),
                    input.signal
                );
                const progress = (fraction: number) => options.onProgress(format, fraction);
                if (format === 'wav') {
                    await awaitExportOperation(
                        audioBufferToWav(source, input.bitDepth, progress, input.dither, entry.writer),
                        input.signal
                    );
                } else if (format === 'mp3') {
                    await awaitExportOperation(
                        audioBufferToMp3(
                            source,
                            input.mp3BitRate,
                            progress,
                            input.dither,
                            input.metadata,
                            entry.writer
                        ),
                        input.signal
                    );
                } else if (format === 'flac') {
                    if (input.bitDepth === 32) {
                        throw new Error('FLAC export supports 16-bit or 24-bit only.');
                    }
                    await awaitExportOperation(
                        audioBufferToFlac(source, input.bitDepth, progress, input.dither, entry.writer),
                        input.signal
                    );
                } else if (format === 'ogg') {
                    await audioBufferToVorbis(source, progress, entry.writer, input.signal);
                } else if (format === 'opus') {
                    await audioBufferToOpus(source, progress, entry.writer, input.signal);
                }
                input.checkCancelled();
                await awaitExportOperation(entry.finish(), input.signal);
                input.checkCancelled();
            }
        },
        commit: destination.commit,
        abort: destination.abort,
    };
}
