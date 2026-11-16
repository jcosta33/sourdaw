import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    asAudioNode,
    asBaseAudioContext,
    createMockAudioContext,
    type MockAudioContext,
    MockAudioBuffer,
} from '../../../../../../helpers/__tests__/audioContext.mock';
import { type OfflineDeviceNode } from '../../types';
import { applyReverbParams } from '../applyReverbParams';
import { createReverb } from '../createReverb';
import { applyReverbImpulseShape, DEFAULT_REVERB_SHAPE, type ReverbImpulseShape } from '../reverbImpulse';

beforeEach(() => {
    vi.stubGlobal('AudioBuffer', MockAudioBuffer);
});

afterEach(() => {
    vi.unstubAllGlobals();
});

/**
 * Issue #3731 oracle: the builtin reverb declared Size, Decay and Damping but
 * the convolver always received one fixed two-second impulse, so every
 * combination of the three controls rendered bit-identical audio. These tests
 * render the wet path of the graph the factory actually builds — an impulse
 * into the convolver IS the impulse response — and require the controls to
 * change it in their declared directions, with Decay meeting its declared
 * decay-time semantics (unit `s`).
 */

const SAMPLE_RATE = 48_000;
/** Canonical decay of bucket 28, the bucket of 2 s: 1.025 ** 28. */
const DECAY_BUCKET_28_SEC = 1.025 ** 28;

/** A Decay write renders its bucket's canonical decay, within half a 2.5 % bucket step of the written value. */
function expectDecayLength(length: number, writtenSec: number, sampleRate = SAMPLE_RATE): void {
    expect(Math.abs(length / (writtenSec * sampleRate) - 1)).toBeLessThanOrEqual(0.0126);
}

function makeContext(): MockAudioContext {
    return createMockAudioContext();
}

function impulseOf(dn: ReturnType<typeof createReverb>): AudioBuffer {
    const convolver = dn.namedNodes?.convolver as ConvolverNode | undefined;
    if (!convolver?.buffer) {
        throw new Error('reverb graph carries no convolver buffer');
    }
    return convolver.buffer;
}

function observeBufferWrites(convolver: { buffer: AudioBuffer | null }) {
    let installed = convolver.buffer;
    const setter = vi.fn((buffer: AudioBuffer | null) => {
        installed = buffer;
    });
    Object.defineProperty(convolver, 'buffer', {
        get: () => installed,
        set: setter,
    });
    return setter;
}

/** RMS of the samples in a window. */
function rms(data: Float32Array, start: number, end: number): number {
    let sumSquares = 0;
    for (let index = start; index < end; index++) {
        sumSquares += data[index]! * data[index]!;
    }
    return Math.sqrt(sumSquares / Math.max(1, end - start));
}

/** Fraction of samples in a window that sit near silence. */
function silenceFraction(data: Float32Array, start: number, end: number, threshold: number): number {
    let quiet = 0;
    for (let index = start; index < end; index++) {
        if (Math.abs(data[index]!) < threshold) {
            quiet += 1;
        }
    }
    return quiet / (end - start);
}

function zeroCrossingsPerSample(data: Float32Array, start: number, end: number): number {
    let crossings = 0;
    for (let index = start + 1; index < end; index++) {
        if (data[index - 1]! < 0 !== data[index]! < 0) {
            crossings += 1;
        }
    }
    return crossings / (end - start);
}

/** Direct convolution of `input` with `impulse`: the wet path's render. */
function convolve(input: Float32Array, impulse: Float32Array): Float32Array {
    const output = new Float32Array(input.length + impulse.length - 1);
    for (let index = 0; index < input.length; index++) {
        const sample = input[index]!;
        if (sample === 0) {
            continue;
        }
        for (let tap = 0; tap < impulse.length; tap++) {
            output[index + tap] = output[index + tap]! + sample * impulse[tap]!;
        }
    }
    return output;
}

function shortBurst(): Float32Array {
    const burst = new Float32Array(256);
    for (let index = 0; index < burst.length; index++) {
        burst[index] = Math.sin((2 * Math.PI * 440 * index) / SAMPLE_RATE);
    }
    return burst;
}

function deviceWithShape(shape: Partial<ReverbImpulseShape>): ReturnType<typeof createReverb> {
    const ctx = makeContext();
    const dn = createReverb(asBaseAudioContext(ctx));
    const params: Record<string, number> = {};
    if (shape.size !== undefined) {
        params['rev-size'] = shape.size;
    }
    if (shape.decay !== undefined) {
        params['rev-decay'] = shape.decay;
    }
    if (shape.damping !== undefined) {
        params['rev-damping'] = shape.damping;
    }
    applyReverbParams(dn, params);
    return dn;
}

