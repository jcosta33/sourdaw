import { type ExportAudioSource } from '../../models/ExportAudioSource';
import { type WavLoudnessReport } from '../../models/ExportLoudnessReport';
import { type PcmDitherOptions } from '../../models/PcmDitherOptions';
import { createIncrementalMd5 } from '../../repositories/audioEncoders/createIncrementalMd5';
import { audioBufferToWav } from '../../repositories/audioEncoders/wavEncoder';
import { type streamExportToNative } from '../../repositories/audioExport/streamExportToNative';
import { createWavLoudnessReportAnalyzer } from '../../services/createWavLoudnessReportAnalyzer';

type ReportDestination = Pick<Awaited<ReturnType<typeof streamExportToNative>>, 'beginFile' | 'registerReportPair'>;

/** Measure and stage one exact pair; the caller owns batch abort, publication and source lifetime. */
export async function writeReportedWav(input: {
    source: ExportAudioSource;
    bitDepth: NonNullable<Parameters<typeof audioBufferToWav>[1]>;
    dither: PcmDitherOptions;
    stemId: string;
    targetId: string;
    audioName: string;
    progress: (fraction: number) => void;
    destination: ReportDestination;
    checkCancelled: () => void;
    signal?: AbortSignal;
}): Promise<void> {
    const checkCancelled = () => {
        input.checkCancelled();
        if (input.signal?.aborted) {
            throw new Error('Export cancelled');
        }
    };
    // Await settlement even after cancellation so borrowed PCM and pending writers cannot outlive us.
    const complete = async <TValue>(operation: () => Promise<TValue>): Promise<TValue> => {
        checkCancelled();
        const value = await operation();
        checkCancelled();
        return value;
    };
    checkCancelled();
    const seed = input.dither.seed ?? Math.floor(Math.random() * 0x100000000);
    const dither = { ...input.dither, seed };
    const first = createWavLoudnessReportAnalyzer(createIncrementalMd5());
    await complete(() =>
        audioBufferToWav(input.source, input.bitDepth, undefined, dither, {
            checkCancelled,
            write: async (bytes) => {
                checkCancelled();
                first.write(bytes);
            },
        })
    );
    const threshold = first.finish();
    const entry = await complete(() => input.destination.beginFile(input.audioName));
    const second = createWavLoudnessReportAnalyzer(createIncrementalMd5(), threshold.relativeGatePower);
    await complete(() =>
        audioBufferToWav(input.source, input.bitDepth, input.progress, dither, {
            checkCancelled,
            write: async (bytes) => {
                checkCancelled();
                second.write(bytes);
                await entry.writer.write(bytes);
                checkCancelled();
            },
        })
    );
    const measured = second.finish();
    if (JSON.stringify(threshold.wav) !== JSON.stringify(measured.wav)) {
        throw new Error('WAV report refused: emitted audio changed between measurement and output.');
    }
    await complete(() => entry.finish());
    const reportName = `${input.audioName}.loudness.json`;
    const report: WavLoudnessReport = {
        algorithmRevision: 'sourdaw-current-kweight-4x12tap-v1',
        measurementBasis: 'decoded-WAV-bytes',
        publicationAttested: false,
        stemId: input.stemId,
        targetId: input.targetId,
        audioFile: input.audioName,
        wav: measured.wav,
        integrated: measured.integrated,
        maxMomentary: measured.maxMomentary,
        maxShortTerm: measured.maxShortTerm,
        truePeak: measured.truePeak,
    };
    const reportEntry = await complete(() => input.destination.beginFile(reportName));
    await complete(() => reportEntry.writer.write(new TextEncoder().encode(`${JSON.stringify(report)}\n`)));
    await complete(() => reportEntry.finish());
    checkCancelled();
    input.destination.registerReportPair(input.audioName, reportName);
}
