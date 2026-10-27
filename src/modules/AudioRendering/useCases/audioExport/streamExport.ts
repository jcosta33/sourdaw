import { type ExportAudioSource } from '../../models/ExportAudioSource';
import { type WavLoudnessReport } from '../../models/ExportLoudnessReport';
import { type PcmDitherOptions } from '../../repositories/audioEncoders/convertFloatChannelsToPcm';
import { createIncrementalMd5 } from '../../repositories/audioEncoders/createIncrementalMd5';
import { audioBufferToFlac } from '../../repositories/audioEncoders/flacEncoder';
import { audioBufferToWav } from '../../repositories/audioEncoders/wavEncoder';
import { streamExportToBrowser } from '../../repositories/audioExport/streamExportToBrowser';
import { streamExportToNative } from '../../repositories/audioExport/streamExportToNative';
import { createWavLoudnessReportAnalyzer } from '../../services/createWavLoudnessReportAnalyzer';
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
    includeWavLoudnessReports?: boolean;
    exportMode?: 'stems' | 'mixdown';
} & ({ targets: readonly Target[] } | LegacySettings);

const REPORT_RATES = new Set([44100, 48000, 88200, 96000]);

export function validateWavReportPlan(
    input: Pick<StreamExportInput, 'destination' | 'includeWavLoudnessReports' | 'exportMode'>,
    targets: readonly Pick<Target, 'formats' | 'bitDepth' | 'sampleRate' | 'channels'>[]
) {
    if (!input.includeWavLoudnessReports) {
        return;
    }
    if (
        input.exportMode !== 'stems' ||
        targets.length === 0 ||
        targets.some(
            (target) =>
                target.formats.length !== 1 ||
                target.formats[0] !== 'wav' ||
                ![16, 24, 32].includes(target.bitDepth) ||
                !REPORT_RATES.has(target.sampleRate) ||
                (target.channels !== 1 && target.channels !== 2)
        ) ||
        (input.destination.kind === 'browser' && !input.destination.archive) ||
        (input.destination.kind === 'native' && !input.destination.directoryPath)
    ) {
        throw new Error(
            'WAV loudness reports require Stems, WAV-only targets at supported PCM settings, and an archive or native folder.'
        );
    }
}

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
    validateWavReportPlan(input, targets ?? []);
    let destination:
        Awaited<ReturnType<typeof streamExportToNative>> | Awaited<ReturnType<typeof streamExportToBrowser>>;
    if (input.destination.kind === 'native') {
        destination = await streamExportToNative({
            ...input.destination,
            requireReportPairs: input.includeWavLoudnessReports,
            checkCancelled: input.checkCancelled,
        });
    } else {
        destination = await streamExportToBrowser({
            ...input.destination,
            checkCancelled: input.checkCancelled,
            signal: input.signal,
            requireReportPairs: input.includeWavLoudnessReports,
        });
    }
    let sealedReports = 0;
    let committed = false;
    return {
        async writeAudio(options: {
            source: ExportAudioSource;
            name: string;
            stemId?: string;
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
                    const audioName = `${name}.${format}`;
                    const progress = (fraction: number) => options.onProgress(format, fraction, target.id);
                    if (format === 'wav' && input.includeWavLoudnessReports) {
                        if (!options.stemId) {
                            throw new Error('WAV report stem identity is unavailable.');
                        }
                        const seed = target.dither.seed ?? Math.floor(Math.random() * 0x100000000);
                        const dither = { ...target.dither, seed };
                        const first = createWavLoudnessReportAnalyzer(createIncrementalMd5());
                        await awaitExportOperation(
                            audioBufferToWav(prepared.source, target.bitDepth, undefined, dither, {
                                checkCancelled: input.checkCancelled,
                                write: async (bytes) => {
                                    first.write(bytes);
                                },
                            }),
                            input.signal
                        );
                        const threshold = first.finish();
                        const entry = await awaitExportOperation(destination.beginFile(audioName), input.signal);
                        const second = createWavLoudnessReportAnalyzer(
                            createIncrementalMd5(),
                            threshold.relativeGatePower
                        );
                        await awaitExportOperation(
                            audioBufferToWav(prepared.source, target.bitDepth, progress, dither, {
                                checkCancelled: input.checkCancelled,
                                write: async (bytes) => {
                                    second.write(bytes);
                                    await entry.writer.write(bytes);
                                },
                            }),
                            input.signal
                        );
                        const measured = second.finish();
                        if (JSON.stringify(threshold.wav) !== JSON.stringify(measured.wav)) {
                            throw new Error(
                                'WAV report refused: emitted audio changed between measurement and output.'
                            );
                        }
                        await awaitExportOperation(entry.finish(), input.signal);
                        const reportName = `${audioName}.loudness.json`;
                        const report: WavLoudnessReport = {
                            algorithmRevision: 'sourdaw-current-kweight-4x12tap-v1',
                            measurementBasis: 'decoded-WAV-bytes',
                            publicationAttested: false,
                            stemId: options.stemId,
                            targetId: target.id,
                            audioFile: audioName,
                            wav: measured.wav,
                            integrated: measured.integrated,
                            maxMomentary: measured.maxMomentary,
                            maxShortTerm: measured.maxShortTerm,
                            truePeak: measured.truePeak,
                        };
                        const reportEntry = await awaitExportOperation(destination.beginFile(reportName), input.signal);
                        await awaitExportOperation(
                            reportEntry.writer.write(new TextEncoder().encode(`${JSON.stringify(report)}\n`)),
                            input.signal
                        );
                        await awaitExportOperation(reportEntry.finish(), input.signal);
                        destination.registerReportPair(audioName, reportName);
                        sealedReports++;
                        input.checkCancelled();
                        continue;
                    }
                    const entry = await awaitExportOperation(destination.beginFile(audioName), input.signal);
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
        async commit(onCommitBegin: () => void) {
            await destination.commit(onCommitBegin);
            committed = true;
        },
        reportedFiles: () => (committed ? sealedReports : 0),
        abort: destination.abort,
    };
}
