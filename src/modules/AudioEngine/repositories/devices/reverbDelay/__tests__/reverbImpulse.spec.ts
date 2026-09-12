import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    asBaseAudioContext,
    createMockAudioContext,
    type MockAudioContext,
    MockAudioBuffer,
} from '../../../../../../helpers/__tests__/audioContext.mock';
import { applyReverbParams } from '../applyReverbParams';
import { createReverb } from '../createReverb';
import { type ReverbImpulseShape } from '../reverbImpulse';

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

describe('reverb impulse rendering (#3731)', () => {
    it('renders decay-time semantics: the buffer runs to the declared -60 dB point', () => {
        const impulse = impulseOf(deviceWithShape({ size: 0.5, decay: 3, damping: 0.5 }));

        expect(impulse.sampleRate).toBe(SAMPLE_RATE);
        expect(impulse.length).toBe(SAMPLE_RATE * 3);

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

        expect(short.length).toBe(SAMPLE_RATE * 0.5);
        expect(long.length).toBe(SAMPLE_RATE * 8);

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
        expect(quiet.length).toBe(SAMPLE_RATE * 0.1);
        expect(vast.length).toBe(SAMPLE_RATE * 20);

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
        expect(afterDecay.length).toBe(SAMPLE_RATE * 5);

        // A damping-only write must keep the 5 s decay, not reset to default 2 s.
        applyReverbParams(dn, { 'rev-damping': 1 });
        expect(impulseOf(dn).length).toBe(SAMPLE_RATE * 5);
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

    it('clamps out-of-range writes to the declared parameter window', () => {
        const ctx = makeContext();
        const dn = createReverb(asBaseAudioContext(ctx));
        applyReverbParams(dn, { 'rev-decay': 500, 'rev-size': 7, 'rev-damping': -3 });
        expect(impulseOf(dn).length).toBe(SAMPLE_RATE * 20);
    });
});
