import { describe, expect, it, vi } from 'vitest';

// --- Worklet global scope shims -------------------------------------------
// The processor runs in AudioWorklet global scope, which provides
// AudioWorkletProcessor and registerProcessor. Provide them so the real module
// can be imported and self-register (same harness shape as meteringProcessor).
const SAMPLE_RATE = 48_000;
/** 100 periods of 1 kHz, 300 of 3 kHz, and an exact multiple of a 12-sample hold. */
const FRAME_COUNT = 4800;
const TONE_HZ = 1000;
const BLOCK = 128;

const registry = new Map<string, new () => RateProcessorLike>();

class AudioWorkletProcessorShim {
    port = {
        onmessage: null as ((event: { data: unknown }) => void) | null,
        postMessage: vi.fn(),
    };
}

type RateProcessorLike = {
    process(inputs: Float32Array[][], outputs: Float32Array[][], parameters: Record<string, Float32Array>): boolean;
};

vi.stubGlobal('AudioWorkletProcessor', AudioWorkletProcessorShim);
vi.stubGlobal('registerProcessor', (name: string, proc: new () => RateProcessorLike) => {
    registry.set(name, proc);
});
vi.stubGlobal('sampleRate', SAMPLE_RATE);

async function loadProcessor(): Promise<RateProcessorLike> {
    await import('../bitcrusherRateProcessor');
    const Ctor = registry.get('bitcrusher-rate-processor');
    if (!Ctor) {
        throw new Error('bitcrusher-rate-processor was not registered');
    }
    return new Ctor();
}

function sine(frequency: number, frameCount: number): Float32Array {
    const signal = new Float32Array(frameCount);
    for (let index = 0; index < frameCount; index++) {
        signal[index] = Math.sin((2 * Math.PI * frequency * index) / SAMPLE_RATE);
    }
    return signal;
}

/**
 * Run a whole signal through the processor in 128-frame render quanta, exactly
 * as the audio thread would, so the hold state has to survive block boundaries.
 */
function runProcessor(processor: RateProcessorLike, input: Float32Array, rate: number): Float32Array {
    const output = new Float32Array(input.length);
    const rateParam = new Float32Array([rate]);
    for (let offset = 0; offset < input.length; offset += BLOCK) {
        const inBlock = input.subarray(offset, offset + BLOCK);
        const outBlock = new Float32Array(inBlock.length);
        processor.process([[inBlock]], [[outBlock]], { rate: rateParam });
        output.set(outBlock, offset);
    }
    return output;
}

/**
 * Single-bin DFT magnitude, normalised so a full-scale sine reads 0.5 in its
 * own bin. Used as the spectral discriminator: decimation is defined by the
 * images it folds in, so alias-bin energy is the direct evidence, where RMS
 * would barely move.
 */
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

describe('BitcrusherRateProcessor decimation', () => {
    it('folds an image into the alias bin that a bypassed rate leaves empty', async () => {
        const input = sine(TONE_HZ, FRAME_COUNT);

        // A 12x hold at 48 kHz resamples to 4 kHz, so a 1 kHz tone must produce
        // an image at 4000 - 1000 = 3000 Hz. Nothing else in this chain can put
        // energy there.
        const aliasHz = SAMPLE_RATE / 12 - TONE_HZ;

        const bypassed = runProcessor(await loadProcessor(), input, 1);
        const decimated = runProcessor(await loadProcessor(), input, 12);

        expect(binMagnitude(bypassed, aliasHz)).toBeLessThan(1e-6);
        expect(binMagnitude(decimated, aliasHz)).toBeGreaterThan(0.05);
    });

    it('passes the signal through untouched at the neutral rate of 1', async () => {
        const input = sine(TONE_HZ, BLOCK * 4);
        const output = runProcessor(await loadProcessor(), input, 1);
        expect(Array.from(output)).toEqual(Array.from(input));
    });

    it('holds each grabbed sample for exactly N frames across block boundaries', async () => {
        // A ramp makes the staircase readable directly: with a 4-sample hold the
        // output must be input[0],input[0],input[0],input[0],input[4],...
        const input = new Float32Array(BLOCK * 2);
        for (let index = 0; index < input.length; index++) {
            input[index] = index / input.length;
        }

        const output = runProcessor(await loadProcessor(), input, 4);

        for (let index = 0; index < input.length; index++) {
            expect(output[index]).toBeCloseTo(input[index - (index % 4)]!, 6);
        }
    });

    it('grabs every channel on the same frame so the stereo image survives', async () => {
        const processor = await loadProcessor();
        const left = new Float32Array(16);
        const right = new Float32Array(16);
        for (let index = 0; index < 16; index++) {
            left[index] = index;
            right[index] = -index;
        }
        const outL = new Float32Array(16);
        const outR = new Float32Array(16);

        processor.process([[left, right]], [[outL, outR]], { rate: new Float32Array([4]) });

        // Both channels must step at frames 0, 4, 8, 12 — never one lagging the
        // other, which would swing the phantom centre around.
        expect(Array.from(outL)).toEqual([0, 0, 0, 0, 4, 4, 4, 4, 8, 8, 8, 8, 12, 12, 12, 12]);
        expect(Array.from(outR)).toEqual([-0, -0, -0, -0, -4, -4, -4, -4, -8, -8, -8, -8, -12, -12, -12, -12]);
    });

    it('stays finite and never exceeds the input peak anywhere in the declared range', async () => {
        const input = sine(TONE_HZ, FRAME_COUNT);
        const inputPeak = Math.max(...Array.from(input, Math.abs));

        for (let rate = 1; rate <= 40; rate++) {
            const output = runProcessor(await loadProcessor(), input, rate);
            const finite = Array.from(output).every((sample) => Number.isFinite(sample));
            const peak = Math.max(...Array.from(output, Math.abs));
            expect(finite, `rate ${String(rate)} produced a non-finite sample`).toBe(true);
            expect(peak, `rate ${String(rate)} exceeded the input peak`).toBeLessThanOrEqual(inputPeak);
        }
    });
});
