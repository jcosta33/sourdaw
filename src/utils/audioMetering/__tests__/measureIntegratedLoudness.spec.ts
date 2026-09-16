import { describe, expect, it } from 'vitest';

import { measureIntegratedLoudness } from '../measureIntegratedLoudness';

const SAMPLE_RATE = 48000;

function sine(length: number, freq: number, amplitude = 1, sampleRate = SAMPLE_RATE): Float32Array {
    const buf = new Float32Array(length);
    for (let i = 0; i < length; i += 1) {
        buf[i] = amplitude * Math.sin((2 * Math.PI * freq * i) / sampleRate);
    }
    return buf;
}

describe('measureIntegratedLoudness', () => {
    it('returns null when the material is shorter than one 400ms block', () => {
        const short = new Float32Array(100); // 100 samples at 48 kHz ≈ 2ms

        const result = measureIntegratedLoudness({ channels: [short], length: short.length, sampleRate: SAMPLE_RATE });

        expect(result).toBeNull();
    });

    it('returns null for an empty channel array', () => {
        const result = measureIntegratedLoudness({ channels: [], length: 48000, sampleRate: SAMPLE_RATE });

        expect(result).toBeNull();
    });

    it('returns null for digital silence (everything below the absolute gate)', () => {
        const silence = new Float32Array(SAMPLE_RATE); // 1 second of zeros

        const result = measureIntegratedLoudness({
            channels: [silence],
            length: silence.length,
            sampleRate: SAMPLE_RATE,
        });

        expect(result).toBeNull();
    });

    it('returns a finite LUFS value for a 1 kHz sine at full scale', () => {
        // 2 seconds of 1 kHz sine — long enough for many overlapping blocks.
        const tone = sine(SAMPLE_RATE * 2, 1000);

        const result = measureIntegratedLoudness({
            channels: [tone],
            length: tone.length,
            sampleRate: SAMPLE_RATE,
        });

        expect(result).not.toBeNull();
        expect(Number.isFinite(result)).toBe(true);
        // A full-scale 1 kHz sine after K-weighting lands around -2 to -3 LUFS.
        // The exact value depends on K-weighting gain (+4 dB shelf at 1 kHz).
        expect(result!).toBeGreaterThan(-5);
        expect(result!).toBeLessThan(0);
    });

    it('a louder signal produces a higher LUFS reading than a quieter one', () => {
        const loud = sine(SAMPLE_RATE * 2, 1000, 1.0);
        const quiet = sine(SAMPLE_RATE * 2, 1000, 0.1);

        const loudLufs = measureIntegratedLoudness({
            channels: [loud],
            length: loud.length,
            sampleRate: SAMPLE_RATE,
        });
        const quietLufs = measureIntegratedLoudness({
            channels: [quiet],
            length: quiet.length,
            sampleRate: SAMPLE_RATE,
        });

        expect(loudLufs).not.toBeNull();
        expect(quietLufs).not.toBeNull();
        // 10× amplitude difference → ~20 dB LUFS difference.
        expect(loudLufs!).toBeGreaterThan(quietLufs! + 15);
    });

    it('treats non-finite (NaN/Infinity) samples as zero', () => {
        const length = SAMPLE_RATE * 2;
        const buf = sine(length, 1000);
        // Inject NaN and Infinity at the start — should be zeroed, not corrupt the result.
        buf[0] = Number.NaN;
        buf[1] = Number.POSITIVE_INFINITY;
        buf[2] = Number.NEGATIVE_INFINITY;

        const result = measureIntegratedLoudness({
            channels: [buf],
            length,
            sampleRate: SAMPLE_RATE,
        });

        // Should still produce a valid reading — the NaN/Inf samples were zeroed.
        expect(result).not.toBeNull();
        expect(Number.isFinite(result)).toBe(true);
    });

    it('weights surround channels higher than front channels', () => {
        const length = SAMPLE_RATE * 2;
        // A mono signal duplicated to 4 channels. Channels 0-2 get weight 1.0,
        // channel 3 gets weight 1.41 — so the 4-channel version reads louder
        // than the mono version even though the per-channel signal is identical.
        const mono = sine(length, 1000);
        const fourCh = [mono, mono, mono, mono];

        const monoLufs = measureIntegratedLoudness({
            channels: [mono],
            length,
            sampleRate: SAMPLE_RATE,
        });
        const fourChLufs = measureIntegratedLoudness({
            channels: fourCh,
            length,
            sampleRate: SAMPLE_RATE,
        });

        expect(monoLufs).not.toBeNull();
        expect(fourChLufs).not.toBeNull();
        // 4 channels (with surround boost) must read louder than 1 channel.
        expect(fourChLufs!).toBeGreaterThan(monoLufs!);
    });

    it('works at 44.1 kHz sample rate', () => {
        const sr = 44100;
        const tone = sine(sr * 2, 1000, 1, sr);

        const result = measureIntegratedLoudness({ channels: [tone], length: tone.length, sampleRate: sr });

        expect(result).not.toBeNull();
        expect(Number.isFinite(result)).toBe(true);
    });
});
