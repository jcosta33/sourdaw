import { describe, expect, it } from 'vitest';

import { asBaseAudioContext, createMockAudioContext } from '../../../../../../helpers/__tests__/audioContext.mock';
import { applyBitcrusherParams } from '../applyBitcrusherParams';
import { applyDeEsserParams } from '../applyDeEsserParams';
import { applyDistortionParams } from '../applyDistortionParams';
import { createBitcrusher } from '../createBitcrusher';
import { createDeEsser } from '../createDeEsser';
import { createDistortion } from '../createDistortion';
import { makeBitcrusherCurve } from '../makeBitcrusherCurve';
import { makeDistortionCurve } from '../makeDistortionCurve';

function param(node: unknown, property: string): { value: number } {
    const candidate = node ? Reflect.get(node, property) : null;
    if (typeof candidate !== 'object' || candidate === null || !('value' in candidate)) {
        throw new Error(`Expected AudioParam at .${property}`);
    }
    return candidate as { value: number };
}

describe('applyDistortionParams', () => {
    it('applies drive (curve), tone, output (dB→gain) and mix', () => {
        const ctx = createMockAudioContext();
        const device = createDistortion(asBaseAudioContext(ctx));
        applyDistortionParams(device, {
            'dist-drive': 42,
            'dist-tone': 2500,
            'dist-output': -6,
            'dist-mix': 0.4,
        });
        const shaper = device.nodes[3] as unknown as WaveShaperNode;
        expect(shaper.curve).toEqual(makeDistortionCurve(42));
        expect(param(device.nodes[4], 'frequency').value).toBe(2500);
        expect(param(device.nodes[6], 'gain').value).toBeCloseTo(10 ** (-6 / 20));
        expect(param(device.nodes[2], 'gain').value).toBe(0.4);
        expect(param(device.nodes[1], 'gain').value).toBe(1 - 0.4);
    });

    it('leaves values untouched when params object is empty', () => {
        const ctx = createMockAudioContext();
        const device = createDistortion(asBaseAudioContext(ctx));
        const beforeTone = param(device.nodes[4], 'frequency').value;
        applyDistortionParams(device, {});
        expect(param(device.nodes[4], 'frequency').value).toBe(beforeTone);
    });
});

describe('applyDeEsserParams', () => {
    // Split-band graph (issue #3735): nodes are
    // [input, bandpass, controlGain, wet, cancel, listen, inputGain, output,
    //  absShaper, envFilter, threshLin, envSum, kneeShaper].
    it('applies threshold and detector frequency, and Range as a dB reduction limit', () => {
        const ctx = createMockAudioContext();
        const device = createDeEsser(asBaseAudioContext(ctx));
        applyDeEsserParams(device, { 'deess-threshold': -30, 'deess-freq': 7200, 'deess-range': -12 });
        // The threshold knob lands as the negated linear subtractor on the
        // envelope sum's constant source (see createDeEsser).
        expect(param(device.nodes[10], 'offset').value).toBeCloseTo(-(10 ** (-30 / 20)), 12);
        expect(param(device.nodes[1], 'frequency').value).toBe(7200);
        // Both band taps carry 10^(range/20): the reduction limit and the
        // cancellation weight are one law (see createDeEsser).
        expect(param(device.nodes[3], 'gain').value).toBeCloseTo(10 ** (-12 / 20), 12);
        expect(param(device.nodes[4], 'gain').value).toBeCloseTo(-(10 ** (-12 / 20)), 12);
    });

    it('does not let Range touch the threshold subtractor or the reduction curve', () => {
        const ctx = createMockAudioContext();
        const device = createDeEsser(asBaseAudioContext(ctx));
        const curveBefore = (device.nodes[12] as unknown as { curve: Float32Array }).curve;
        const offsetBefore = param(device.nodes[10], 'offset').value;
        applyDeEsserParams(device, { 'deess-range': -20 });
        // Range lives only on the two band taps; the reduction law above them
        // — the threshold subtractor and the reduction curve — must not move.
        expect(param(device.nodes[10], 'offset').value).toBe(offsetBefore);
        expect((device.nodes[12] as unknown as { curve: Float32Array }).curve).toBe(curveBefore);
    });

    it('leaves values untouched when params object is empty', () => {
        const ctx = createMockAudioContext();
        const device = createDeEsser(asBaseAudioContext(ctx));
        const before = param(device.nodes[10], 'offset').value;
        applyDeEsserParams(device, {});
        expect(param(device.nodes[10], 'offset').value).toBe(before);
    });
});

describe('applyBitcrusherParams', () => {
    it('applies bits (rounded, floored to 1) and mix', () => {
        const ctx = createMockAudioContext();
        const device = createBitcrusher(asBaseAudioContext(ctx));
        applyBitcrusherParams(device, { 'crush-bits': 5.7, 'crush-mix': 0.3 });
        const shaper = device.nodes[3] as unknown as WaveShaperNode;
        expect(shaper.curve).toEqual(makeBitcrusherCurve(Math.max(1, Math.round(5.7))));
        expect(param(device.nodes[2], 'gain').value).toBe(0.3);
        expect(param(device.nodes[1], 'gain').value).toBe(1 - 0.3);
    });

    it('clamps bits to a minimum of 1', () => {
        const ctx = createMockAudioContext();
        const device = createBitcrusher(asBaseAudioContext(ctx));
        applyBitcrusherParams(device, { 'crush-bits': -3 });
        const shaper = device.nodes[3] as unknown as WaveShaperNode;
        expect(shaper.curve).toEqual(makeBitcrusherCurve(1));
    });

    it('leaves values untouched when params object is empty', () => {
        const ctx = createMockAudioContext();
        const device = createBitcrusher(asBaseAudioContext(ctx));
        const before = param(device.nodes[1], 'gain').value;
        applyBitcrusherParams(device, {});
        expect(param(device.nodes[1], 'gain').value).toBe(before);
    });
});