const LOW_RATE = 1_000;

function contentOf(buffer: AudioBuffer): number[][] {
    return [0, 1].map((channel) => Array.from(buffer.getChannelData(channel)));
}

function lowRateDevice(params: Record<string, number>, sampleRate = LOW_RATE): ReturnType<typeof createReverb> {
    const ctx = makeContext();
    ctx.sampleRate = sampleRate;
    const dn = createReverb(asBaseAudioContext(ctx));
    applyReverbParams(dn, params);
    return dn;
}

/**
 * Reads the unit value a Size or Damping write left installed: the impulse is
 * deterministic, so it is the 0.01 step whose fresh static render is identical.
 */
function installedUnitValue(dn: ReturnType<typeof createReverb>, key: 'rev-size' | 'rev-damping'): number {
    const installedBuffer = impulseOf(dn);
    const installed = contentOf(installedBuffer);
    for (let step = 0; step <= 100; step++) {
        const candidate = contentOf(impulseOf(lowRateDevice({ [key]: step / 100 }, installedBuffer.sampleRate)));
        if (JSON.stringify(candidate) === JSON.stringify(installed)) {
            return step / 100;
        }
    }
    throw new Error(`installed ${key} impulse matches no 0.01 step`);
}

function writeRamp(dn: ReturnType<typeof createReverb>, from: number, to: number): void {
    const ticks = 7_900;
    for (let tick = 0; tick <= ticks; tick++) {
        applyReverbParams(dn, { 'rev-decay': from + ((to - from) * tick) / ticks });
    }
}

