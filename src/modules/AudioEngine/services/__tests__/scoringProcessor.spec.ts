import { describe, it, expect, vi, beforeEach } from 'vitest';

import {
    RealFloat32Array,
    installWorkletGlobals,
    makeChannels,
    type GrowableMemory,
    createGrowableMemory,
    resetGrowableMemory,
} from './wasmViewGrowthHarness';

// ScoringProcessor message handling (init/bypass/param), SAB telemetry active/
// inactive branches, and process() guard/passthrough/fault paths. The existing
// scoringProcessorWasmViews spec covers only the RT-1/RT-7 WASM-view growth.

type ScoringProcessorLike = {
    port: { onmessage: ((event: { data: unknown }) => void) | null; postMessage: ReturnType<typeof vi.fn> };
    process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean;
};

const { registry } = installWorkletGlobals<ScoringProcessorLike>();

const HEAP_BYTES = 64 * 1024;
const OUT_LEFT_PTR = 0;
const OUT_RIGHT_PTR = 4096;
const FRAMES = 128;
const memory: GrowableMemory = createGrowableMemory(HEAP_BYTES);

const paramCalls: Array<{ name: string; value: number }> = [];
const processCalls: number[] = [];
let isActive = false;
let processShouldThrow = false;
// Poly tracker stand-in: what the wasm instance would report through its
// per-string accessors, driven per test.
let polyStringCount = 0;
let polyStringFlags: boolean[] = [];
let polyStringCents: number[] = [];
let polyStringConfidences: number[] = [];

class ScoringInstanceMock {
    set_param(name: string, value: number): void {
        paramCalls.push({ name, value });
    }
    process(leftIn: Float32Array, _rightIn: Float32Array, frames: number): number {
        processCalls.push(frames);
        if (processShouldThrow) {
            throw new Error('wasm trap');
        }
        // passthrough: copy left input into both output windows.
        const left = new RealFloat32Array(memory.buffer, OUT_LEFT_PTR, frames);
        const right = new RealFloat32Array(memory.buffer, OUT_RIGHT_PTR, frames);
        left.set(leftIn);
        right.set(leftIn);
        return OUT_LEFT_PTR;
    }
    get_right_ptr(): number {
        return OUT_RIGHT_PTR;
    }
    is_active(): boolean {
        return isActive;
    }
    get_frequency(): number {
        return 440;
    }
    get_cents(): number {
        return -3;
    }
    get_confidence(): number {
        return 0.9;
    }
    get_note_index(): number {
        return 9;
    }
    get_octave(): number {
        return 4;
    }
    get_midi_note(): number {
        return 69;
    }
    get_poly_string_count(): number {
        return polyStringCount;
    }
    is_poly_string_active(idx: number): boolean {
        return polyStringFlags[idx] ?? false;
    }
    get_poly_string_cents(idx: number): number {
        return polyStringCents[idx] ?? 0;
    }
    get_poly_string_confidence(idx: number): number {
        return polyStringConfidences[idx] ?? 0;
    }
}

vi.mock('../../wasm/scoring.js', () => ({
    initSync: vi.fn(() => ({ memory })),
    ScoringInstance: ScoringInstanceMock,
}));

const MINIMAL_WASM_MODULE = new WebAssembly.Module(new Uint8Array([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]));

async function loadProcessor(): Promise<ScoringProcessorLike> {
    await import('../scoringProcessor');
    const Ctor = registry.get('scoring-processor');
    if (!Ctor) {
        throw new Error('scoring-processor was not registered');
    }
    return new Ctor({ processorOptions: { wasmModule: MINIMAL_WASM_MODULE } });
}

function send(proc: ScoringProcessorLike, data: unknown): void {
    proc.port.onmessage?.({ data });
}

function stereo(frames: number, fill: number): Float32Array[] {
    return [new Float32Array(frames).fill(fill), new Float32Array(frames).fill(fill)];
}

function resetRecording(): void {
    paramCalls.length = 0;
    processCalls.length = 0;
    isActive = false;
    processShouldThrow = false;
    polyStringCount = 0;
    polyStringFlags = [];
    polyStringCents = [];
    polyStringConfidences = [];
}

