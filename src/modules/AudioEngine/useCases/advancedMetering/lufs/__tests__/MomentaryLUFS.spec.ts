import { describe, expect, it } from 'vitest';

import { MomentaryLUFS } from '../MomentaryLUFS';

/**
 * The BS.1770-4 reference-tone suite, restated from the Rust meter's own
 * (`a_minus_23_dbfs_stereo_tone_reads_minus_23_lufs` in
 * crates/daw-dsp/src/proof/metering.rs): a 48 kHz 1 kHz sine at -23 dBFS on
 * both channels of a stereo programme must read -23.0 LUFS. The old path this
 * replaces measured that tone at -41.96.
 */

const SAMPLE_RATE = 48_000;
/** EBU Tech 3341's tolerance on a loudness reading. */
const TOLERANCE_LU = 0.1;

/**
 * K-weighting power gain at the case frequencies, in dB, evaluated from
 * BS.1770-4's own filter definition — the Table 1/2 coefficients at 48 kHz
 * that `createKWeightingFilters` is pinned to reproduce. The -0.691 offset
 * exists to cancel the 1 kHz gain, so a -23 dBFS tone reads -23.0 there; at
 * every other frequency the reading carries the gain whole:
 * `reading = -23 dBFS + gain - 0.691`.
 */
const K_GAIN_DB = { at1kHz: 0.6977, at100Hz: -1.1335, at10kHz: 4.0419 } as const;

/** Peak amplitude of a sine at `dbfs` dBFS — full scale is peak 1.0. */
function peakAmplitude(dbfs: number): number {
    return 10 ** (dbfs / 20);
}

/** The Rust harness rounds each sample through f32; so does this. */
function toneSample(n: number, frequencyHz: number, amplitude: number): number {
    return Math.fround(amplitude * Math.sin((2 * Math.PI * frequencyHz * n) / SAMPLE_RATE));
}

/**
 * Momentary reading of a steady tone placed on both channels, pushed the way
 * the master tap delivers it (256-sample chunks), read after two seconds so
 * the 400 ms window holds nothing but the tone.
 */
function momentaryOf(amplitude: number, frequencyHz: number): number {
    const meter = new MomentaryLUFS(SAMPLE_RATE);
    const chunkSize = 256;
    const totalFrames = 2 * SAMPLE_RATE;
    const left = new Float32Array(chunkSize);
    const right = new Float32Array(chunkSize);
    for (let start = 0; start < totalFrames; start += chunkSize) {
        for (let index = 0; index < chunkSize; index++) {
            const sample = toneSample(start + index, frequencyHz, amplitude);
            left[index] = sample;
            right[index] = sample;
        }
        meter.push(left, right);
    }
    return meter.value;
}

