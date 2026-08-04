import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * applyExportNormalization orchestrates measure → resolve → scale. We mock the
 * three delegates to test the orchestrator's glue logic in isolation: channel
 * extraction, in-place scaling, unity-gain skip, and the truePeak→dBTP conversion.
 */

const mocks = vi.hoisted(() => ({
    measureIntegratedLoudness: vi.fn(),
    measureTruePeak: vi.fn(),
    resolveNormalizationGain: vi.fn(),
}));

vi.mock('../measureIntegratedLoudness', () => ({
    measureIntegratedLoudness: mocks.measureIntegratedLoudness,
}));

vi.mock('../measureTruePeak', () => ({
    measureTruePeak: mocks.measureTruePeak,
}));

vi.mock('../resolveNormalizationGain', () => ({
    resolveNormalizationGain: mocks.resolveNormalizationGain,
}));

import { applyExportNormalization } from '../applyExportNormalization';

function makeBuffer(channels: Float32Array[], sampleRate = 48_000): AudioBuffer {
    return {
        numberOfChannels: channels.length,
        length: channels[0]!.length,
        sampleRate,
        getChannelData: (ch: number) => channels[ch]!,
        duration: channels[0]!.length / sampleRate,
    } as AudioBuffer;
}

beforeEach(() => {
    vi.clearAllMocks();
});

describe('applyExportNormalization — in-place gain scaling', () => {
    it('scales every channel sample by the resolved gain', () => {
        const left = new Float32Array([0.5, 0.5, 0.5]);
        const right = new Float32Array([0.3, 0.3, 0.3]);
        const buf = makeBuffer([left, right]);

        mocks.measureIntegratedLoudness.mockReturnValue(-20);
        mocks.measureTruePeak.mockReturnValue(0.5);
        mocks.resolveNormalizationGain.mockReturnValue({ gain: 2.0, limitedByCeiling: false });

        const result = applyExportNormalization({ buffer: buf, targetLufs: -14, ceilingDbTp: -1 });

        expect(result.appliedGain).toBe(2.0);
        // Each sample doubled.
        for (let i = 0; i < 3; i++) {
            expect(left[i]).toBeCloseTo(1.0, 5);
            expect(right[i]).toBeCloseTo(0.6, 5);
        }
    });

    it('skips the scaling loop entirely when gain === 1 (unity)', () => {
        const data = new Float32Array([0.7, 0.7, 0.7]);
        const buf = makeBuffer([data]);

        mocks.measureIntegratedLoudness.mockReturnValue(-14);
        mocks.measureTruePeak.mockReturnValue(0.5);
        mocks.resolveNormalizationGain.mockReturnValue({ gain: 1, limitedByCeiling: false });

        applyExportNormalization({ buffer: buf, targetLufs: -14, ceilingDbTp: -1 });

        // Data unchanged.
        for (let i = 0; i < 3; i++) {
            expect(data[i]).toBeCloseTo(0.7, 5);
        }
    });

    it('scales a mono buffer correctly', () => {
        const mono = new Float32Array([0.1, 0.2, 0.3]);
        const buf = makeBuffer([mono]);

        mocks.measureIntegratedLoudness.mockReturnValue(-30);
        mocks.measureTruePeak.mockReturnValue(0.3);
        mocks.resolveNormalizationGain.mockReturnValue({ gain: 0.5, limitedByCeiling: true });

        const result = applyExportNormalization({ buffer: buf, targetLufs: -14, ceilingDbTp: -1 });

        const expected = [0.05, 0.1, 0.15];
        for (let i = 0; i < 3; i++) {
            expect(mono[i]).toBeCloseTo(expected[i]!, 5);
        }
        expect(result.limitedByCeiling).toBe(true);
    });
});

describe('applyExportNormalization — truePeak to dBTP conversion', () => {
    it('converts a positive truePeak to dBTP via 20*log10', () => {
        const buf = makeBuffer([new Float32Array([0.5])]);
        mocks.measureIntegratedLoudness.mockReturnValue(-14);
        mocks.measureTruePeak.mockReturnValue(0.5);
        mocks.resolveNormalizationGain.mockReturnValue({ gain: 1, limitedByCeiling: false });

        const result = applyExportNormalization({ buffer: buf, targetLufs: -14, ceilingDbTp: -1 });
        // 20 * log10(0.5) ≈ -6.0206
        expect(result.measuredTruePeakDbTp).toBeCloseTo(-6.0206, 2);
    });

    it('returns null dBTP for silence (truePeak === 0)', () => {
        const buf = makeBuffer([new Float32Array([0, 0, 0])]);
        mocks.measureIntegratedLoudness.mockReturnValue(null);
        mocks.measureTruePeak.mockReturnValue(0);
        mocks.resolveNormalizationGain.mockReturnValue({ gain: 1, limitedByCeiling: false });

        const result = applyExportNormalization({ buffer: buf, targetLufs: -14, ceilingDbTp: -1 });
        expect(result.measuredTruePeakDbTp).toBeNull();
    });
});

describe('applyExportNormalization — delegate wiring', () => {
    it('passes channels, length, and sampleRate to measureIntegratedLoudness', () => {
        const buf = makeBuffer([new Float32Array([0.5, 0.5])], 96_000);
        mocks.measureIntegratedLoudness.mockReturnValue(-14);
        mocks.measureTruePeak.mockReturnValue(0.5);
        mocks.resolveNormalizationGain.mockReturnValue({ gain: 1, limitedByCeiling: false });

        applyExportNormalization({ buffer: buf, targetLufs: -14, ceilingDbTp: -1 });

        const call = mocks.measureIntegratedLoudness.mock.calls[0]?.[0];
        expect(call.length).toBe(2);
        expect(call.sampleRate).toBe(96_000);
        expect(call.channels).toHaveLength(1);
    });

    it('passes measured values and targets to resolveNormalizationGain', () => {
        const buf = makeBuffer([new Float32Array([0.5])]);
        mocks.measureIntegratedLoudness.mockReturnValue(-18);
        mocks.measureTruePeak.mockReturnValue(0.7);
        mocks.resolveNormalizationGain.mockReturnValue({ gain: 1.5, limitedByCeiling: true });

        applyExportNormalization({ buffer: buf, targetLufs: -14, ceilingDbTp: -0.5 });

        const call = mocks.resolveNormalizationGain.mock.calls[0]?.[0];
        expect(call.integratedLufs).toBe(-18);
        expect(call.truePeak).toBe(0.7);
        expect(call.targetLufs).toBe(-14);
        expect(call.ceilingDbTp).toBe(-0.5);
    });

    it('returns the measured LUFS from the delegate', () => {
        const buf = makeBuffer([new Float32Array([0.5])]);
        mocks.measureIntegratedLoudness.mockReturnValue(-22.5);
        mocks.measureTruePeak.mockReturnValue(0.5);
        mocks.resolveNormalizationGain.mockReturnValue({ gain: 1, limitedByCeiling: false });

        const result = applyExportNormalization({ buffer: buf, targetLufs: -14, ceilingDbTp: -1 });
        expect(result.measuredLufs).toBe(-22.5);
    });

    it('returns null measuredLufs for silence', () => {
        const buf = makeBuffer([new Float32Array([0])]);
        mocks.measureIntegratedLoudness.mockReturnValue(null);
        mocks.measureTruePeak.mockReturnValue(0);
        mocks.resolveNormalizationGain.mockReturnValue({ gain: 1, limitedByCeiling: false });

        const result = applyExportNormalization({ buffer: buf, targetLufs: -14, ceilingDbTp: -1 });
        expect(result.measuredLufs).toBeNull();
    });
});
