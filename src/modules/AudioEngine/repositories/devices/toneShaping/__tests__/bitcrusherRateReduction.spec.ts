import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { asBaseAudioContext, createMockAudioContext } from '../../../../../../helpers/__tests__/audioContext.mock';
import { applyBitcrusherParams } from '../applyBitcrusherParams';
import { createBitcrusher } from '../createBitcrusher';

/**
 * Rate reduction is the one part of the bitcrusher that cannot live in the
 * WaveShaper: sample-and-hold is stateful and a shaper curve is memoryless. It
 * rides on an AudioWorkletNode instead, and these tests cover the whole chain —
 * the factory builds that node into the wet path, `applyBitcrusherParams`
 * writes `crush-rate` onto it, and the wet path the device declares actually
 * comes out decimated.
 *
 * `crush-rate` shipped for a long time as a declared, preset-driven, automatable
 * parameter that no engine code read. The spectral assertion is the guard that
 * the knob does something; the write assertion is the guard that it reaches the
 * engine at all, so it cannot quietly go dead again.
 */

const SAMPLE_RATE = 48_000;
const TONE_HZ = 1000;
/** 100 periods of 1 kHz, 300 of 3 kHz, an exact multiple of a 12-frame hold. */
const FRAME_COUNT = 4800;
const BLOCK = 128;
/** A 12x hold at 48 kHz resamples to 4 kHz, imaging a 1 kHz tone at 4000 - 1000. */
const ALIAS_HZ = SAMPLE_RATE / 12 - TONE_HZ;

type ProcessorLike = {
    process(inputs: Float32Array[][], outputs: Float32Array[][], parameters: Record<string, Float32Array>): boolean;
};

const registry = new Map<string, new () => ProcessorLike>();

class AudioWorkletProcessorShim {
    port = { onmessage: null, postMessage: vi.fn() };
}

class StubAudioWorkletNode {
    public readonly parameters = new Map<string, { value: number }>([['rate', { value: 1 }]]);
    public readonly connect = vi.fn();
    public readonly disconnect = vi.fn();

    constructor(
        _context: BaseAudioContext,
        public readonly processorName: string
    ) {}
}

function findDecimator(device: { nodes: unknown[] }): StubAudioWorkletNode | undefined {
    return device.nodes.find((node) => node instanceof StubAudioWorkletNode);
}

function rateOf(node: StubAudioWorkletNode | undefined): number {
    const rate = node?.parameters.get('rate');
    if (!rate) {
        throw new Error('device exposes no `rate` AudioParam — crush-rate reaches no engine node');
    }
    return rate.value;
}

function sine(frameCount: number): Float32Array {
    const signal = new Float32Array(frameCount);
    for (let index = 0; index < frameCount; index++) {
        signal[index] = Math.sin((2 * Math.PI * TONE_HZ * index) / SAMPLE_RATE);
    }
    return signal;
}

/** WaveShaperNode's own mapping: [-1,1] onto the curve with linear interpolation. */
function applyShaperCurve(curve: Float32Array, input: Float32Array): Float32Array {
    const output = new Float32Array(input.length);
    const last = curve.length - 1;
    for (let index = 0; index < input.length; index++) {
        const position = Math.min(last, Math.max(0, ((input[index]! + 1) / 2) * last));
        const lower = Math.floor(position);
        const upper = Math.min(last, lower + 1);
        output[index] = curve[lower]! + (position - lower) * (curve[upper]! - curve[lower]!);
    }
    return output;
}

async function loadProcessor(): Promise<new () => ProcessorLike> {
    await import('../../../../services/bitcrusherRateProcessor');
    const Ctor = registry.get('bitcrusher-rate-processor');
    if (!Ctor) {
        throw new Error('bitcrusher-rate-processor was not registered');
    }
    return Ctor;
}

/**
 * Render `input` through the wet path the *device* declares: its shaper curve,
 * then whatever rate-reduction node it built, at the rate it is holding. A
 * device that builds no such node renders shaper-only — which is exactly the
 * behaviour under test.
 */
async function renderDeviceWetPath(device: { nodes: unknown[] }, input: Float32Array): Promise<Float32Array> {
    const shaper = device.nodes[3] as { curve: Float32Array };
    const shaped = applyShaperCurve(shaper.curve, input);

    const decimator = findDecimator(device);
    if (!decimator) {
        return shaped;
    }

    const Ctor = await loadProcessor();
    const processor = new Ctor();
    const rateParam = new Float32Array([rateOf(decimator)]);
    const output = new Float32Array(shaped.length);
    for (let offset = 0; offset < shaped.length; offset += BLOCK) {
        const inBlock = shaped.subarray(offset, offset + BLOCK);
        const outBlock = new Float32Array(inBlock.length);
        processor.process([[inBlock]], [[outBlock]], { rate: rateParam });
        output.set(outBlock, offset);
    }
    return output;
}