describe('MomentaryLUFS — BS.1770-4 reference tones', () => {
    it('reads the -23 dBFS 1 kHz stereo reference tone as -23.0 LUFS', () => {
        const measured = momentaryOf(peakAmplitude(-23), 1000);
        expect(Math.abs(measured - -23)).toBeLessThanOrEqual(TOLERANCE_LU);
    });

    it('reads a full-scale 1 kHz stereo tone as 0 LUFS — the calibration identity', () => {
        // The standard's identity: -0.691 + 10·log10(2 · 0.5 · 10^0.0691) = 0.
        // It holds only with the channel energies summed — the averaged form
        // reads -3.01.
        const measured = momentaryOf(peakAmplitude(0), 1000);
        expect(Math.abs(measured - 0)).toBeLessThanOrEqual(TOLERANCE_LU);
    });

    it('reads a -23 dBFS stereo tone at 100 Hz with the K-weighting gain the standard states there', () => {
        // Expected: -23 dBFS - 1.1335 dB (K gain at 100 Hz) - 0.691 offset
        // = -24.82. The one-pole fake this replaces read 100 Hz some 16 LU
        // off its 1 kHz reading; K-weighting dips under 2 LU there.
        const measured = momentaryOf(peakAmplitude(-23), 100);
        expect(Math.abs(measured - (-23 + K_GAIN_DB.at100Hz - 0.691))).toBeLessThanOrEqual(TOLERANCE_LU);
    });

    it('reads a -23 dBFS stereo tone at 10 kHz with the K-weighting gain the standard states there', () => {
        // Expected: -23 dBFS + 4.0419 dB (K gain at 10 kHz) - 0.691 offset
        // = -19.65 — the shelf's high-frequency emphasis, which the fake's
        // flat-ish +1 dB approximation hid.
        const measured = momentaryOf(peakAmplitude(-23), 10_000);
        expect(Math.abs(measured - (-23 + K_GAIN_DB.at10kHz - 0.691))).toBeLessThanOrEqual(TOLERANCE_LU);
    });

    it.each([
        ['100 Hz', 100, K_GAIN_DB.at100Hz - K_GAIN_DB.at1kHz],
        ['10 kHz', 10_000, K_GAIN_DB.at10kHz - K_GAIN_DB.at1kHz],
    ])(
        'shapes the %s reading relative to the 1 kHz reading by the K curve (%.4f dB)',
        (_, frequencyHz, relativeGainDb) => {
            const at1kHz = momentaryOf(peakAmplitude(-23), 1000);
            const measured = momentaryOf(peakAmplitude(-23), frequencyHz);
            expect(Math.abs(measured - at1kHz - relativeGainDb)).toBeLessThanOrEqual(TOLERANCE_LU);
        }
    );

    it('reads a mono signal doubled to both channels three decibels louder', () => {
        // BS.1770-4 sums channel energies; averaging them would report the two
        // as equal and hide a 3.01 LU miscalibration on every stereo reading.
        const chunkSize = 256;
        const totalFrames = 2 * SAMPLE_RATE;
        const mono = new MomentaryLUFS(SAMPLE_RATE);
        const doubled = new MomentaryLUFS(SAMPLE_RATE);
        const left = new Float32Array(chunkSize);
        const silent = new Float32Array(chunkSize);
        const right = new Float32Array(chunkSize);
        for (let start = 0; start < totalFrames; start += chunkSize) {
            for (let index = 0; index < chunkSize; index++) {
                left[index] = toneSample(start + index, 1000, peakAmplitude(-20));
            }
            right.set(left);
            mono.push(left, silent);
            doubled.push(left, right);
        }
        const expectedGap = 10 * Math.log10(2);
        expect(Math.abs(doubled.value - mono.value - expectedGap)).toBeLessThanOrEqual(TOLERANCE_LU);
    });
});

describe('MomentaryLUFS — streaming window', () => {
    const chunkSize = 256;
    const windowFrames = Math.round(0.4 * SAMPLE_RATE);

    function meterWithTone(framesOfTone: number, amplitude = peakAmplitude(-23)): MomentaryLUFS {
        const meter = new MomentaryLUFS(SAMPLE_RATE);
        const left = new Float32Array(chunkSize);
        const right = new Float32Array(chunkSize);
        for (let start = 0; start < framesOfTone; start += chunkSize) {
            for (let index = 0; index < chunkSize; index++) {
                left[index] = toneSample(start + index, 1000, amplitude);
            }
            right.set(left);
            meter.push(left, right);
        }
        return meter;
    }

    it('reports the window as unfilled until a whole 400 ms has been pushed', () => {
        const partial = meterWithTone(windowFrames - chunkSize);
        expect(partial.filled).toBe(false);

        const full = meterWithTone(windowFrames);
        expect(full.filled).toBe(true);
    });

    it('divides a filling window by the full window length, so early readings ramp from silence', () => {
        // Half a window of steady tone: the energy is half of full, i.e. 3.01 LU
        // below the settled -23 reading, minus a little for the filter's start-up.
        const half = meterWithTone(windowFrames / 2);
        expect(half.value).toBeGreaterThan(-27);
        expect(half.value).toBeLessThan(-25);
    });

    it('flushes a tone out of the window once silence replaces it', () => {
        const meter = meterWithTone(SAMPLE_RATE);
        expect(meter.filled).toBe(true);

        const silence = new Float32Array(chunkSize);
        for (let pushed = 0; pushed < 2 * windowFrames; pushed += chunkSize) {
            meter.push(silence, silence);
        }
        expect(meter.value).toBe(-70);
    });

    it('treats a non-finite sample as silence instead of poisoning the running sums', () => {
        const meter = meterWithTone(windowFrames);
        const poisoned = new Float32Array(chunkSize);
        for (let index = 0; index < chunkSize; index++) {
            poisoned[index] = toneSample(index, 1000, peakAmplitude(-23));
        }
        poisoned[0] = Number.NaN;
        for (let pushed = 0; pushed < windowFrames; pushed += chunkSize) {
            meter.push(poisoned, poisoned);
        }
        expect(Number.isFinite(meter.value)).toBe(true);
        expect(meter.value).toBeGreaterThan(-70);
    });
});
