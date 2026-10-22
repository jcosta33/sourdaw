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
    includeWavLoudnessReports?: boolean;
    exportMode?: 'stems' | 'mixdown';
} & ({ targets: readonly Target[] } | LegacySettings);

const REPORT_RATES = new Set([44100, 48000, 88200, 96000]);

export function validateWavReportPlan(
    input: Pick<StreamExportInput, 'destination' | 'includeWavLoudnessReports' | 'exportMode'>,
    targets: readonly Pick<Target, 'formats' | 'bitDepth' | 'sampleRate' | 'channels'>[]
) {
    if (!input.includeWavLoudnessReports) return;
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

/** Storage precedes rendering; each borrowed render drains all targets before its owner continues. */
export async function streamExport(input: StreamExportInput) {
    let targets: Target[] | undefined;
    if ('targets' in input) {
        targets = input.targets.map((target) => {
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
            requireReportPairs: input.includeWavLoudnessReports,
            checkCancelled: input.checkCancelled,
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
            let plan: readonly Target[] = targets ?? [];
            if (targets === undefined && 'formats' in input) {
                plan = [
                    {
                        id: 'custom',
                        name: 'Custom',
                        formats: [...input.formats],
                        sampleRate: options.source.sampleRate,
                        channels: options.source.numberOfChannels,
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
            for (const target of plan) {
                input.checkCancelled();
                const prepared = await prepareDeliveryTarget({
                    source: options.source,
                    target,
                    checkCancelled: input.checkCancelled,
                });
                if (prepared.normalization?.limitedByCeiling) {
                    options.onLimited(target);
                }
                const name = plan.length > 1 ? `${options.name}__${target.id}` : options.name;
                for (const format of target.formats) {
                    input.checkCancelled();
                    const audioName = `${name}.${format}`;
                    const progress = (fraction: number) => options.onProgress(format, fraction, target.id);
                    if (format === 'wav') {
                        if (input.includeWavLoudnessReports) {
                            if (!options.stemId) throw new Error('WAV report stem identity is unavailable.');
                            const seed = target.dither.seed ?? Math.floor(Math.random() * 0x100000000);
                            const dither = { ...target.dither, seed };
                            const first = createWavLoudnessReportAnalyzer(createIncrementalMd5());
                            await audioBufferToWav(prepared.source, target.bitDepth, undefined, dither, {
                                checkCancelled: input.checkCancelled,
                                write: async (bytes) => {
                                    first.write(bytes);
                                },
                            });
                            const threshold = first.finish();
                            const entry = await destination.beginFile(audioName);
                            const second = createWavLoudnessReportAnalyzer(
                                createIncrementalMd5(),
                                threshold.relativeGatePower
                            );
                            await audioBufferToWav(prepared.source, target.bitDepth, progress, dither, {
                                checkCancelled: input.checkCancelled,
                                write: async (bytes) => {
                                    second.write(bytes);
                                    await entry.writer.write(bytes);
                                },
                            });
                            const measured = second.finish();
                            if (JSON.stringify(threshold.wav) !== JSON.stringify(measured.wav)) {
                                throw new Error(
                                    'WAV report refused: emitted audio changed between measurement and output.'
                                );
                            }
                            await entry.finish();
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
                            const reportEntry = await destination.beginFile(reportName);
                            await reportEntry.writer.write(new TextEncoder().encode(`${JSON.stringify(report)}\n`));
                            await reportEntry.finish();
                            destination.registerReportPair(audioName, reportName);
                            sealedReports++;
                            input.checkCancelled();
                            continue;
                        }
                        const entry = await destination.beginFile(audioName);
                        await audioBufferToWav(prepared.source, target.bitDepth, progress, target.dither, entry.writer);
                        await entry.finish();
                    } else if (format === 'mp3') {
                        const entry = await destination.beginFile(audioName);
                        await audioBufferToMp3(
                            prepared.source,
                            target.mp3BitRate,
                            progress,
                            target.dither,
                            target.metadata,
                            entry.writer
                        );
                        await entry.finish();
                    } else {
                        if (target.bitDepth === 32) {
                            throw new Error('FLAC export supports 16-bit or 24-bit only.');
                        }
                        const entry = await destination.beginFile(audioName);
                        await audioBufferToFlac(
                            prepared.source,
                            target.bitDepth,
                            progress,
                            target.dither,
                            entry.writer
                        );
                        await entry.finish();
                    }
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
