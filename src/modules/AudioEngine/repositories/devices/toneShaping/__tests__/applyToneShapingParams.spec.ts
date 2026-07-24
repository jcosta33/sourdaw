import { describe, expect, it } from 'vitest';

import { asBaseAudioContext, createMockAudioContext } from '../../../../../../helpers/__tests__/audioContext.mock';
import { type OfflineDeviceNode } from '../../types';
import { applyBitcrusherParams } from '../applyBitcrusherParams';
import { applyDeEsserParams } from '../applyDeEsserParams';
import { applyDistortionParams } from '../applyDistortionParams';
import { makeBitcrusherCurve } from '../makeBitcrusherCurve';
import { makeDistortionCurve } from '../makeDistortionCurve';
import { createBitcrusher } from '../createBitcrusher';
import { createDeEsser } from '../createDeEsser';
import { createDistortion } from '../createDistortion';

function param(node: unknown, property: string): { value: number } {
    const candidate = node ? Reflect.get(node as object, property) : null;
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
    it('applies threshold, freq and range (abs/2 clamped to >=1)', () => {
        const ctx = createMockAudioContext();
        const device = createDeEsser(asBaseAudioContext(ctx));
        applyDeEsserParams(device, { 'deess-threshold': -30, 'deess-freq': 7200, 'deess-range': 10 });
        expect(param(device.nodes[4], 'threshold').value).toBe(-30);
        expect(param(device.nodes[3], 'frequency').value).toBe(7200);
        expect(param(device.nodes[4], 'ratio').value).toBe(Math.max(1, Math.abs(10) / 2));
    });

    it('clamps ratio to a minimum of 1 for sub-zero range magnitudes', () => {
        const ctx = createMockAudioContext();
        const device = createDeEsser(asBaseAudioContext(ctx));
        applyDeEsserParams(device, { 'deess-range': -1 }); // |−1|/2 = 0.5 → clamped to 1
        expect(param(device.nodes[4], 'ratio').value).toBe(1);
    });

    it('leaves values untouched when params object is empty', () => {
        const ctx = createMockAudioContext();
        const device = createDeEsser(asBaseAudioContext(ctx));
        const before = param(device.nodes[4], 'threshold').value;
        applyDeEsserParams(device, {});
        expect(param(device.nodes[4], 'threshold').value).toBe(before);
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
