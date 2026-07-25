import { createKWeightingFilters, type LoudnessBiquad } from './createKWeightingFilters';

/**
 * Gated integrated loudness — ITU-R BS.1770-4 / EBU R 128.
 *
 * The K-weighting pre-filter is built per sample rate (see
 * `createKWeightingFilters`); this module owns the gating and the block
 * statistics.
 */

function applyBiquad(samples: Float64Array, filter: LoudnessBiquad): void {
    let x1 = 0;
    let x2 = 0;
    let y1 = 0;
    let y2 = 0;

    for (let index = 0; index < samples.length; index++) {
        const x0 = samples[index]!;
        const y0 = filter.b0 * x0 + filter.b1 * x1 + filter.b2 * x2 - filter.a1 * y1 - filter.a2 * y2;
        samples[index] = y0;
        x2 = x1;
        x1 = x0;
        y2 = y1;
        y1 = y0;
    }
}

/**
 * Per-channel weights (BS.1770-4 Table 4). Only the first five are defined;
 * anything beyond a 5.0 layout is weighted as a surround channel.
 */
function channelWeight(channelIndex: number): number {
    if (channelIndex < 3) {
        return 1;
    }
    return 1.41;
}

const BLOCK_SECONDS = 0.4;
/** 75% overlap, as the recommendation specifies. */
const BLOCK_STEP_SECONDS = 0.1;
const LOUDNESS_OFFSET = -0.691;
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

        const weight = channelWeight(channelIndex);
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
    const absoluteGatePower = Math.pow(10, (ABSOLUTE_GATE_LUFS - LOUDNESS_OFFSET) / 10);
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
    const relativeGatePower = (gatedSum / gatedCount) * Math.pow(10, RELATIVE_GATE_LU / 10);
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
