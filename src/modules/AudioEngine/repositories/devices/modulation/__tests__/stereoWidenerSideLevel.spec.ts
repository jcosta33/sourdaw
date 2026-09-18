import { describe, expect, it } from 'vitest';

import { asBaseAudioContext, createMockAudioContext } from '../../../../../../helpers/__tests__/audioContext.mock';
import { applyStereoWidenerParams } from '../applyStereoWidenerParams';
import { createStereoWidener } from '../createStereoWidener';

/**
 * Issue #3734 oracle: `width-side` advertised -12..+6 dB but no side-level
 * stage existed, so anti-phase input rendered identically at both extremes.
 * These tests walk the mid/side matrix the factory builds — reading every
 * gain from the graph's own nodes — and require the side level to change the
 * anti-phase render while the mono (mid) render stays put.
 */

const SAMPLE_RATE = 48_000;
const TONE_HZ = 1000;

type GainLike = { gain: { value: number } };

function makeDevice() {
    const ctx = createMockAudioContext();
    return createStereoWidener(asBaseAudioContext(ctx));
}

/**
 * Render the built matrix for a stereo input pair. Below the mono-bass
 * cutoff the highpass is transparent, so the wiring reduces to
 *   L' = midGain*mid + sideLevel*width*side
 *   R' = midGain*mid - sideLevel*width*side
 * with mid = (L+R)/2 and side = (L-R)/2, every factor read from the graph.
 */
function renderMatrix(device: ReturnType<typeof createStereoWidener>, left: Float32Array, right: Float32Array) {
    const nn = device.namedNodes!;
    const midGain = (nn.midGain as unknown as GainLike).gain.value;
    const sideGain = (nn.sideGain as unknown as GainLike).gain.value;
    const sideLevel = (nn.sideLevel as unknown as GainLike).gain.value;

    const outL = new Float32Array(left.length);
    const outR = new Float32Array(left.length);
    for (let index = 0; index < left.length; index++) {
        const mid = (left[index]! + right[index]!) / 2;
        const side = (left[index]! - right[index]!) / 2;
        outL[index] = midGain * mid + sideLevel * sideGain * side;
        outR[index] = midGain * mid - sideLevel * sideGain * side;
    }
    return { outL, outR };
}

function tone(): Float32Array {
    const signal = new Float32Array(SAMPLE_RATE / 4);
    for (let index = 0; index < signal.length; index++) {
        signal[index] = Math.sin((2 * Math.PI * TONE_HZ * index) / SAMPLE_RATE);
    }
    return signal;
}

function peak(signal: Float32Array): number {
    return signal.reduce((max, sample) => Math.max(max, Math.abs(sample)), 0);
}

function maxDelta(a: Float32Array, b: Float32Array): number {
    return a.reduce((max, sample, index) => Math.max(max, Math.abs(sample - b[index]!)), 0);
}

describe('stereo widener side level (#3734)', () => {
    it('puts a side-level stage after the width control in the side path', () => {
        const device = makeDevice();
        const nn = device.namedNodes!;
        const sideGain = nn.sideGain as unknown as { connectedTo: unknown[] };
        const sideLevel = nn.sideLevel as unknown as { connectedTo: unknown[] };

        expect(sideGain.connectedTo).toContain(nn.sideLevel);
        expect(sideLevel.connectedTo).toContain(nn.merger);
        expect(sideLevel.connectedTo).toContain(nn.sideInvert);
    });

    it('writes width-side as a dB-to-linear gain', () => {
        const device = makeDevice();
        const sideLevel = (device.namedNodes!.sideLevel as unknown as GainLike).gain;

        applyStereoWidenerParams(device, { 'width-side': 0 });
        expect(sideLevel.value).toBeCloseTo(1, 10);

        applyStereoWidenerParams(device, { 'width-side': -12 });
        expect(sideLevel.value).toBeCloseTo(10 ** (-12 / 20), 10);

        applyStereoWidenerParams(device, { 'width-side': 6 });
        expect(sideLevel.value).toBeCloseTo(10 ** (6 / 20), 10);
    });

    it('changes the anti-phase render with side level while the mid render stays put', () => {
        const antiLeft = tone();
        const antiRight = tone().map((sample) => -sample);
        const mono = tone();

        const cut = makeDevice();
        applyStereoWidenerParams(cut, { 'width-side': -12 });
        const boost = makeDevice();
        applyStereoWidenerParams(boost, { 'width-side': 6 });

        const cutAnti = renderMatrix(cut, antiLeft, antiRight);
        const boostAnti = renderMatrix(boost, antiLeft, antiRight);
        expect(maxDelta(cutAnti.outL, boostAnti.outL)).toBeGreaterThan(0.1);

        // The -12 dB side render must be genuinely quieter than the +6 dB one:
        // 18 dB apart across the knob's declared span.
        const ratio = peak(boostAnti.outL) / peak(cutAnti.outL);
        expect(ratio).toBeGreaterThan(10 ** (17 / 20));

        // Mono input carries no side energy: the side level must not touch it.
        const cutMono = renderMatrix(cut, mono, mono);
        const boostMono = renderMatrix(boost, mono, mono);
        expect(maxDelta(cutMono.outL, boostMono.outL)).toBe(0);
        expect(maxDelta(cutMono.outR, boostMono.outR)).toBe(0);
    });
});
