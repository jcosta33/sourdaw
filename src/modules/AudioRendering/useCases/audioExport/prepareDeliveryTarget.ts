import { type ExportAudioSource } from '../../models/ExportAudioSource';
import { createDeliveryPcmSource } from '../../repositories/audioEncoders/createDeliveryPcmSource';
import { readExportPcmBlock } from '../../repositories/audioEncoders/readExportPcmBlock';
import { normalizeExportBuffer } from '../normalizeExportBuffer';
import { type resolveDeliveryTargets } from '../resolveDeliveryTargets';

import { createIntegratedLoudnessAccumulator } from '#/utils/audioMetering/measureIntegratedLoudness';
import { createTruePeakAccumulator } from '#/utils/audioMetering/measureTruePeak';

/** Meter converted target PCM in bounded blocks, then use the existing single-gain law. */
export async function prepareDeliveryTarget(input: {
    source: ExportAudioSource;
    target: Pick<
        ReturnType<typeof resolveDeliveryTargets>[number],
        'sampleRate' | 'normalization' | 'targetLufs' | 'ceilingDbTp'
    > & { channels: number };
    checkCancelled: () => void;
}) {
    const { target, checkCancelled } = input;
    const source = createDeliveryPcmSource({
        source: input.source,
        sampleRate: target.sampleRate,
        channels: target.channels,
    });
    const sourceGain = source.gain ?? 1;
    if (!Number.isFinite(sourceGain) || sourceGain < 0) {
        throw new Error('Invalid delivery PCM gain.');
    }
    let samplePeak = 0;
    const truePeak = createTruePeakAccumulator(source.numberOfChannels);
    const replay = async (relativeGatePower?: number) => {
        let loudness: ReturnType<typeof createIntegratedLoudnessAccumulator> | undefined;
        if (target.normalization === 'r128') {
            loudness = createIntegratedLoudnessAccumulator({
                numberOfChannels: source.numberOfChannels,
                sampleRate: source.sampleRate,
                relativeGatePower,
            });
        }
        let blocks = 0;
        for (let start = 0; start < source.length; start += 4096) {
            checkCancelled();
            const channels = readExportPcmBlock({ source, start, length: Math.min(4096, source.length - start) });
            if (relativeGatePower === undefined) {
                for (const channel of channels) {
                    for (const sample of channel) {
                        if (Number.isFinite(sample)) {
                            samplePeak = Math.max(samplePeak, Math.abs(sample));
                        }
                    }
                }
            }
            if (loudness) {
                let measured: readonly Float32Array[];
                if (sourceGain === 1) {
                    measured = channels;
                } else {
                    measured = channels.map((channel) => Float32Array.from(channel, (sample) => sample * sourceGain));
                }
                loudness.push(measured);
                if (relativeGatePower === undefined) {
                    truePeak.push(measured);
                }
            }
            // Real tasks let cancellation/UI events run, bounded independently of programme length.
            if (++blocks % 4 === 0) {
                await new Promise<void>((resolve) => setTimeout(resolve, 0));
                checkCancelled();
            }
        }
        checkCancelled();
        return loudness;
    };
    const first = await replay();
    const second = first ? await replay(first.relativeGatePower()) : undefined;
    let normalization: ReturnType<typeof normalizeExportBuffer> | undefined;
    if (second) {
        normalization = normalizeExportBuffer({
            buffer: source,
            apply: false,
            targetLufs: target.targetLufs,
            ceilingDbTp: target.ceilingDbTp,
            measurements: { integratedLufs: second.integratedLufs(), truePeak: truePeak.finish() },
        });
    }
    // AudioBuffer's PCM access lives on its prototype and requires its original receiver.
    const shape = {
        length: source.length,
        numberOfChannels: source.numberOfChannels,
        sampleRate: source.sampleRate,
        gain: sourceGain * (normalization?.appliedGain ?? 1),
        samplePeak,
    };
    const readChannels = source.readChannels;
    const getChannelData = source.getChannelData;
    if (!readChannels && !getChannelData) {
        throw new Error('Delivery PCM reader is unavailable.');
    }
    let prepared: ExportAudioSource;
    if (readChannels) {
        prepared = { ...shape, readChannels: (start, length) => readChannels.call(source, start, length) };
    } else {
        prepared = {
            ...shape,
            getChannelData: (channel) => {
                if (!getChannelData) {
                    throw new Error('Delivery PCM reader is unavailable.');
                }
                return getChannelData.call(source, channel);
            },
        };
    }
    return { source: prepared, normalization };
}