describe('reverb impulse rendering (#3731)', () => {
    it('renders decay-time semantics: the buffer runs to the declared -60 dB point', () => {
        const impulse = impulseOf(deviceWithShape({ size: 0.5, decay: 3, damping: 0.5 }));

        expect(impulse.sampleRate).toBe(SAMPLE_RATE);
        expectDecayLength(impulse.length, 3);

        const data = impulse.getChannelData(0);
        // The envelope must fall from unity at the tail's start to -60 dB
        // (ratio 0.001) at the buffer end: the declared decay time.
        const tailStart = 1920; // size 0.5 → 0.04 s early window at 48 kHz
        const tailStartRms = rms(data, tailStart, tailStart + 480);
        expect(rms(data, impulse.length - 480, impulse.length) / tailStartRms).toBeLessThan(0.002);
        expect(rms(data, impulse.length - 480, impulse.length) / tailStartRms).toBeGreaterThan(0.0002);
    });

    it('changes the rendered wet path when Decay moves', () => {
        const short = impulseOf(deviceWithShape({ decay: 0.5 }));
        const long = impulseOf(deviceWithShape({ decay: 8 }));

        expectDecayLength(short.length, 0.5);
        expectDecayLength(long.length, 8);

        const shortRender = convolve(shortBurst(), short.getChannelData(0));
        const longRender = convolve(shortBurst(), long.getChannelData(0).subarray(0, short.length));
        const maxDelta = shortRender.reduce(
            (max, sample, index) => Math.max(max, Math.abs(sample - longRender[index]!)),
            0
        );
        expect(maxDelta).toBeGreaterThan(0);
    });

    it('changes the rendered wet path and the tone when Damping moves', () => {
        const open = impulseOf(deviceWithShape({ damping: 0 }));
        const dark = impulseOf(deviceWithShape({ damping: 1 }));

        // Same length, different tone: the damped tail crosses zero far less.
        expect(open.length).toBe(dark.length);
        const windowStart = Math.round(SAMPLE_RATE * 0.2);
        const windowEnd = Math.round(SAMPLE_RATE * 1.5);
        expect(zeroCrossingsPerSample(dark.getChannelData(0), windowStart, windowEnd)).toBeLessThan(
            zeroCrossingsPerSample(open.getChannelData(0), windowStart, windowEnd) * 0.8
        );

        const openRender = convolve(shortBurst(), open.getChannelData(0).subarray(0, SAMPLE_RATE));
        const darkRender = convolve(shortBurst(), dark.getChannelData(0).subarray(0, SAMPLE_RATE));
        const maxDelta = openRender.reduce(
            (max, sample, index) => Math.max(max, Math.abs(sample - darkRender[index]!)),
            0
        );
        expect(maxDelta).toBeGreaterThan(0);
    });

    it('changes the early-reflection structure and the render when Size moves', () => {
        const small = impulseOf(deviceWithShape({ size: 0 }));
        const large = impulseOf(deviceWithShape({ size: 1 }));

        // A large room spreads discrete early taps across a longer window: the
        // first 40 ms hold far more near-silence between taps.
        const windowEnd = Math.round(SAMPLE_RATE * 0.04);
        expect(silenceFraction(large.getChannelData(0), 0, windowEnd, 0.05)).toBeGreaterThan(
            silenceFraction(small.getChannelData(0), 0, windowEnd, 0.05) * 2
        );

        const smallRender = convolve(shortBurst(), small.getChannelData(0).subarray(0, SAMPLE_RATE));
        const largeRender = convolve(shortBurst(), large.getChannelData(0).subarray(0, SAMPLE_RATE));
        const maxDelta = smallRender.reduce(
            (max, sample, index) => Math.max(max, Math.abs(sample - largeRender[index]!)),
            0
        );
        expect(maxDelta).toBeGreaterThan(0);
    });

    it('renders differently across the extremes reported in the issue', () => {
        // The bug report: Size 0/Decay 0.1/Damping 0 vs Size 1/Decay 20/Damping 1
        // were indistinguishable. The full wet renders must now differ.
        const quiet = impulseOf(deviceWithShape({ size: 0, decay: 0.1, damping: 0 }));
        const vast = impulseOf(deviceWithShape({ size: 1, decay: 20, damping: 1 }));
        expectDecayLength(quiet.length, 0.1);
        expectDecayLength(vast.length, 20);

        const quietRender = convolve(shortBurst(), quiet.getChannelData(0));
        const vastRender = convolve(shortBurst(), vast.getChannelData(0).subarray(0, quiet.length));
        const maxDelta = quietRender.reduce(
            (max, sample, index) => Math.max(max, Math.abs(sample - vastRender[index]!)),
            0
        );
        expect(maxDelta).toBeGreaterThan(0);
    });

    it('merges a partial parameter write with the shape already installed', () => {
        const ctx = makeContext();
        const dn = createReverb(asBaseAudioContext(ctx));
        applyReverbParams(dn, { 'rev-decay': 5 });
        const afterDecay = impulseOf(dn);
        expectDecayLength(afterDecay.length, 5);

        // A damping-only write must keep the 5 s decay, not reset to default 2 s.
        applyReverbParams(dn, { 'rev-damping': 1 });
        expectDecayLength(impulseOf(dn).length, 5);
    });

    it('reuses one buffer per context and shape and stays deterministic across contexts', () => {
        const ctx = makeContext();
        const first = createReverb(asBaseAudioContext(ctx));
        const second = createReverb(asBaseAudioContext(ctx));
        const random = vi.spyOn(Math, 'random');

        expect(impulseOf(first)).toBe(impulseOf(second));
        expect(impulseOf(first).getChannelData(0)).not.toEqual(impulseOf(first).getChannelData(1));

        const otherCtx = makeContext();
        const elsewhere = createReverb(asBaseAudioContext(otherCtx));
        expect(impulseOf(first).getChannelData(0)).toEqual(impulseOf(elsewhere).getChannelData(0));

        expect(random).not.toHaveBeenCalled();
        random.mockRestore();
    });

    it('bounds the per-context shape cache: evicted shapes re-render, warm shapes stay shared', () => {
        // The cache shares one rendered buffer among convolvers of the same
        // shape, but it must not retain every shape a knob sweep produces:
        // past the capacity the oldest shape is evicted (its buffer identity
        // changes on re-render), while shapes still cached keep buffer identity
        // stable across convolvers and re-apply.
        const ctx = makeContext();
        const shapeParams = (index: number): Record<string, number> => ({
            'rev-size': 0.1 + index * 0.01,
            'rev-decay': 1,
            'rev-damping': 0,
        });

        const first = createReverb(asBaseAudioContext(ctx));
        applyReverbParams(first, shapeParams(0));
        const firstBuffer = impulseOf(first);

        for (let index = 1; index < 10; index++) {
            applyReverbParams(first, shapeParams(index));
        }
        const shapeNineBuffer = impulseOf(first);

        // The oldest shape was evicted by the later writes.
        applyReverbParams(first, shapeParams(0));
        expect(impulseOf(first)).not.toBe(firstBuffer);
        expect(impulseOf(first)).not.toBe(shapeNineBuffer);

        // A recent shape (the last write) is still cached: a second convolver
        // of the same shape shares the buffer object.
        const second = createReverb(asBaseAudioContext(ctx));
        applyReverbParams(second, shapeParams(9));
        expect(impulseOf(second)).toBe(shapeNineBuffer);
    });

    it.each([
        ['rev-size', 0.5001],
        ['rev-decay', 2.0001],
        ['rev-damping', 0.5001],
    ] as const)('skips allocation and installation for a warm equivalent %s: %s', (key, value) => {
        const ctx = makeContext();
        const dn = createReverb(asBaseAudioContext(ctx));
        const installed = impulseOf(dn);
        const setter = observeBufferWrites(dn.namedNodes!.convolver as ConvolverNode);

        applyReverbParams(dn, { [key]: value });

        expect(ctx.createBuffer).toHaveBeenCalledOnce();
        expect(setter.mock.calls.length).toBe(0);
        expect(impulseOf(dn)).toBe(installed);
    });

    it('skips allocation and installation for an equivalent shape after peers evict its shared buffer', () => {
        const ctx = makeContext();
        const dn = createReverb(asBaseAudioContext(ctx));
        const installed = impulseOf(dn);
        const setter = observeBufferWrites(dn.namedNodes!.convolver as ConvolverNode);
        const peer = createReverb(asBaseAudioContext(ctx));
        for (let index = 1; index <= 9; index++) {
            applyReverbParams(peer, { 'rev-decay': 2 + index });
        }
        expect(ctx.createBuffer).toHaveBeenCalledTimes(10);
        ctx.createBuffer.mockClear();

        applyReverbParams(dn, { 'rev-decay': 2.0001 });

        expect.soft(ctx.createBuffer).not.toHaveBeenCalled();
        expect.soft(setter.mock.calls.length).toBe(0);
        expect(impulseOf(dn) === installed).toBe(true);
    });

    it('merges later partial writes with the latest raw shape from an equivalent no-op', () => {
        const ctx = makeContext();
        ctx.sampleRate = 192_000;
        const dn = createReverb(asBaseAudioContext(ctx));
        const installed = impulseOf(dn);
        const setter = observeBufferWrites(dn.namedNodes!.convolver as ConvolverNode);

        applyReverbParams(dn, { 'rev-decay': 2.0001 });
        expect(setter.mock.calls.length).toBe(0);
        expect(impulseOf(dn)).toBe(installed);

        applyReverbParams(dn, { 'rev-damping': 0.8 });

        expect(setter).toHaveBeenCalledOnce();
        expect(impulseOf(dn).length).toBe(Math.round(ctx.sampleRate * DECAY_BUCKET_28_SEC));
        expect(impulseOf(dn)).not.toBe(installed);
    });

    it.each(['render', 'install'])('retries the first installation after a failed %s', (failure) => {
        const ctx = makeContext();
        const convolver = ctx.createConvolver();
        const node = asAudioNode(convolver);
        const dn: OfflineDeviceNode = {
            inputNode: node,
            outputNode: node,
            nodes: [node],
            namedNodes: { convolver: node },
        };
        const setter = observeBufferWrites(convolver);
        const error = new Error(`failed ${failure}`);
        const fail = () => {
            throw error;
        };
        if (failure === 'render') {
            ctx.createBuffer.mockImplementationOnce(fail);
        } else {
            setter.mockImplementationOnce(fail);
        }

        expect(() => applyReverbImpulseShape(dn, asBaseAudioContext(ctx), DEFAULT_REVERB_SHAPE)).toThrow(error);
        expect(convolver.buffer).toBeNull();

        applyReverbImpulseShape(dn, undefined, DEFAULT_REVERB_SHAPE);

        expect(convolver.buffer).not.toBeNull();
        expectDecayLength(impulseOf(dn).length, 2);
        expect(setter).toHaveBeenCalledTimes(failure === 'render' ? 1 : 2);
        expect(ctx.createBuffer).toHaveBeenCalledTimes(failure === 'render' ? 2 : 1);
    });

    it('retries a different-bucket installation without recording the failed shape', () => {
        const ctx = makeContext();
        const dn = createReverb(asBaseAudioContext(ctx));
        const installed = impulseOf(dn);
        const setter = observeBufferWrites(dn.namedNodes!.convolver as ConvolverNode);
        const error = new Error('failed install');
        setter.mockImplementationOnce(() => {
            throw error;
        });

        expect(() => applyReverbParams(dn, { 'rev-decay': 3 })).toThrow(error);
        expect(impulseOf(dn)).toBe(installed);
        applyReverbParams(dn, { 'rev-decay': 3 });

        expect(setter).toHaveBeenCalledTimes(2);
        expect(ctx.createBuffer).toHaveBeenCalledTimes(2);
        expectDecayLength(impulseOf(dn).length, 3);
    });

    /**
     * #6743: live automation writes a device parameter on every 10 ms
     * scheduler tick. A Decay ramp from 3.2 s to 11 s over 79 s (the demo's
     * "Chaos space decay" lane) moved the value past the old millisecond
     * bucket on every tick, so the main thread rendered and installed a
     * multi-second impulse a hundred times a second and stopped answering.
     * The impulse may follow the ramp only as often as the change is audible.
     */
    it.each([
        { key: 'rev-decay', from: 3.2, to: 11, maxRenders: 60 },
        { key: 'rev-size', from: 0, to: 0.97, maxRenders: 101 },
        { key: 'rev-damping', from: 0, to: 0.97, maxRenders: 101 },
    ] as const)('re-renders a continuous $key ramp per audible step, not per tick', ({ key, from, to, maxRenders }) => {
        const ctx = makeContext();
        // Size and Damping are only distinguishable per 0.01 step at a finer rate than Decay needs.
        ctx.sampleRate = key === 'rev-decay' ? 1_000 : 8_000;
        const dn = createReverb(asBaseAudioContext(ctx));
        ctx.createBuffer.mockClear();
        const ticks = 7_900;

        for (let tick = 0; tick <= ticks; tick++) {
            applyReverbParams(dn, { [key]: from + ((to - from) * tick) / ticks });
        }

        expect(ctx.createBuffer.mock.calls.length).toBeGreaterThan(1);
        expect(ctx.createBuffer.mock.calls.length).toBeLessThanOrEqual(maxRenders);
        if (key === 'rev-decay') {
            return;
        }
        // The installed shape must still follow the ramp to its end, within one step.
        expect(Math.abs(installedUnitValue(dn, key) - to)).toBeLessThanOrEqual(0.01);
    });

    it('keeps the installed Decay within an inaudible distance of the end of a ramp', () => {
        const ctx = makeContext();
        ctx.sampleRate = 1_000;
        const dn = createReverb(asBaseAudioContext(ctx));
        const ticks = 7_900;

        for (let tick = 0; tick <= ticks; tick++) {
            applyReverbParams(dn, { 'rev-decay': 3.2 + (7.8 * tick) / ticks });
        }

        // 5 % is the just-noticeable difference of reverberation time (ISO 3382-1, Annex A).
        expect(Math.abs(impulseOf(dn).length / (11 * ctx.sampleRate) - 1)).toBeLessThan(0.05);
    });

    describe('canonical bucket impulse', () => {
        it('installs for a written value what a fresh context renders for it, after a descending ramp', () => {
            const ramped = lowRateDevice({});
            writeRamp(ramped, 11, 3.2);

            const fresh = lowRateDevice({ 'rev-decay': 3.2 });

            expect(impulseOf(ramped).length).toBe(impulseOf(fresh).length);
            expect(contentOf(impulseOf(ramped))).toEqual(contentOf(impulseOf(fresh)));
        });

        it('installs the same impulse for a static write after a ramp entered the bucket at another value', () => {
            const ramped = lowRateDevice({});
            // The ramp passes through 2.02 s, inside the bucket of 2.0 s.
            writeRamp(ramped, 1.5, 2.02);
            applyReverbParams(ramped, { 'rev-decay': 2 });

            const fresh = lowRateDevice({ 'rev-decay': 2 });

            expect(impulseOf(ramped).length).toBe(impulseOf(fresh).length);
            expect(contentOf(impulseOf(ramped))).toEqual(contentOf(impulseOf(fresh)));
        });

        it('installs identical buffers in two contexts with different histories reaching one written value', () => {
            const live = lowRateDevice({});
            writeRamp(live, 1.5, 2.02);
            applyReverbParams(live, { 'rev-decay': 2.01 });

            const offline = lowRateDevice({ 'rev-decay': 2.01 });

            expect(impulseOf(live)).not.toBe(impulseOf(offline));
            expect(contentOf(impulseOf(live))).toEqual(contentOf(impulseOf(offline)));
        });
    });

    it('clamps out-of-range writes to the declared parameter window', () => {
        const ctx = makeContext();
        const dn = createReverb(asBaseAudioContext(ctx));
        applyReverbParams(dn, { 'rev-decay': 500, 'rev-size': 7, 'rev-damping': -3 });
        expectDecayLength(impulseOf(dn).length, 20);
    });
});
