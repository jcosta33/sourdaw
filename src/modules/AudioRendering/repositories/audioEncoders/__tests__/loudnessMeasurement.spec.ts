import { describe, expect, it } from 'vitest';

import { createKWeightingFilters } from '../createKWeightingFilters';
import { measureIntegratedLoudness } from '../measureIntegratedLoudness';
import { measureTruePeak } from '../measureTruePeak';

function createSine({
    frequency,
    amplitude,
    seconds,
    sampleRate,
    phase = 0,
}: {
    frequency: number;
    amplitude: number;
    seconds: number;
    sampleRate: number;
    phase?: number;
}): Float32Array {
    const length = Math.round(seconds * sampleRate);
    const samples = new Float32Array(length);
    for (let index = 0; index < length; index++) {
        samples[index] = amplitude * Math.sin((2 * Math.PI * frequency * index) / sampleRate + phase);
    }
    return samples;
}

function toDb(linear: number): number {
    return 20 * Math.log10(linear);
}

describe('K-weighting coefficient derivation', () => {
    it('reproduces the published BS.1770-4 coefficients at 48 kHz', () => {
        const { shelf, highPass } = createKWeightingFilters(48_000);

        // ITU-R BS.1770-4, Tables 1 and 2.
        expect(shelf.b0).toBeCloseTo(1.53512485958697, 10);
        expect(shelf.b1).toBeCloseTo(-2.69169618940638, 10);
        expect(shelf.b2).toBeCloseTo(1.19839281085285, 10);
        expect(shelf.a1).toBeCloseTo(-1.69065929318241, 10);
        expect(shelf.a2).toBeCloseTo(0.73248077421585, 10);

        expect(highPass.a1).toBeCloseTo(-1.99004745483398, 10);
        expect(highPass.a2).toBeCloseTo(0.99007225036688, 10);
    });

    it('moves the filter with the sample rate instead of reusing the 48 kHz design', () => {
        const at48k = createKWeightingFilters(48_000);
        const at44k1 = createKWeightingFilters(44_100);

        // Same analogue prototype, different discrete-time coefficients. Reusing
        // the 48 kHz numbers at 44.1 kHz would shift both corners and bias every
        // reading taken at the default export rate.
        expect(at44k1.shelf.a1).not.toBeCloseTo(at48k.shelf.a1, 6);
        expect(at44k1.highPass.a1).not.toBeCloseTo(at48k.highPass.a1, 6);
    });
});

describe('measureIntegratedLoudness', () => {
    // BS.1770-4 compliance case: a 1 kHz sine at -20 dBFS in both channels of a
    // stereo programme must read -20 LUFS. This is the check that catches a
    // wrong offset, wrong channel weighting, or a mis-derived filter.
    it.each([48_000, 44_100, 96_000])('reads a -20 dBFS 1 kHz stereo sine as -20 LUFS at %i Hz', (sampleRate) => {
        const amplitude = Math.pow(10, -20 / 20);
        const channel = createSine({ frequency: 1000, amplitude, seconds: 5, sampleRate });

        const lufs = measureIntegratedLoudness({
            channels: [channel, channel],
            length: channel.length,
            sampleRate,
        });

        expect(lufs).not.toBeNull();
        expect(lufs!).toBeCloseTo(-20, 1);
    });

    it('tracks a level change of a known size', () => {
        const sampleRate = 48_000;
        const quiet = createSine({ frequency: 1000, amplitude: Math.pow(10, -26 / 20), seconds: 5, sampleRate });

        const lufs = measureIntegratedLoudness({ channels: [quiet, quiet], length: quiet.length, sampleRate });

        // 6 dB below the -20 LUFS reference case.
        expect(lufs!).toBeCloseTo(-26, 1);
    });

    it('returns null for digital silence rather than a huge negative number', () => {
        const silence = new Float32Array(48_000 * 2);

        expect(
            measureIntegratedLoudness({ channels: [silence, silence], length: silence.length, sampleRate: 48_000 })
        ).toBeNull();
    });

    it('returns null when the material is shorter than one gating block', () => {
        const tooShort = createSine({ frequency: 1000, amplitude: 0.5, seconds: 0.2, sampleRate: 48_000 });

        expect(
            measureIntegratedLoudness({ channels: [tooShort], length: tooShort.length, sampleRate: 48_000 })
        ).toBeNull();
    });

    it('gates out a quiet passage so it cannot drag the programme loudness down', () => {
        const sampleRate = 48_000;
        const loud = createSine({ frequency: 1000, amplitude: Math.pow(10, -20 / 20), seconds: 5, sampleRate });
        const withSilentTail = new Float32Array(loud.length * 2);
        withSilentTail.set(loud, 0);

        const gated = measureIntegratedLoudness({
            channels: [withSilentTail, withSilentTail],
            length: withSilentTail.length,
            sampleRate,
        });

        // Half the programme is silence, which an ungated mean would charge
        // against the loudness: the block powers would average to half, landing
        // near -23 LUFS. The gate keeps the answer on the programme material,
        // within a few tenths of a dB of the -20 LUFS reference — the residual
        // is the handful of blocks straddling the transition, which are
        // genuinely part-silent.
        expect(gated!).toBeGreaterThan(-20.5);
        expect(gated!).toBeLessThan(-19.5);
    });
});

describe('measureTruePeak', () => {
    it('reports a peak above the sample peak when the waveform reconstructs higher between samples', () => {
        const sampleRate = 48_000;
        // A sine at fs/4 sampled 45 degrees off the crest: every sample sits at
        // 1/sqrt(2) of the true amplitude, so sample peak understates by ~3 dB.
        const channel = createSine({
            frequency: sampleRate / 4,
            amplitude: 1,
            seconds: 0.1,
            sampleRate,
            phase: Math.PI / 4,
        });

        let samplePeak = 0;
        for (const sample of channel) {
            samplePeak = Math.max(samplePeak, Math.abs(sample));
        }

        const truePeak = measureTruePeak({ channels: [channel], length: channel.length });

        expect(toDb(samplePeak)).toBeCloseTo(-3.01, 1);
        // The inter-sample maximum is the real amplitude, ~0 dBFS.
        expect(toDb(truePeak)).toBeGreaterThan(-0.5);
        expect(truePeak).toBeGreaterThan(samplePeak);
    });

    it('leaves a slow full-scale signal essentially unchanged', () => {
        const channel = createSine({ frequency: 100, amplitude: 0.5, seconds: 0.2, sampleRate: 48_000 });

        const truePeak = measureTruePeak({ channels: [channel], length: channel.length });

        // Heavily oversampled already, so reconstruction adds almost nothing.
        expect(truePeak).toBeGreaterThan(0.49);
        expect(truePeak).toBeLessThan(0.52);
    });

    it('returns 0 for silence', () => {
        const silence = new Float32Array(1024);

        expect(measureTruePeak({ channels: [silence], length: silence.length })).toBe(0);
    });

    it('measures the loudest channel of a multi-channel programme', () => {
        const quiet = createSine({ frequency: 100, amplitude: 0.1, seconds: 0.1, sampleRate: 48_000 });
        const loud = createSine({ frequency: 100, amplitude: 0.8, seconds: 0.1, sampleRate: 48_000 });

        const peak = measureTruePeak({ channels: [quiet, loud], length: quiet.length });

        expect(peak).toBeGreaterThan(0.79);
        expect(peak).toBeLessThan(0.82);
    });
});
