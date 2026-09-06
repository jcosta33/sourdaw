import { describe, expect, it } from 'vitest';

import { applyExportNormalization } from '../applyExportNormalization';
import { measureTruePeak } from '../measureTruePeak';

const SAMPLE_RATE = 48_000;
const TRUE_PEAK_TAIL_FRAMES = 11;
const CEILING_DBTP = -1;
const CEILING_LINEAR = 10 ** (CEILING_DBTP / 20);
const FLOAT32_TOLERANCE = 1e-6;

function makeBuffer(channel: Float32Array<ArrayBuffer>): AudioBuffer {
    return {
        copyFromChannel: (destination, _channelNumber, bufferOffset = 0) => {
            destination.set(channel.subarray(bufferOffset, bufferOffset + destination.length));
        },
        copyToChannel: (source, _channelNumber, bufferOffset = 0) => {
            channel.set(source, bufferOffset);
        },
        duration: channel.length / SAMPLE_RATE,
        getChannelData: () => channel,
        length: channel.length,
        numberOfChannels: 1,
        sampleRate: SAMPLE_RATE,
    };
}

function measureWithTrailingZeros(channel: Float32Array): number {
    const padded = new Float32Array(channel.length + TRUE_PEAK_TAIL_FRAMES);
    padded.set(channel);
    return measureTruePeak({ channels: [padded], length: padded.length });
}

describe('applyExportNormalization true-peak boundaries', () => {
    it.each([
        ['first', 0],
        ['last', SAMPLE_RATE - 1],
    ] as const)('holds the requested ceiling for an impulse at the %s frame', (_boundary, impulseIndex) => {
        const channel = new Float32Array(SAMPLE_RATE);
        channel[impulseIndex] = 1;

        const result = applyExportNormalization({
            buffer: makeBuffer(channel),
            targetLufs: -14,
            ceilingDbTp: CEILING_DBTP,
        });
        const normalizedTruePeak = measureWithTrailingZeros(channel);

        expect(result.measuredLufs).not.toBeNull();
        expect(Number.isFinite(result.measuredLufs)).toBe(true);
        expect(Number.isFinite(result.measuredTruePeakDbTp)).toBe(true);
        expect(Number.isFinite(result.appliedGain)).toBe(true);
        expect(result.limitedByCeiling).toBe(true);
        expect(normalizedTruePeak).toBeLessThanOrEqual(CEILING_LINEAR + FLOAT32_TOLERANCE);
    });

    it('leaves silence unchanged under the no-measurable-loudness unity policy', () => {
        const channel = new Float32Array(SAMPLE_RATE);

        const result = applyExportNormalization({
            buffer: makeBuffer(channel),
            targetLufs: -14,
            ceilingDbTp: CEILING_DBTP,
        });

        expect(result).toEqual({
            measuredLufs: null,
            measuredTruePeakDbTp: null,
            appliedGain: 1,
            limitedByCeiling: false,
        });
        expect(measureWithTrailingZeros(channel)).toBe(0);
    });
});
