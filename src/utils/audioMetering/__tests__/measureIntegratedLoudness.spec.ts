import { describe, expect, it, vi } from 'vitest';

import * as biquad from '../applyBiquad';
import {
    createIntegratedLoudnessAccumulator,
    measureIntegratedLoudness,
    type MeasureIntegratedLoudnessInput,
} from '../measureIntegratedLoudness';

import { createMainMeteringInput, mainMeteringReference } from './mainMeteringReference';

const SAMPLE_RATE = 48000;

function sine(length: number, freq: number, amplitude = 1, sampleRate = SAMPLE_RATE): Float32Array {
    const buf = new Float32Array(length);
    for (let i = 0; i < length; i += 1) {
        buf[i] = amplitude * Math.sin((2 * Math.PI * freq * i) / sampleRate);
    }
    return buf;
}

function measureStreamingReplay({ channels, length, sampleRate }: MeasureIntegratedLoudnessInput) {
    function replay(chunkFrames: number, relativeGatePower?: number) {
        const meter = createIntegratedLoudnessAccumulator({
            numberOfChannels: channels.length,
            sampleRate,
            relativeGatePower,
        });
        for (let start = 0; start < length; start += chunkFrames) {
            meter.push(channels.map((channel) => channel.subarray(start, start + chunkFrames)));
        }
        return meter;
    }

    const absoluteGate = replay(997);
    return {
        absoluteLufs: absoluteGate.integratedLufs(),
        integratedLufs: replay(4096, absoluteGate.relativeGatePower()).integratedLufs(),
    };
}

function measureBufferedWork(input: MeasureIntegratedLoudnessInput) {
    const filter = vi.spyOn(biquad, 'applyBiquad');
    try {
        const integratedLufs = measureIntegratedLoudness(input);
        const framesFiltered = filter.mock.calls.reduce((frames, [samples]) => frames + samples.length, 0);
        return { integratedLufs, framesFiltered };
    } finally {
        filter.mockRestore();
    }
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
        // Identical content in every channel, so the difference is exactly the
        // weight ratio: 10*log10(4.41/1.0) = 6.444 dB. Weighting channel 3 as a
        // front channel gives 10*log10(4) = 6.021 dB, which "reads louder than
        // mono" alone does not exclude.
        expect(Math.abs(fourChLufs! - monoLufs! - 10 * Math.log10(4.41))).toBeLessThan(0.02);
    });

    it('works at 44.1 kHz sample rate', () => {
        const sr = 44100;
        const tone = sine(sr * 2, 1000, 1, sr);

        const result = measureIntegratedLoudness({ channels: [tone], length: tone.length, sampleRate: sr });

        expect(result).not.toBeNull();
        expect(Number.isFinite(result)).toBe(true);
    });

    it('matches both strict gates with one filter pass over ragged, non-finite stereo', () => {
        const length = SAMPLE_RATE * 3 + 71;
        const quietFrames = SAMPLE_RATE * 2;
        const left = sine(length, 740, 0.4);
        const right = sine(length - 567, 1230, 0.16);
        for (let frame = 0; frame < quietFrames; frame++) {
            left[frame] = left[frame]! * 0.015;
            right[frame] = right[frame]! * 0.03;
        }
        left[4095] = Number.NaN;
        right[4097] = Number.POSITIVE_INFINITY;
        const paddedRight = new Float32Array(length);
        paddedRight.set(right);
        const expected = measureStreamingReplay({ channels: [left, paddedRight], length, sampleRate: SAMPLE_RATE });

        const measured = measureBufferedWork({ channels: [left, right], length, sampleRate: SAMPLE_RATE });

        expect(expected.integratedLufs).not.toBe(expected.absoluteLufs);
        expect(measured.integratedLufs).toBe(expected.integratedLufs);
        expect(measured.framesFiltered).toBe(length * 2 * 2);
    });

    it.each([
        { blocks: 4096, passes: 1 },
        { blocks: 4097, passes: 2 },
    ])('preserves exact LUFS and uses $passes filter passes for $blocks blocks', ({ blocks, passes }) => {
        const sampleRate = 8_003;
        const blockFrames = Math.round(0.4 * sampleRate);
        const stepFrames = Math.round(0.1 * sampleRate);
        const length = blockFrames + (blocks - 1) * stepFrames;
        const input = { channels: [sine(length, 1_000, 0.1, sampleRate)], length, sampleRate };
        const expected = measureStreamingReplay(input);

        const measured = measureBufferedWork(input);

        expect(measured.integratedLufs).toBe(expected.integratedLufs);
        expect(measured.framesFiltered).toBe(length * 2 * passes);
    });
});

// The two replay passes must retain filter/window carry without retaining programme-length arrays.
describe('incremental integrated loudness', () => {
    it.each(mainMeteringReference)('preserves the original batch $name at $rate Hz', (reference) => {
        const input = createMainMeteringInput(reference);
        expect(input.inputSha256).toBe(reference.inputSha256);
        const actual = measureIntegratedLoudness({ ...input, sampleRate: reference.rate });
        if (reference.integratedLufs === null) {
            expect(actual).toBeNull();
        } else {
            expect(actual).toBeCloseTo(reference.integratedLufs, 10);
        }
    });
    it('matches the calibrated batch law across arbitrary partitions and both gates', () => {
        const tone = sine(SAMPLE_RATE * 4, 1000, 0.1);
        tone.fill(0, SAMPLE_RATE, SAMPLE_RATE * 2);
        const channels = [tone, tone];
        const first = createIntegratedLoudnessAccumulator({ numberOfChannels: 2, sampleRate: SAMPLE_RATE });
        for (let frame = 0; frame < tone.length; frame += 997) {
            first.push(channels.map((c) => c.subarray(frame, frame + 997)));
        }
        const relativeGatePower = first.relativeGatePower();
        const second = createIntegratedLoudnessAccumulator({
            numberOfChannels: 2,
            sampleRate: SAMPLE_RATE,
            relativeGatePower,
        });
        for (let frame = 0; frame < tone.length; frame += 4096) {
            second.push(channels.map((c) => c.subarray(frame, frame + 4096)));
        }
        expect(second.integratedLufs()).toBeCloseTo(
            measureIntegratedLoudness({ channels, length: tone.length, sampleRate: SAMPLE_RATE })!,
            9
        );
        const continuous = sine(SAMPLE_RATE * 2, 1000, 0.1);
        expect(
            measureIntegratedLoudness({
                channels: [continuous, continuous],
                length: continuous.length,
                sampleRate: SAMPLE_RATE,
            })
        ).toBeCloseTo(-20, 1);
    });
});
