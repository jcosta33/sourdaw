import { type ExportAudioSource, type ExportByteWriter } from '../../models/ExportAudioSource';
import { type PcmDitherOptions } from '../../repositories/audioEncoders/convertFloatChannelsToPcm';
import { audioBufferToFlac } from '../../repositories/audioEncoders/flacEncoder';
import { audioBufferToOpus } from '../../repositories/audioEncoders/opusEncoder';
import { audioBufferToVorbis } from '../../repositories/audioEncoders/vorbisEncoder';
import { audioBufferToWav } from '../../repositories/audioEncoders/wavEncoder';
import { streamExportToBrowser } from '../../repositories/audioExport/streamExportToBrowser';
import { streamExportToNative } from '../../repositories/audioExport/streamExportToNative';
import { audioBufferToMp3 } from '../audioBufferToMp3';
import { type resolveDeliveryTargets } from '../resolveDeliveryTargets';

import { prepareDeliveryTarget } from './prepareDeliveryTarget';
import { validateWavLoudnessReportPlan } from './validateWavLoudnessReportPlan';
import { writeReportedWav } from './writeReportedWav';

type Target = Omit<ReturnType<typeof resolveDeliveryTargets>[number], 'mp3BitRate' | 'channels'> & {
    mp3BitRate: number;
    channels: number;
};
type DeliveryFormat = Target['formats'][number];
type LegacySettings = {
    formats: readonly DeliveryFormat[];
    bitDepth: 16 | 24 | 32;
    mp3BitRate: number;
    dither: PcmDitherOptions;
    metadata?: Parameters<typeof audioBufferToMp3>[4];
    normalization?: { targetLufs: number; ceilingDbTp: number };
};
type StreamExportAudioOptions = {
    source: ExportAudioSource;
    name: string;
    /** The stem's track id; a reported WAV records it so a renamed file still names its stem. */
    stemId?: string;
    onProgress: (format: DeliveryFormat, fraction: number, targetId: string) => void;
    onLimited: (target: Target) => void;
};

const SHIPPED_FORMATS: readonly string[] = ['wav', 'mp3', 'flac', 'ogg', 'opus'];
// The Opus encoder only accepts 48 kHz input; other formats keep the target's rate.
const OPUS_SAMPLE_RATE = 48000;

