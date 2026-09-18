import { applyBiquad } from './applyBiquad';
import { createKWeightingFilters } from './createKWeightingFilters';
import { LOUDNESS_OFFSET, loudnessChannelWeight } from './loudnessScale';

/**
 * Gated integrated loudness — ITU-R BS.1770-4 / EBU R 128.
 *
 * The K-weighting pre-filter is built per sample rate (see
 * `createKWeightingFilters`); this module owns the gating and the block
 * statistics.
 */

const BLOCK_SECONDS = 0.4;
/** 75% overlap, as the recommendation specifies. */
const BLOCK_STEP_SECONDS = 0.1;
const ABSOLUTE_GATE_LUFS = -70;
const RELATIVE_GATE_LU = -10;

export type MeasureIntegratedLoudnessInput = {
    channels: readonly Float32Array[];
    length: number;
    sampleRate: number;
};

/**
 * Integrated loudness in LUFS, or `null` when the material is too short for a
 * single 400 ms block or is entirely below the absolute gate (digital silence
 * has no defined loudness, and returning a number there would invite a
 * normalization stage to apply enormous gain to nothing).
 */
export function measureIntegratedLoudness({
    channels,
    length,
    sampleRate,
}: MeasureIntegratedLoudnessInput): number | null {
    const blockFrames = Math.round(BLOCK_SECONDS * sampleRate);
    const stepFrames = Math.round(BLOCK_STEP_SECONDS * sampleRate);
    if (blockFrames <= 0 || stepFrames <= 0 || length < blockFrames || channels.length === 0) {
        return null;
    }

    const { shelf, highPass } = createKWeightingFilters(sampleRate);

    // Weighted mean square per block, summed across channels.
    const blockCount = Math.floor((length - blockFrames) / stepFrames) + 1;
    const blockPower = new Float64Array(blockCount);

    for (let channelIndex = 0; channelIndex < channels.length; channelIndex++) {
        const source = channels[channelIndex]!;
        const weighted = new Float64Array(length);
        for (let index = 0; index < length; index++) {
            const sample = source[index] ?? 0;
            weighted[index] = Number.isFinite(sample) ? sample : 0;
        }
        applyBiquad(weighted, shelf);
        applyBiquad(weighted, highPass);

        const weight = loudnessChannelWeight(channelIndex);
        for (let block = 0; block < blockCount; block++) {
            const start = block * stepFrames;
            let sumSquares = 0;
            for (let offset = 0; offset < blockFrames; offset++) {
                const value = weighted[start + offset]!;
                sumSquares += value * value;
            }
            blockPower[block] = (blockPower[block] ?? 0) + (weight * sumSquares) / blockFrames;
        }
    }

    // Absolute gate.
    const absoluteGatePower = 10 ** ((ABSOLUTE_GATE_LUFS - LOUDNESS_OFFSET) / 10);
    let gatedSum = 0;
    let gatedCount = 0;
    for (const power of blockPower) {
        if (power > absoluteGatePower) {
            gatedSum += power;
            gatedCount++;
        }
    }
    if (gatedCount === 0) {
        return null;
    }

    // Relative gate, referenced to the absolute-gated mean.
    const relativeGatePower = (gatedSum / gatedCount) * 10 ** (RELATIVE_GATE_LU / 10);
    let finalSum = 0;
    let finalCount = 0;
    for (const power of blockPower) {
        if (power > absoluteGatePower && power > relativeGatePower) {
            finalSum += power;
            finalCount++;
        }
    }
    if (finalCount === 0) {
        return null;
    }

    return LOUDNESS_OFFSET + 10 * Math.log10(finalSum / finalCount);
}
