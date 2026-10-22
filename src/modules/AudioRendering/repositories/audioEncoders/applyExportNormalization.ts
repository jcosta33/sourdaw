import { type ExportAudioSource } from '../../models/ExportAudioSource';

import { measureIntegratedLoudness } from '#/utils/audioMetering/measureIntegratedLoudness';
import { measureTruePeak } from '#/utils/audioMetering/measureTruePeak';

import { resolveNormalizationGain } from './resolveNormalizationGain';

export type ApplyExportNormalizationInput = {
    /** Freshly rendered export buffer. Its channel data is scaled in place. */
    buffer: ExportAudioSource;
    apply?: boolean;
    targetLufs: number;
    ceilingDbTp: number;
    /** Actual measurements of replayed target PCM, including any input gain. */
    measurements?: { integratedLufs: number | null; truePeak: number };
};

export type ApplyExportNormalizationOutput = {
    /** Programme loudness before the gain, or null when the material has none. */
    measuredLufs: number | null;
    /** True peak before the gain, in dBTP, or null for silence. */
    measuredTruePeakDbTp: number | null;
    /** Gain actually applied, linear. */
    appliedGain: number;
    /** True when the true-peak ceiling held the gain below the loudness target. */
    limitedByCeiling: boolean;
};

/**
 * The shared ceiling-first gain law for owned legacy buffers and measured delivery PCM.
 * Legacy callers scale in place by default. Streaming callers supply actual target
 * measurements with apply:false and apply the returned gain only during quantization.
 */
export function applyExportNormalization({
    buffer,
    targetLufs,
    ceilingDbTp,
    apply = true,
    measurements,
}: ApplyExportNormalizationInput): ApplyExportNormalizationOutput {
    if (buffer.readChannels && (apply || !measurements)) {
        throw new Error('Replayable borrowed PCM requires measurements and apply:false.');
    }
    const channels: Float32Array[] = [];
    if (buffer.getChannelData && (!measurements || apply)) {
        for (let index = 0; index < buffer.numberOfChannels; index++) {
            channels.push(buffer.getChannelData(index));
        }
    }

    let measuredLufs: number | null;
    if (measurements) {
        measuredLufs = measurements.integratedLufs;
    } else {
        measuredLufs = measureIntegratedLoudness({
            channels,
            length: buffer.length,
            sampleRate: buffer.sampleRate,
        });
    }
    const truePeak = measurements ? measurements.truePeak : measureTruePeak({ channels, length: buffer.length });

    const { gain, limitedByCeiling } = resolveNormalizationGain({
        integratedLufs: measuredLufs,
        truePeak,
        targetLufs,
        ceilingDbTp,
    });

    if (apply && gain !== 1) {
        for (const channel of channels) {
            for (let index = 0; index < channel.length; index++) {
                channel[index] = channel[index]! * gain;
            }
        }
    }

    return {
        measuredLufs,
        measuredTruePeakDbTp: truePeak > 0 ? 20 * Math.log10(truePeak) : null,
        appliedGain: gain,
        limitedByCeiling,
    };
}
