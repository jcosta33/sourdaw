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

/** Fixed400ms energy history and filter carry. Replay supplies the relative-gated second pass. */
export function createIntegratedLoudnessAccumulator(input: {
    numberOfChannels: number;
    sampleRate: number;
    relativeGatePower?: number;
}) {
    const blockFrames = Math.round(BLOCK_SECONDS * input.sampleRate);
    const stepFrames = Math.round(BLOCK_STEP_SECONDS * input.sampleRate);
    if (blockFrames < 1 || stepFrames < 1 || !Number.isSafeInteger(blockFrames) || input.numberOfChannels < 1)
        throw new Error('Invalid loudness meter shape.');
    const { shelf, highPass } = createKWeightingFilters(input.sampleRate);
    const filters = Array.from({ length: input.numberOfChannels }, () => ({
        shelf: { x1: 0, x2: 0, y1: 0, y2: 0 },
        highPass: { x1: 0, x2: 0, y1: 0, y2: 0 },
        samples: new Float64Array(4096),
    }));
    const history = new Float64Array(blockFrames);
    const absoluteGatePower = 10 ** ((ABSOLUTE_GATE_LUFS - LOUDNESS_OFFSET) / 10);
    let frames = 0,
        energy = 0,
        gatedSum = 0,
        gatedCount = 0;
    return {
        push(channels: readonly Float32Array[]) {
            const length = channels[0]?.length ?? 0;
            if (channels.length !== input.numberOfChannels || channels.some((channel) => channel.length !== length))
                throw new Error('Invalid loudness PCM block.');
            for (let start = 0; start < length; start += 4096) {
                const count = Math.min(4096, length - start);
                filters.forEach((filter, channel) => {
                    const samples = filter.samples.subarray(0, count);
                    for (let frame = 0; frame < count; frame++) {
                        const value = channels[channel]![start + frame]!;
                        samples[frame] = Number.isFinite(value) ? value : 0;
                    }
                    applyBiquad(samples, shelf, filter.shelf);
                    applyBiquad(samples, highPass, filter.highPass);
                });
                for (let frame = 0; frame < count; frame++) {
                    let power = 0;
                    filters.forEach((filter, channel) => {
                        power += loudnessChannelWeight(channel) * filter.samples[frame]! ** 2;
                    });
                    const slot = frames % blockFrames;
                    energy += power - history[slot]!;
                    history[slot] = power;
                    frames++;
                    if (frames >= blockFrames && (frames - blockFrames) % stepFrames === 0) {
                        const blockPower = Math.max(0, energy / blockFrames);
                        if (blockPower > absoluteGatePower && blockPower > (input.relativeGatePower ?? 0)) {
                            gatedSum += blockPower;
                            gatedCount++;
                        }
                    }
                }
            }
        },
        relativeGatePower: () =>
            gatedCount === 0 ? Number.POSITIVE_INFINITY : (gatedSum / gatedCount) * 10 ** (RELATIVE_GATE_LU / 10),
        integratedLufs: () => (gatedCount === 0 ? null : LOUDNESS_OFFSET + 10 * Math.log10(gatedSum / gatedCount)),
    };
}

/** Integrated LUFS, null below the absolute gate or shorter than one400ms block. */
export function measureIntegratedLoudness({
    channels,
    length,
    sampleRate,
}: MeasureIntegratedLoudnessInput): number | null {
    const blockFrames = Math.round(BLOCK_SECONDS * sampleRate);
    const stepFrames = Math.round(BLOCK_STEP_SECONDS * sampleRate);
    if (
        !Number.isFinite(length) ||
        !Number.isFinite(sampleRate) ||
        blockFrames <= 0 ||
        stepFrames <= 0 ||
        length < blockFrames ||
        channels.length === 0
    )
        return null;
    const replay = (relativeGatePower?: number) => {
        const meter = createIntegratedLoudnessAccumulator({
            numberOfChannels: channels.length,
            sampleRate,
            relativeGatePower,
        });
        for (let start = 0; start < length; start += 4096) {
            const count = Math.min(4096, length - start);
            meter.push(
                channels.map((channel) => {
                    if (channel.length >= start + count) return channel.subarray(start, start + count);
                    const padded = new Float32Array(count);
                    padded.set(channel.subarray(start, start + count));
                    return padded;
                })
            );
        }
        return meter;
    };
    return replay(replay().relativeGatePower()).integratedLufs();
}
