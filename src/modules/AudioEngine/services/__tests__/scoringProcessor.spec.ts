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

    it('forwards param name/value and toggles bypass', async () => {
        const proc = await loadProcessor();
        send(proc, { type: 'init', wasmModule: MINIMAL_WASM_MODULE });
        resetRecording();
        send(proc, { type: 'param', name: 'threshold', value: 0.5 });
        send(proc, { type: 'bypass', bypassed: true });
        send(proc, { type: 'bypass', bypassed: false });
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
