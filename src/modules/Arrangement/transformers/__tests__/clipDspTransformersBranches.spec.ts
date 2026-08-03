import { describe, it, expect } from 'vitest';

import { computeNormalizationScale } from '../clipDspTransformers';

/**
 * Deep numeric specs for computeNormalizationScale RMS and LUFS modes.
 * The existing spec only checks scale > 0 for these modes — never verifies
 * the dB conversion formula or the LUFS K-weighting filter.
 */

function makeBuffer(channels: Float32Array[], sampleRate = 48_000): AudioBuffer {
    return {
        numberOfChannels: channels.length,
        sampleRate,
        length: channels[0]!.length,
        getChannelData: (ch: number) => channels[ch]!,
        duration: channels[0]!.length / sampleRate,
    } as AudioBuffer;
}

describe('computeNormalizationScale — RMS exact values', () => {
    it('DC signal [0.5×4] at target -14 dB produces scale ≈ 0.400', () => {
        // rms = 0.5, rmsDb = 20*log10(0.5) ≈ -6.0206
        // gainDb = -14 - (-6.0206) = -7.9794
        // scale = 10^(-7.9794/20) ≈ 0.400
        const buf = makeBuffer([new Float32Array([0.5, 0.5, 0.5, 0.5])]);
        const scale = computeNormalizationScale(buf, 'rms', -14);
        expect(scale).toBeCloseTo(0.4, 1);
    });

    it('DC signal [0.5×4] at target -6 dB produces scale ≈ 1.0 (gainDb = 0)', () => {
        // rms = 0.5, rmsDb ≈ -6.0206, gainDb = -6 - (-6.0206) ≈ 0.0206
        // scale ≈ 10^(0.0206/20) ≈ 1.0024 ≈ 1.0
        const buf = makeBuffer([new Float32Array([0.5, 0.5, 0.5, 0.5])]);
        const scale = computeNormalizationScale(buf, 'rms', -6);
        expect(scale).toBeCloseTo(1.0, 1);
    });

    it('multi-channel aggregation: two channels [0.5,0.5] each → same rms as one [0.5×4]', () => {
        // sumSq = 4 * 0.25 = 1.0, totalSamples = 4 → rms = 0.5 (same as DC [0.5×4])
        const buf = makeBuffer([new Float32Array([0.5, 0.5]), new Float32Array([0.5, 0.5])]);
        const singleChannel = makeBuffer([new Float32Array([0.5, 0.5, 0.5, 0.5])]);
        const multiScale = computeNormalizationScale(buf, 'rms', -14);
        const singleScale = computeNormalizationScale(singleChannel, 'rms', -14);
        expect(multiScale).toBeCloseTo(singleScale!, 6);
    });

    it('higher RMS signal produces a smaller scale (more attenuation needed)', () => {
        const quiet = makeBuffer([new Float32Array([0.1, 0.1, 0.1, 0.1])]);
        const loud = makeBuffer([new Float32Array([0.9, 0.9, 0.9, 0.9])]);
        const quietScale = computeNormalizationScale(quiet, 'rms', -14);
        const loudScale = computeNormalizationScale(loud, 'rms', -14);
        // The louder signal needs more attenuation → smaller scale.
        expect(loudScale!).toBeLessThan(quietScale!);
    });

    it('defaults to target -14 dB when targetDb is omitted', () => {
        const buf = makeBuffer([new Float32Array([0.5, 0.5, 0.5, 0.5])]);
        const withTarget = computeNormalizationScale(buf, 'rms', -14);
        const withoutTarget = computeNormalizationScale(buf, 'rms');
        expect(withoutTarget).toBeCloseTo(withTarget!, 6);
    });

    it('returns null for silence', () => {
        const buf = makeBuffer([new Float32Array([0, 0, 0, 0])]);
        expect(computeNormalizationScale(buf, 'rms')).toBeNull();
    });
});

describe('computeNormalizationScale — LUFS K-weighting filter', () => {
    it('LUFS scale differs from RMS scale for high-frequency content', () => {
        // Alternating +0.5/-0.5 at 48kHz — the 2kHz high-pass in K-weighting
        // passes most of this, and the +4dB shelf boost increases energy,
        // so LUFS rms > RMS rms → LUFS gainDb is smaller → LUFS scale < RMS scale.
        const alternating = new Float32Array(2000);
        for (let i = 0; i < 2000; i++) {
            alternating[i] = i % 2 === 0 ? 0.5 : -0.5;
        }
        const buf = makeBuffer([alternating]);
        const rmsScale = computeNormalizationScale(buf, 'rms', -14);
        const lufsScale = computeNormalizationScale(buf, 'lufs', -14);
        expect(lufsScale!).toBeLessThan(rmsScale!);
    });

    it('LUFS converges to RMS for DC signal (filter steady state)', () => {
        // For a long DC signal, the one-pole LP converges to the DC value,
        // hp → 0, weighted = lpPrev = DC value. So LUFS rms ≈ DC rms.
        const dc = new Float32Array(10_000).fill(0.5);
        const buf = makeBuffer([dc]);
        const rmsScale = computeNormalizationScale(buf, 'rms', -14);
        const lufsScale = computeNormalizationScale(buf, 'lufs', -14);
        // After 10000 samples, the LP has fully converged. LUFS ≈ RMS.
        expect(lufsScale).toBeCloseTo(rmsScale!, 1);
    });

    it('LUFS with custom target -6 dB produces scale ≈ 1.0 for DC (steady state)', () => {
        const dc = new Float32Array(10_000).fill(0.5);
        const buf = makeBuffer([dc]);
        const scale = computeNormalizationScale(buf, 'lufs', -6);
        // LUFS rms ≈ 0.5, rmsDb ≈ -6.02, gainDb ≈ 0 → scale ≈ 1.0
        expect(scale).toBeCloseTo(1.0, 1);
    });

    it('LUFS defaults to target -14 dB when targetDb is omitted', () => {
        const dc = new Float32Array(10_000).fill(0.5);
        const buf = makeBuffer([dc]);
        const withTarget = computeNormalizationScale(buf, 'lufs', -14);
        const withoutTarget = computeNormalizationScale(buf, 'lufs');
        expect(withoutTarget).toBeCloseTo(withTarget!, 6);
    });

    it('returns null for silence', () => {
        const buf = makeBuffer([new Float32Array(1000).fill(0)]);
        expect(computeNormalizationScale(buf, 'lufs')).toBeNull();
    });
});

describe('computeNormalizationScale — peak mode exact values', () => {
    it('returns exactly 1/peak for peak mode', () => {
        const buf = makeBuffer([new Float32Array([0.25, -0.5, 0.3])]);
        const scale = computeNormalizationScale(buf, 'peak');
        // Peak = 0.5, scale = 1/0.5 = 2.0
        expect(scale).toBeCloseTo(2.0, 6);
    });

    it('multi-channel peak uses the global max across all channels', () => {
        const buf = makeBuffer([new Float32Array([0.1, 0.2]), new Float32Array([0.8, 0.3])]);
        const scale = computeNormalizationScale(buf, 'peak');
        // Peak = 0.8, scale = 1/0.8 = 1.25
        expect(scale).toBeCloseTo(1.25, 6);
    });
});