type StreamExportInput = {
    destination:
        | { kind: 'native'; directoryPath?: string; selectedFilePath?: string }
        | { kind: 'browser'; suggestedName: string; extension: string; mime: string; archive: boolean };
    checkCancelled: () => void;
    signal?: AbortSignal;
    /** Stage a paired `.loudness.json` report of the exact emitted bytes beside every WAV stem. */
    includeWavLoudnessReports?: boolean;
    exportMode?: 'stems' | 'mixdown';
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

/** Write one prepared source to one entry in a single delivery format. */
async function encodeDeliveryFormat(input: {
    format: DeliveryFormat;
    source: ExportAudioSource;
    target: Target;
    writer: ExportByteWriter;
    onProgress: (fraction: number) => void;
    signal?: AbortSignal;
}): Promise<void> {
    const { format, source, target, writer, onProgress, signal } = input;
    if (format === 'wav') {
        await awaitExportOperation(
            audioBufferToWav(source, target.bitDepth, onProgress, target.dither, writer),
            signal
        );
    } else if (format === 'mp3') {
        await awaitExportOperation(
            audioBufferToMp3(source, target.mp3BitRate, onProgress, target.dither, target.metadata, writer),
            signal
        );
    } else if (format === 'flac') {
        if (target.bitDepth === 32) {
            throw new Error('FLAC export supports 16-bit or 24-bit only.');
        }
        await awaitExportOperation(
            audioBufferToFlac(source, target.bitDepth, onProgress, target.dither, writer),
            signal
        );
    } else if (format === 'ogg') {
        await audioBufferToVorbis(source, onProgress, writer, signal);
    } else if (format === 'opus') {
        await audioBufferToOpus(source, onProgress, writer, signal);
    } else {
        throw new Error('Unsupported delivery format.');
    }
}

type ExportDestination =
    Awaited<ReturnType<typeof streamExportToNative>> | Awaited<ReturnType<typeof streamExportToBrowser>>;

function openExportDestination(input: StreamExportInput, requireReportPairs: boolean): Promise<ExportDestination> {
    if (input.destination.kind === 'native') {
        return streamExportToNative({
            ...input.destination,
            requireReportPairs,
            checkCancelled: input.checkCancelled,
        });
    }
    return streamExportToBrowser({
        ...input.destination,
        requireReportPairs,
        checkCancelled: input.checkCancelled,
        signal: input.signal,
    });
}

/** Write one target's pass in one format; returns whether it staged a WAV with its report. */
async function writeDeliveryPass(input: {
    format: DeliveryFormat;
    source: ExportAudioSource;
    target: Target;
    name: string;
    stemId?: string;
    reported: boolean;
    destination: ExportDestination;
    progress: (fraction: number) => void;
    checkCancelled: () => void;
    signal?: AbortSignal;
}): Promise<boolean> {
    const { format, source, target, name, destination, progress, signal } = input;
    if (input.reported && format === 'wav') {
        if (!input.stemId) {
            throw new Error('A reported WAV stem needs its stem identity.');
        }
        await awaitExportOperation(
            writeReportedWav({
                source,
                bitDepth: target.bitDepth,
                dither: target.dither,
                stemId: input.stemId,
                targetId: target.id,
                audioName: `${name}.wav`,
                progress,
                destination,
                checkCancelled: input.checkCancelled,
                signal,
            }),
            signal
        );
        input.checkCancelled();
        return true;
    }
    const entry = await awaitExportOperation(destination.beginFile(`${name}.${format}`), signal);
    await encodeDeliveryFormat({ format, source, target, writer: entry.writer, onProgress: progress, signal });
    input.checkCancelled();
    await awaitExportOperation(entry.finish(), signal);
    input.checkCancelled();
    return false;
}

/** Storage precedes rendering; each borrowed render drains all targets before its owner continues. */
export async function streamExport(input: StreamExportInput) {
    const targets = 'targets' in input ? copyTargets(input.targets) : undefined;
    const formatLists = targets?.map((target) => target.formats) ?? ('formats' in input ? [input.formats] : []);
    if (
        formatLists.length === 0 ||
        formatLists.some(
            (formats) => formats.length === 0 || formats.some((format) => !SHIPPED_FORMATS.includes(format))
        )
    ) {
        throw new Error('Unsupported delivery format.');
    }
    validateWavLoudnessReportPlan({
        includeWavLoudnessReports: input.includeWavLoudnessReports,
        exportMode: input.exportMode,
        targets,
    });
    const requireReportPairs = input.includeWavLoudnessReports === true;
    const destination = await openExportDestination(input, requireReportPairs);
    let stagedReports = 0;
    let committed = false;
    return {
        async writeAudio(options: StreamExportAudioOptions) {
            input.checkCancelled();
            const plan = createExportPlan(targets, input, options.source);
            for (const target of plan) {
                input.checkCancelled();
                const name = plan.length > 1 ? `${options.name}__${target.id}` : options.name;
                let prepared: Awaited<ReturnType<typeof prepareDeliveryTarget>> | undefined;
                let preparedRate: number | undefined;
                let reportedCeiling = false;
                for (const format of target.formats) {
                    input.checkCancelled();
                    const rate = format === 'opus' ? OPUS_SAMPLE_RATE : target.sampleRate;
                    if (rate !== preparedRate) {
                        // Each codec rate starts at the borrowed render, never previously converted PCM.
                        prepared = await awaitExportOperation(
                            prepareDeliveryTarget({
                                source: options.source,
                                target: {
                                    sampleRate: rate,
                                    channels: target.channels,
                                    normalization: target.normalization,
                                    targetLufs: target.targetLufs,
                                    ceilingDbTp: target.ceilingDbTp,
                                },
                                checkCancelled: input.checkCancelled,
                            }),
                            input.signal
                        );
                        preparedRate = rate;
                        if (prepared.normalization?.limitedByCeiling && !reportedCeiling) {
                            reportedCeiling = true;
                            options.onLimited(target);
                        }
                    }
                    if (!prepared) {
                        throw new Error('Export PCM preparation is unavailable.');
                    }
                    const stagedReport = await writeDeliveryPass({
                        format,
                        source: prepared.source,
                        target,
                        name,
                        stemId: options.stemId,
                        reported: requireReportPairs,
                        destination,
                        progress: (fraction) => options.onProgress(format, fraction, target.id),
                        checkCancelled: input.checkCancelled,
                        signal: input.signal,
                    });
                    if (stagedReport) {
                        stagedReports++;
                    }
                }
            }
        },
        async commit(onCommitBegin: () => void) {
            await destination.commit(onCommitBegin);
            committed = true;
        },
        /** Reports delivered by a completed commit; none before it. */
        reportedFiles: () => (committed ? stagedReports : 0),
        abort: destination.abort,
    };
}