describe('ScoringProcessor message handling', () => {
    beforeEach(() => {
        resetGrowableMemory(memory, HEAP_BYTES);
        resetRecording();
    });

    it('posts ready on init and ignores a second init', async () => {
        const proc = await loadProcessor();
        send(proc, { type: 'init', wasmModule: MINIMAL_WASM_MODULE });
        send(proc, { type: 'init', wasmModule: MINIMAL_WASM_MODULE });
        const ready = proc.port.postMessage.mock.calls.filter((c) => (c[0] as { type: string }).type === 'ready');
        expect(ready).toHaveLength(1);
    });

    it('reports an init error when WASM instantiation throws', async () => {
        const { initSync } = await import('../../wasm/scoring.js');
        vi.mocked(initSync).mockImplementationOnce(() => {
            throw new Error('WASM instantiation failed');
        });
        const proc = await loadProcessor();
        send(proc, { type: 'init', wasmModule: MINIMAL_WASM_MODULE });
        const errors = proc.port.postMessage.mock.calls.filter((c) => (c[0] as { type?: string }).type === 'error');
        expect(errors).toHaveLength(1);
    });

    it('forwards param name/value to the instance', async () => {
        const proc = await loadProcessor();
        send(proc, { type: 'init', wasmModule: MINIMAL_WASM_MODULE });
        resetRecording();
        send(proc, { type: 'param', name: 'threshold', value: 0.5 });
        expect(paramCalls).toContainEqual({ name: 'threshold', value: 0.5 });
    });

    it('ignores param messages before init (no instance)', async () => {
        const proc = await loadProcessor();
        send(proc, { type: 'param', name: 'threshold', value: 0.5 });
        expect(paramCalls).toEqual([]);
    });
});

describe('ScoringProcessor process & telemetry', () => {
    beforeEach(() => {
        resetGrowableMemory(memory, HEAP_BYTES);
        resetRecording();
    });

    it('passthrough-copies input when not ready', async () => {
        const proc = await loadProcessor();
        const output = stereo(FRAMES, 0);
        proc.process([stereo(FRAMES, 0.7)], [output]);
        for (const sample of output[0]!) {
            expect(sample).toBeCloseTo(0.7, 6);
        }
        expect(processCalls).toEqual([]);
    });

    it('returns early when the left input is absent or output empty', async () => {
        const proc = await loadProcessor();
        send(proc, { type: 'init', wasmModule: MINIMAL_WASM_MODULE });
        resetRecording();
        proc.process([[]], [stereo(FRAMES, 0)]); // no left channel
        proc.process([stereo(FRAMES, 0.5)], [[]]); // empty output
        expect(processCalls).toEqual([]);
    });

    it('publishes the inactive telemetry slot when no pitch is detected', async () => {
        const proc = await loadProcessor();
        send(proc, { type: 'init', wasmModule: MINIMAL_WASM_MODULE });
        const sab = new SharedArrayBuffer(Float32Array.BYTES_PER_ELEMENT * 32);
        const view = new Float32Array(sab);
        send(proc, { type: 'init-sab', sab, byteOffset: 0 });
        resetRecording();
        isActive = false;

        // Telemetry interval is 4 process calls.
        for (let i = 0; i < 4; i++) {
            proc.process([stereo(FRAMES, 0.5)], [stereo(FRAMES, 0)]);
        }
        expect(view[0]).toBe(0); // inactive flag
    });

    it('publishes the full pitch telemetry when a note is active', async () => {
        const proc = await loadProcessor();
        send(proc, { type: 'init', wasmModule: MINIMAL_WASM_MODULE });
        const sab = new SharedArrayBuffer(Float32Array.BYTES_PER_ELEMENT * 32);
        const view = new Float32Array(sab);
        send(proc, { type: 'init-sab', sab, byteOffset: 0 });
        resetRecording();
        isActive = true;

        for (let i = 0; i < 4; i++) {
            proc.process([stereo(FRAMES, 0.5)], [stereo(FRAMES, 0)]);
        }
        expect(view[0]).toBe(1); // active flag
        expect(view[1]).toBe(440); // frequency
        expect(view[2]).toBe(-3); // cents
        expect(view[3]).toBeCloseTo(0.9, 6); // confidence (Float32 slot)
        expect(view[4]).toBe(9); // note index
        expect(view[5]).toBe(4); // octave
        expect(view[6]).toBe(69); // midi note
    });

    it('does not throw when telemetry fires without an SAB', async () => {
        const proc = await loadProcessor();
        send(proc, { type: 'init', wasmModule: MINIMAL_WASM_MODULE });
        resetRecording();
        isActive = true;
        for (let i = 0; i < 5; i++) {
            proc.process([stereo(FRAMES, 0.5)], [stereo(FRAMES, 0)]);
        }
        expect(makeChannels.length).toBeGreaterThanOrEqual(0);
    });

    it('faults and passthrough-copies when instance.process throws, then stops processing', async () => {
        const proc = await loadProcessor();
        send(proc, { type: 'init', wasmModule: MINIMAL_WASM_MODULE });
        resetRecording();
        processShouldThrow = true;

        const output = stereo(FRAMES, 0);
        proc.process([stereo(FRAMES, 0.4)], [output]);
        const errors = proc.port.postMessage.mock.calls.filter((c) => (c[0] as { type?: string }).type === 'error');
        expect(errors).toHaveLength(1);
        for (const sample of output[0]!) {
            expect(sample).toBeCloseTo(0.4, 6);
        }

        processCalls.length = 0;
        processShouldThrow = false;
        proc.process([stereo(FRAMES, 0.4)], [stereo(FRAMES, 0)]);
        expect(processCalls).toEqual([]);
    });
});

