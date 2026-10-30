import { type ExportAudioSource } from '../../models/ExportAudioSource';
import { type PcmDitherOptions } from '../../repositories/audioEncoders/convertFloatChannelsToPcm';
import { audioBufferToFlac } from '../../repositories/audioEncoders/flacEncoder';
import { audioBufferToWav } from '../../repositories/audioEncoders/wavEncoder';
import { streamExportToBrowser } from '../../repositories/audioExport/streamExportToBrowser';
import { streamExportToNative } from '../../repositories/audioExport/streamExportToNative';
import { audioBufferToMp3 } from '../audioBufferToMp3';
import { type resolveDeliveryTargets } from '../resolveDeliveryTargets';

import { prepareDeliveryTarget } from './prepareDeliveryTarget';

type Target = Omit<ReturnType<typeof resolveDeliveryTargets>[number], 'mp3BitRate' | 'channels'> & {
    mp3BitRate: number;
    channels: number;
};
type LegacySettings = {
    formats: readonly ('wav' | 'mp3' | 'flac')[];
    bitDepth: 16 | 24 | 32;
    mp3BitRate: number;
    dither: PcmDitherOptions;
    metadata?: Parameters<typeof audioBufferToMp3>[4];
    normalization?: { targetLufs: number; ceilingDbTp: number };
};
type StreamExportInput = {
    destination:
        | { kind: 'native'; directoryPath?: string; selectedFilePath?: string }
        | { kind: 'browser'; suggestedName: string; extension: string; mime: string; archive: boolean };
    checkCancelled: () => void;
    signal?: AbortSignal;
} & ({ targets: readonly Target[] } | LegacySettings);

function copyTargets(targets: readonly Target[]): Target[] {
    return targets.map((target) => {
        const dither: PcmDitherOptions = { mode: target.dither.mode };
        if (Object.hasOwn(target.dither, 'seed')) {
            dither.seed = target.dither.seed;
        }
        let metadata: Target['metadata'];
        if (target.metadata) {
            metadata = {
                title: target.metadata.title,
                artist: target.metadata.artist,
                description: target.metadata.description,
            };
        }
        return {
            ...target,
            formats: [...target.formats],
            dither,
            metadata,
        };
    });
}

function createExportPlan(
    targets: readonly Target[] | undefined,
    input: StreamExportInput,
    source: ExportAudioSource
): readonly Target[] {
    if (targets !== undefined) {
        return targets;
    }
    if (!('formats' in input)) {
        return [];
    }
    return [
        {
            id: 'custom',
            name: 'Custom',
            formats: [...input.formats],
            sampleRate: source.sampleRate,
            channels: source.numberOfChannels,
            bitDepth: input.bitDepth,
            mp3BitRate: input.mp3BitRate,
            dither: input.dither,
            metadata: input.metadata,
            normalization: input.normalization ? 'r128' : 'off',
            targetLufs: input.normalization?.targetLufs ?? -14,
            ceilingDbTp: input.normalization?.ceilingDbTp ?? -1,
        },
    ];
}

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

/** Storage precedes rendering; each borrowed render drains all targets before its owner continues. */
export async function streamExport(input: StreamExportInput) {
    const targets = 'targets' in input ? copyTargets(input.targets) : undefined;
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
        async writeAudio(options: {
            source: ExportAudioSource;
            name: string;
            onProgress: (format: 'wav' | 'mp3' | 'flac', fraction: number, targetId: string) => void;
            onLimited: (target: Target) => void;
        }) {
            input.checkCancelled();
            const plan = createExportPlan(targets, input, options.source);
            for (const target of plan) {
                input.checkCancelled();
                const prepared = await awaitExportOperation(
                    prepareDeliveryTarget({
                        source: options.source,
                        target,
                        checkCancelled: input.checkCancelled,
                    }),
                    input.signal
                );
                if (prepared.normalization?.limitedByCeiling) {
                    options.onLimited(target);
                }
                const name = plan.length > 1 ? `${options.name}__${target.id}` : options.name;
                for (const format of target.formats) {
                    input.checkCancelled();
                    const entry = await awaitExportOperation(destination.beginFile(`${name}.${format}`), input.signal);
                    const progress = (fraction: number) => options.onProgress(format, fraction, target.id);
                    if (format === 'wav') {
                        await awaitExportOperation(
                            audioBufferToWav(prepared.source, target.bitDepth, progress, target.dither, entry.writer),
                            input.signal
                        );
                    } else if (format === 'mp3') {
                        await awaitExportOperation(
                            audioBufferToMp3(
                                prepared.source,
                                target.mp3BitRate,
                                progress,
                                target.dither,
                                target.metadata,
                                entry.writer
                            ),
                            input.signal
                        );
                    } else {
                        if (target.bitDepth === 32) {
                            throw new Error('FLAC export supports 16-bit or 24-bit only.');
                        }
                        await awaitExportOperation(
                            audioBufferToFlac(prepared.source, target.bitDepth, progress, target.dither, entry.writer),
                            input.signal
                        );
                    }
                    await awaitExportOperation(entry.finish(), input.signal);
                    input.checkCancelled();
                }
            }
        },
        commit: destination.commit,
        abort: destination.abort,
    };
}