/** Normalised single-bin DFT magnitude; a full-scale sine reads 0.5 in its own bin. */
function binMagnitude(signal: Float32Array, frequency: number): number {
    let real = 0;
    let imaginary = 0;
    for (let index = 0; index < signal.length; index++) {
        const angle = (2 * Math.PI * frequency * index) / SAMPLE_RATE;
        real += signal[index]! * Math.cos(angle);
        imaginary -= signal[index]! * Math.sin(angle);
    }
    return Math.hypot(real, imaginary) / signal.length;
}

describe('bitcrusher rate reduction', () => {
    beforeEach(() => {
        vi.stubGlobal('AudioWorkletProcessor', AudioWorkletProcessorShim);
        vi.stubGlobal('registerProcessor', (name: string, proc: new () => ProcessorLike) => {
            registry.set(name, proc);
        });
        vi.stubGlobal('sampleRate', SAMPLE_RATE);
        vi.stubGlobal('AudioWorkletNode', StubAudioWorkletNode);
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('folds an image into the alias bin that the same device at rate 1 leaves empty', async () => {
        const ctx = createMockAudioContext();
        const input = sine(FRAME_COUNT);

        const bypassed = createBitcrusher(asBaseAudioContext(ctx));
        applyBitcrusherParams(bypassed, { 'crush-bits': 16, 'crush-rate': 1, 'crush-mix': 1 });
        const engaged = createBitcrusher(asBaseAudioContext(ctx));
        applyBitcrusherParams(engaged, { 'crush-bits': 16, 'crush-rate': 12, 'crush-mix': 1 });

        const bypassedOut = await renderDeviceWetPath(bypassed, input);
        const engagedOut = await renderDeviceWetPath(engaged, input);

        expect(binMagnitude(bypassedOut, ALIAS_HZ)).toBeLessThan(1e-4);
        expect(binMagnitude(engagedOut, ALIAS_HZ)).toBeGreaterThan(0.05);
    });

    it('keeps the wet path finite and inside the input peak across the declared range', async () => {
        const ctx = createMockAudioContext();
        const input = sine(FRAME_COUNT);

        for (const rate of [1, 2, 7, 12, 23, 39, 40]) {
            const device = createBitcrusher(asBaseAudioContext(ctx));
            applyBitcrusherParams(device, { 'crush-bits': 4, 'crush-rate': rate, 'crush-mix': 1 });
            const output = await renderDeviceWetPath(device, input);

            const label = `rate ${String(rate)}`;
            expect(Array.from(output).every(Number.isFinite), `${label} went non-finite`).toBe(true);
            expect(Math.max(...Array.from(output, Math.abs)), `${label} overshot`).toBeLessThanOrEqual(1);
        }
    });

    it('routes the decimator between the shaper and the wet gain', () => {
        const ctx = createMockAudioContext();
        const device = createBitcrusher(asBaseAudioContext(ctx));

        const shaper = device.nodes[3];
        const wet = device.nodes[2];
        const decimator = findDecimator(device);

        expect(decimator, 'createBitcrusher built no rate-reduction node').toBeDefined();
        expect((shaper as unknown as { connectedTo: unknown[] }).connectedTo).toContain(decimator);
        expect(decimator?.connect).toHaveBeenCalledWith(wet);
    });

    it('writes crush-rate onto the engine node so the control cannot go dead again', () => {
        const ctx = createMockAudioContext();
        const device = createBitcrusher(asBaseAudioContext(ctx));

        applyBitcrusherParams(device, { 'crush-rate': 12 });

        expect(rateOf(findDecimator(device))).toBe(12);
    });

    it('holds crush-rate to the declared 1..40 range', () => {
        const ctx = createMockAudioContext();
        const device = createBitcrusher(asBaseAudioContext(ctx));

        applyBitcrusherParams(device, { 'crush-rate': 0.4 });
        expect(rateOf(findDecimator(device))).toBe(1);

        applyBitcrusherParams(device, { 'crush-rate': 99 });
        expect(rateOf(findDecimator(device))).toBe(40);
    });

    it('still builds a working device when AudioWorkletNode is unavailable', () => {
        vi.stubGlobal('AudioWorkletNode', undefined);
        const ctx = createMockAudioContext();
        const device = createBitcrusher(asBaseAudioContext(ctx));

        // The graph degrades to shaper -> wet; crush-bits and crush-mix must
        // still land, and writing crush-rate must not throw.
        expect(() => {
            applyBitcrusherParams(device, { 'crush-bits': 6, 'crush-rate': 12, 'crush-mix': 0.3 });
        }).not.toThrow();
        expect(findDecimator(device)).toBeUndefined();
        expect((device.nodes[2] as unknown as { gain: { value: number } }).gain.value).toBe(0.3);
    });
});
