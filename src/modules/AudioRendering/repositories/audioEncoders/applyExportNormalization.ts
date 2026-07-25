import { measureIntegratedLoudness } from './measureIntegratedLoudness';
import { measureTruePeak } from './measureTruePeak';
import { resolveNormalizationGain } from './resolveNormalizationGain';

export type ApplyExportNormalizationInput = {
    /** Freshly rendered export buffer. Its channel data is scaled in place. */
    buffer: AudioBuffer;
    targetLufs: number;
    ceilingDbTp: number;
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
 * Measure a rendered export and scale it to the requested loudness without
 * breaching the true-peak ceiling (OE-7).
 *
 * Applied once, before the format loop, so every requested format is encoded
 * from identical audio — a mix normalized for WAV but not for MP3 would ship
 * two different masters under one name.
 *
 * Scaling is in place. The buffer is rendered for this export and is not the
 * project's audio, so there is nothing else holding a reference to the
 * un-normalized samples.
 */
export function applyExportNormalization({
    buffer,
    targetLufs,
    ceilingDbTp,
}: ApplyExportNormalizationInput): ApplyExportNormalizationOutput {
    const channels: Float32Array[] = [];
    for (let index = 0; index < buffer.numberOfChannels; index++) {
        channels.push(buffer.getChannelData(index));
    }

    const measuredLufs = measureIntegratedLoudness({
        channels,
        length: buffer.length,
        sampleRate: buffer.sampleRate,
    });
    const truePeak = measureTruePeak({ channels, length: buffer.length });

    const { gain, limitedByCeiling } = resolveNormalizationGain({
        integratedLufs: measuredLufs,
        truePeak,
        targetLufs,
        ceilingDbTp,
    });

    if (gain !== 1) {
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
