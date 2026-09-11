import { describe, expect, it } from 'vitest';

import { createLufsMeterReader } from '../lufsMeterReader';

/**
 * The builtin LUFS meter's reader: each `read()` consumes one analyser block
 * and feeds three window accumulators. These tests drive the reader with a
 * fake analyser and require the window selection to change which measurement
 * the readout reports — the property `lufs-window` exists to control.
 */

const SAMPLE_RATE = 48_000;
const FFT_SIZE = 2048;

function fakeAnalyser(blockValue: number) {
    return {
        fftSize: FFT_SIZE,
        getFloatTimeDomainData: (buffer: Float32Array) => {
            buffer.fill(blockValue);
        },
    };
}

describe('lufs meter reader', () => {
    it('reads digital silence as the floor', () => {
        const reader = createLufsMeterReader(fakeAnalyser(0), SAMPLE_RATE);
        const reading = reader.read();
        expect(reading.value).toBe(-70);
        expect(reading.momentary).toBe(-70);
        expect(reading.shortTerm).toBe(-70);
        expect(reading.integrated).toBe(-70);
    });

    it('reports a plausible loudness for a full-scale block', () => {
        // Mean square 1 (constant full-scale) → -0.691 + 10·log10(1) ≈ -0.7.
        const reader = createLufsMeterReader(fakeAnalyser(1), SAMPLE_RATE);
        const reading = reader.read();
        expect(reading.value).toBeCloseTo(-0.691, 2);
    });

    it('selects the measured window from the lufs-window index', () => {
        // A hot short-term ring followed by quiet blocks: the momentary ring
        // drains to the floor within 400 ms while the 3 s ring stays loud, so
        // the window selection genuinely changes the reported measurement.
        let loud = true;
        const reader = createLufsMeterReader(
            {
                fftSize: FFT_SIZE,
                getFloatTimeDomainData: (buffer: Float32Array) => {
                    buffer.fill(loud ? 0.5 : 0);
                },
            },
            SAMPLE_RATE
        );
        for (let index = 0; index < 70; index++) {
            reader.read();
        }
        loud = false;
        for (let index = 0; index < 10; index++) {
            reader.read();
        }

        reader.setWindow(0);
        const momentary = reader.read();
        expect(momentary.window).toBe('momentary');
        expect(momentary.value).toBe(momentary.momentary);
        expect(momentary.value).toBeLessThan(momentary.shortTerm);

        reader.setWindow(1);
        const shortTerm = reader.read();
        expect(shortTerm.window).toBe('shortTerm');
        expect(shortTerm.value).toBe(shortTerm.shortTerm);

        reader.setWindow(2);
        const integrated = reader.read();
        expect(integrated.window).toBe('integrated');
        expect(integrated.value).toBe(integrated.integrated);
        expect(integrated.value).toBeGreaterThan(-70);
    });

    it('clamps an out-of-range window index into the descriptor choices', () => {
        const reader = createLufsMeterReader(fakeAnalyser(0), SAMPLE_RATE);
        reader.setWindow(99);
        expect(reader.window()).toBe('integrated');
        reader.setWindow(-5);
        expect(reader.window()).toBe('momentary');
    });

    it('averages the short-term window in energy, not loudness', () => {
        const ringBlocks = Math.round(3 / (FFT_SIZE / SAMPLE_RATE));
        // Half the window loud, half silent: an energy average sits 3 dB below
        // the all-loud reading; a loudness average would sit ~0 dB below it.
        const blockValues: number[] = [
            ...Array.from({ length: Math.floor(ringBlocks / 2) }, () => 1),
            ...Array.from({ length: Math.ceil(ringBlocks / 2) }, () => 0),
        ];
        let call = 0;
        const reader = createLufsMeterReader(
            {
                fftSize: FFT_SIZE,
                getFloatTimeDomainData: (buffer: Float32Array) => {
                    buffer.fill(blockValues[Math.min(call, blockValues.length - 1)]!);
                    call += 1;
                },
            },
            SAMPLE_RATE
        );

        reader.setWindow(1);
        let reading: ReturnType<typeof reader.read>;
        for (let index = 0; index < ringBlocks; index++) {
            reading = reader.read();
        }
        expect(reading!.shortTerm).toBeCloseTo(-0.691 - 3.01, 1);
    });
});
