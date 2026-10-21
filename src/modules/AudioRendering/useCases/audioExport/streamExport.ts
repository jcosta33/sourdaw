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
} & ({ targets: readonly Target[] } | LegacySettings);

/** Storage precedes rendering; each borrowed render drains all targets before its owner continues. */
export async function streamExport(input: StreamExportInput) {
    const targets =
        'targets' in input
            ? input.targets.map((target) => ({
                  ...target,
                  formats: [...target.formats],
                  dither: { ...target.dither },
                  metadata: target.metadata ? { ...target.metadata } : undefined,
              }))
            : undefined;
    const destination =
        input.destination.kind === 'native'
            ? await streamExportToNative({ ...input.destination, checkCancelled: input.checkCancelled })
            : await streamExportToBrowser({ ...input.destination, checkCancelled: input.checkCancelled });
    return {
        async writeAudio(options: {
            source: ExportAudioSource;
            name: string;
            onProgress: (format: 'wav' | 'mp3' | 'flac', fraction: number, targetId: string) => void;
            onLimited: (target: Target) => void;
        }) {
            input.checkCancelled();
            const plan: readonly Target[] =
                targets ??
                ('formats' in input
                    ? [
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
                      ]
                    : []);
            for (const target of plan) {
                input.checkCancelled();
                const prepared = await prepareDeliveryTarget({
                    source: options.source,
                    target,
                    checkCancelled: input.checkCancelled,
                });
                if (prepared.normalization?.limitedByCeiling) options.onLimited(target);
                const name = plan.length > 1 ? `${options.name}__${target.id}` : options.name;
                for (const format of target.formats) {
                    input.checkCancelled();
                    const entry = await destination.beginFile(`${name}.${format}`);
                    const progress = (fraction: number) => options.onProgress(format, fraction, target.id);
                    if (format === 'wav')
                        await audioBufferToWav(prepared.source, target.bitDepth, progress, target.dither, entry.writer);
                    else if (format === 'mp3')
                        await audioBufferToMp3(
                            prepared.source,
                            target.mp3BitRate,
                            progress,
                            target.dither,
                            target.metadata,
                            entry.writer
                        );
                    else {
                        if (target.bitDepth === 32) throw new Error('FLAC export supports 16-bit or 24-bit only.');
                        await audioBufferToFlac(
                            prepared.source,
                            target.bitDepth,
                            progress,
                            target.dither,
                            entry.writer
                        );
                    }
                    await entry.finish();
                    input.checkCancelled();
                }
            }
        },
        commit: destination.commit,
        abort: destination.abort,
    };
}