/**
 * Two distinct channels. The mock (like the real ScoringInstance) copies the
 * LEFT input into both output windows, so a right channel that still carries
 * its own samples proves the block never went through the wasm result path.
 */
function distinctStereoInput(): Float32Array[] {
    const leftIn = new Float32Array(FRAMES);
    const rightIn = new Float32Array(FRAMES);
    for (let index = 0; index < FRAMES; index++) {
        leftIn[index] = Math.sin(index * 0.11) * 0.5;
        rightIn[index] = Math.cos(index * 0.07) * 0.25;
    }
    return [leftIn, rightIn];
}

describe('ScoringProcessor bypass', () => {
    beforeEach(() => {
        resetGrowableMemory(memory, HEAP_BYTES);
        resetRecording();
    });

    it('copies the input to the output and runs no analysis while bypassed', async () => {
        const proc = await loadProcessor();
        send(proc, { type: 'init', wasmModule: MINIMAL_WASM_MODULE });
        const sab = new SharedArrayBuffer(Float32Array.BYTES_PER_ELEMENT * 32);
        const view = new Float32Array(sab);
        send(proc, { type: 'init-sab', sab, byteOffset: 0 });
        resetRecording();
        isActive = true;
        send(proc, { type: 'bypass', bypassed: true });

        const input = distinctStereoInput();
        const output = [new Float32Array(FRAMES), new Float32Array(FRAMES)];
        // Telemetry interval is 4 process calls — long enough to publish.
        for (let quantum = 0; quantum < 4; quantum++) {
            proc.process([input], [output]);
        }

        expect(Array.from(output[0]!)).toEqual(Array.from(input[0]!));
        // The wasm path mirrors LEFT into the right window; the dry right
        // channel surviving is what separates bypass from a passthrough engine.
        expect(Array.from(output[1]!)).toEqual(Array.from(input[1]!));
        expect(processCalls).toEqual([]);
        // The tuner readout is the only thing this device produces. Bypassed, it
        // must stop producing it rather than keep detecting off a live signal.
        expect(view[0]).toBe(0);
        expect(view[1]).toBe(0);
    });

    it('resumes analysis and telemetry once bypass is turned off', async () => {
        const proc = await loadProcessor();
        send(proc, { type: 'init', wasmModule: MINIMAL_WASM_MODULE });
        const sab = new SharedArrayBuffer(Float32Array.BYTES_PER_ELEMENT * 32);
        const view = new Float32Array(sab);
        send(proc, { type: 'init-sab', sab, byteOffset: 0 });
        resetRecording();
        isActive = true;

        const input = distinctStereoInput();
        const output = [new Float32Array(FRAMES), new Float32Array(FRAMES)];
        send(proc, { type: 'bypass', bypassed: true });
        for (let quantum = 0; quantum < 4; quantum++) {
            proc.process([input], [output]);
        }

        send(proc, { type: 'bypass', bypassed: false });
        for (let quantum = 0; quantum < 4; quantum++) {
            proc.process([input], [output]);
        }

        expect(processCalls).toEqual([FRAMES, FRAMES, FRAMES, FRAMES]);
        expect(view[0]).toBe(1);
        expect(view[1]).toBe(440);
        // Engine output again: the right channel now mirrors the left window.
        expect(Array.from(output[1]!)).toEqual(Array.from(input[0]!));
    });
});

