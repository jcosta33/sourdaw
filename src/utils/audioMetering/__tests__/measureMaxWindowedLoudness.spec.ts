import { describe, expect, it } from 'vitest';

import { measureMaxWindowedLoudness } from '../measureMaxWindowedLoudness';

const SAMPLE_RATE = 48_000;

/**
 * A 1 kHz sine whose amplitude is given in dBFS. BS.1770 is calibrated so a
 * stereo 1 kHz sine reads its own peak level in LUFS: a -23 dBFS sine in both
 * channels is -23 LUFS, which is what makes these expectations absolute figures
 * rather than comparisons against the implementation's own output.
 */
function sineAtDbfs(peakDbfs: number, length: number, startFrame = 0, target = new Float32Array(length)): Float32Array {
    const amplitude = 10 ** (peakDbfs / 20);
    for (let index = startFrame; index < length; index++) {
        target[index] = amplitude * Math.sin((2 * Math.PI * 1000 * index) / SAMPLE_RATE);
    }
    return target;
}

describe('measureMaxWindowedLoudness', () => {
    it('reads a steady -23 dBFS stereo sine as -23 LUFS over a 400 ms window', () => {
        const length = SAMPLE_RATE * 2;
        const tone = sineAtDbfs(-23, length);

        const result = measureMaxWindowedLoudness({
            channels: [tone, tone],
            length,
            sampleRate: SAMPLE_RATE,
            windowSeconds: 0.4,
        });

        expect(result).not.toBeNull();
        expect(Math.abs(result! - -23)).toBeLessThan(0.1);
    });

    it('measures one window over the whole signal when the window is longer than the material', () => {
        const length = SAMPLE_RATE * 2;
        const tone = sineAtDbfs(-23, length);

        const result = measureMaxWindowedLoudness({
            channels: [tone, tone],
            length,
            sampleRate: SAMPLE_RATE,
            windowSeconds: 3,
        });

        expect(result).not.toBeNull();
        expect(Math.abs(result! - -23)).toBeLessThan(0.1);
    });

    it('reports the loudest window, not the programme mean', () => {
        // Two seconds: -33 dBFS until 1 s, then -23 dBFS. The mean of the two
        // halves is about -27.6 LUFS, so an averaging implementation cannot
        // pass this.
        const length = SAMPLE_RATE * 2;
        const channel = new Float32Array(length);
        channel.set(sineAtDbfs(-33, SAMPLE_RATE));
        sineAtDbfs(-23, length, SAMPLE_RATE, channel);

        const result = measureMaxWindowedLoudness({
            channels: [channel, channel],
            length,
            sampleRate: SAMPLE_RATE,
            windowSeconds: 0.4,
        });

        expect(result).not.toBeNull();
        expect(Math.abs(result! - -23)).toBeLessThan(0.15);
    });

    it('returns null when there are no samples to measure', () => {
        expect(
            measureMaxWindowedLoudness({
                channels: [new Float32Array(0)],
                length: 0,
                sampleRate: SAMPLE_RATE,
                windowSeconds: 0.4,
            })
        ).toBeNull();
    });

    it('returns null for digital silence, which has no defined loudness', () => {
        const length = SAMPLE_RATE;

        expect(
            measureMaxWindowedLoudness({
                channels: [new Float32Array(length)],
                length,
                sampleRate: SAMPLE_RATE,
                windowSeconds: 0.4,
            })
        ).toBeNull();
    });
});
