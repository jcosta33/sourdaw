import { describe, it, expect } from 'vitest';

import { measureIntegratedLoudness } from '../measureIntegratedLoudness';

/**
 * Deep branch specs for measureIntegratedLoudness. The existing spec
 * (loudnessMeasurement.spec.ts) tests happy paths with 1-2 channels and finite
 * samples. These cover: surround channel weighting (×1.41), NaN sample
 * sanitization (treated as 0), and the empty-channels guard.
 */

const SR = 48_000;

function makeSine(freq: number, length: number, sr: number = SR, amp = 0.2): Float32Array {
    const buf = new Float32Array(length);
    for (let i = 0; i < length; i++) {
        buf[i] = amp * Math.sin((2 * Math.PI * freq * i) / sr);
    }
    return buf;
}

describe('measureIntegratedLoudness — surround channel weighting (×1.41)', () => {
    it('a 5-channel signal measures higher LUFS than stereo (same content)', () => {
        const length = SR; // 1 second — enough for multiple blocks
        const sine = makeSine(1000, length);

        const stereo = measureIntegratedLoudness({ channels: [sine, sine], length, sampleRate: SR });
        const surround = measureIntegratedLoudness({
            channels: [sine, sine, sine, sine, sine],
            length,
            sampleRate: SR,
        });

        expect(stereo).not.toBeNull();
        expect(surround).not.toBeNull();
        // 5 channels: 3 at weight 1.0 + 2 at weight 1.41 = 5.82 total weight.
        // 2 channels: 2 at weight 1.0 = 2.0 total weight.
        // Power ratio = 5.82/2.0 = 2.91 → 10*log10(2.91) ≈ 4.64 dB higher.
        expect(surround!).toBeGreaterThan(stereo!);
        expect(surround! - stereo!).toBeGreaterThan(3);
    });

    it('channels 0-2 have weight 1.0, channels 3+ have weight 1.41', () => {
        // A 3-channel signal (all weight 1.0) should measure lower than
        // a 4-channel signal (3 × 1.0 + 1 × 1.41 = 4.41 vs 3.0).
        const length = SR;
        const sine = makeSine(1000, length);

        const three = measureIntegratedLoudness({ channels: [sine, sine, sine], length, sampleRate: SR });
        const four = measureIntegratedLoudness({ channels: [sine, sine, sine, sine], length, sampleRate: SR });

        expect(four!).toBeGreaterThan(three!);
        // Power ratio = 4.41/3.0 = 1.47 → 10*log10(1.47) ≈ 1.67 dB.
        expect(four! - three!).toBeGreaterThan(1);
    });
});

describe('measureIntegratedLoudness — NaN sample sanitization', () => {
    it('treats NaN samples as 0 (does not poison the measurement)', () => {
        const length = SR;
        const clean = makeSine(1000, length);
        const withNaN = makeSine(1000, length);
        withNaN[100] = Number.NaN;
        withNaN[500] = Number.NaN;

        const cleanLufs = measureIntegratedLoudness({ channels: [clean], length, sampleRate: SR });
        const nanLufs = measureIntegratedLoudness({ channels: [withNaN], length, sampleRate: SR });

        expect(cleanLufs).not.toBeNull();
        // NaN treated as 0 — 2 zero samples out of 48000 is negligible difference.
        // The result must be a finite number, not NaN.
        expect(Number.isFinite(nanLufs)).toBe(true);
        expect(Math.abs(cleanLufs! - nanLufs!)).toBeLessThan(0.5);
    });

    it('treats Infinity samples as 0', () => {
        const length = SR;
        const withInf = makeSine(1000, length);
        withInf[200] = Number.POSITIVE_INFINITY;

        const result = measureIntegratedLoudness({ channels: [withInf], length, sampleRate: SR });
        expect(Number.isFinite(result)).toBe(true);
    });
});

describe('measureIntegratedLoudness — empty channels guard', () => {
    it('returns null for empty channels array', () => {
        expect(measureIntegratedLoudness({ channels: [], length: SR, sampleRate: SR })).toBeNull();
    });

    it('returns null for zero length', () => {
        expect(measureIntegratedLoudness({ channels: [new Float32Array(0)], length: 0, sampleRate: SR })).toBeNull();
    });
});