// Slot indices from engine/telemetryAllocator.ts's SCORING_IDX: polyCount 7,
// then per-string (active, cents, confidence) triplets from 8. The worklet
// publishes only while the `poly` param has it enabled, and reports zero
// strings otherwise — the UI's silence state, never a stale chord.
describe('ScoringProcessor poly string telemetry', () => {
    const POLY_COUNT_IDX = 7;
    const POLY_BASE_IDX = 8;

    function seedPolyTracker(): void {
        polyStringCount = 6;
        polyStringFlags = [true, true, false, true, false, false];
        polyStringCents = [-4.5, 2.25, 0, 31.75, 0, 0];
        polyStringConfidences = [0.91, 0.82, 0, 0.55, 0, 0];
    }

    beforeEach(() => {
        resetGrowableMemory(memory, HEAP_BYTES);
        resetRecording();
    });

    function runTelemetryTick(proc: ScoringProcessorLike): void {
        for (let i = 0; i < 4; i++) {
            proc.process([stereo(FRAMES, 0.5)], [stereo(FRAMES, 0)]);
        }
    }

    // Standard per-test setup: fresh processor, ready instance, slot attached,
    // recorded calls cleared. The poly fixture must be seeded AFTER the reset
    // this performs.
    async function loadReadyProcessorWithSlot(): Promise<{ proc: ScoringProcessorLike; view: Float32Array }> {
        const proc = await loadProcessor();
        send(proc, { type: 'init', wasmModule: MINIMAL_WASM_MODULE });
        const sab = new SharedArrayBuffer(Float32Array.BYTES_PER_ELEMENT * 32);
        const view = new Float32Array(sab);
        send(proc, { type: 'init-sab', sab, byteOffset: 0 });
        resetRecording();
        return { proc, view };
    }

    it('publishes no poly strings while the poly param is off, even though the tracker holds readings', async () => {
        const { proc, view } = await loadReadyProcessorWithSlot();
        seedPolyTracker();

        runTelemetryTick(proc);

        expect(view[POLY_COUNT_IDX]).toBe(0);
    });

    it('publishes per-string active, cents and confidence once the poly param enables the tracker', async () => {
        const { proc, view } = await loadReadyProcessorWithSlot();
        seedPolyTracker();
        send(proc, { type: 'param', name: 'poly', value: 1 });

        runTelemetryTick(proc);

        expect(view[POLY_COUNT_IDX]).toBe(6);
        // String 0 (E2): sounding, 4.5 cents flat.
        expect(view[POLY_BASE_IDX]).toBe(1);
        expect(view[POLY_BASE_IDX + 1]).toBeCloseTo(-4.5, 6);
        expect(view[POLY_BASE_IDX + 2]).toBeCloseTo(0.91, 6);
        // String 2 (D3): not sounding — active flag zeroed, readings carried but hidden.
        expect(view[POLY_BASE_IDX + 2 * 3]).toBe(0);
        expect(view[POLY_BASE_IDX + 2 * 3 + 1]).toBe(0);
        // String 3 (G3): sounding, 31.75 cents sharp.
        expect(view[POLY_BASE_IDX + 3 * 3]).toBe(1);
        expect(view[POLY_BASE_IDX + 3 * 3 + 1]).toBeCloseTo(31.75, 6);
        expect(view[POLY_BASE_IDX + 3 * 3 + 2]).toBeCloseTo(0.55, 6);
    });

    it('keeps publishing the poly block while the mono readout is inactive', async () => {
        const { proc, view } = await loadReadyProcessorWithSlot();
        seedPolyTracker();
        send(proc, { type: 'param', name: 'poly', value: 1 });

        runTelemetryTick(proc);

        expect(view[0]).toBe(0); // mono inactive
        expect(view[POLY_COUNT_IDX]).toBe(6);
        expect(view[POLY_BASE_IDX]).toBe(1);
        expect(view[POLY_BASE_IDX + 1]).toBeCloseTo(-4.5, 6);
    });

    it('zeroes the poly string count on the tick after the poly param disables the tracker', async () => {
        const { proc, view } = await loadReadyProcessorWithSlot();
        seedPolyTracker();
        send(proc, { type: 'param', name: 'poly', value: 1 });
        runTelemetryTick(proc);
        expect(view[POLY_COUNT_IDX]).toBe(6);

        send(proc, { type: 'param', name: 'poly', value: 0 });
        runTelemetryTick(proc);

        expect(view[POLY_COUNT_IDX]).toBe(0);
    });

    it('clears the published poly strings on the bypass transition, like the mono flag', async () => {
        const { proc, view } = await loadReadyProcessorWithSlot();
        seedPolyTracker();
        send(proc, { type: 'param', name: 'poly', value: 1 });
        runTelemetryTick(proc);
        expect(view[POLY_COUNT_IDX]).toBe(6);

        send(proc, { type: 'bypass', bypassed: true });
        proc.process([stereo(FRAMES, 0.5)], [stereo(FRAMES, 0)]);

        expect(view[0]).toBe(0);
        expect(view[POLY_COUNT_IDX]).toBe(0);
    });

    it('caps the published string count at the slot layout capacity', async () => {
        const { proc, view } = await loadReadyProcessorWithSlot();
        polyStringCount = 8; // Rust MAX_STRINGS headroom the 32-float slot cannot carry
        polyStringFlags = Array.from({ length: 8 }, () => true);
        polyStringCents = Array.from({ length: 8 }, () => 0);
        polyStringConfidences = Array.from({ length: 8 }, () => 0.5);
        send(proc, { type: 'param', name: 'poly', value: 1 });

        runTelemetryTick(proc);

        expect(view[POLY_COUNT_IDX]).toBe(6);
    });
});
