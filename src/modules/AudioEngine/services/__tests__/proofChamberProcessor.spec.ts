import { describe, it, expect, vi, beforeEach } from 'vitest';

import { PROOF_CHAMBER_AUTOMATION_PARAM_IDS } from '../../models/ProofChamberAutomationParams';

/** Ordinals the shared table declares, ascending — never a list written here. */
const declaredProofChamberOrdinals = Object.values(PROOF_CHAMBER_AUTOMATION_PARAM_IDS).sort((a, b) => a - b);

import {
    RealFloat32Array,
    installWorkletGlobals,
    makeChannels,
    type GrowableMemory,
    createGrowableMemory,
    resetGrowableMemory,
} from './wasmViewGrowthHarness';

// ProofChamberProcessor message handling, automation scheduling, and process
// passthrough/guard paths. The existing proofChamberProcessorWasmViews spec
// covers only the RT-1/RT-7 WASM-view growth; this drives the state machine.

type ProofChamberProcessorLike = {
    port: { onmessage: ((event: { data: unknown }) => void) | null; postMessage: ReturnType<typeof vi.fn> };
    process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean;
};

const { registry } = installWorkletGlobals<ProofChamberProcessorLike>();

const HEAP_BYTES = 64 * 1024;
const OUT_LEFT_PTR = 0;
const OUT_RIGHT_PTR = 4096;
const FRAMES = 128;
const memory: GrowableMemory = createGrowableMemory(HEAP_BYTES);

const paramCalls: Array<{ name: string; value: number }> = [];
const paramByIdCalls: Array<{ id: number; value: number }> = [];
const processCalls: number[] = [];
let processShouldThrow = false;
// When non-null, initSync throws this value (covers String(error) + the
// error-after-ready arm of the onmessage catch).
let initShouldThrow: unknown = null;

class ProofChamberInstanceMock {
    set_param(name: string, value: number): void {
        paramCalls.push({ name, value });
    }
    set_param_by_id(id: number, value: number): void {
        paramByIdCalls.push({ id, value });
    }
    process(leftIn: Float32Array, rightIn: Float32Array, frames: number): number {
        processCalls.push(frames);
        if (processShouldThrow) {
            throw new Error('wasm trap');
        }
        // Sum left+right into the output windows so we can prove the input was
        // copied through (and mono upmixed) without asserting on WASM internals.
        const left = new RealFloat32Array(memory.buffer, OUT_LEFT_PTR, frames);
        const right = new RealFloat32Array(memory.buffer, OUT_RIGHT_PTR, frames);
        for (let i = 0; i < frames; i++) {
            left[i] = leftIn[i] ?? 0;
            right[i] = rightIn[i] ?? 0;
        }
        return OUT_LEFT_PTR;
    }
    get_right_ptr(): number {
        return OUT_RIGHT_PTR;
    }
    get_latency(): number {
        return 128;
    }
}

vi.mock('../../wasm/proof_chamber.js', () => ({
    initSync: vi.fn(() => {
        if (initShouldThrow !== null) {
            // eslint-disable-next-line @typescript-eslint/only-throw-error -- intentionally throws a non-Error value to exercise the String(error) catch arm
            throw initShouldThrow;
        }
        return { memory };
    }),
    ProofChamberInstance: ProofChamberInstanceMock,
}));

const MINIMAL_WASM_MODULE = new WebAssembly.Module(new Uint8Array([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]));

async function loadProcessor(): Promise<ProofChamberProcessorLike> {
    await import('../proofChamberProcessor');
    const Ctor = registry.get('proof-chamber-processor');
    if (!Ctor) {
        throw new Error('proof-chamber-processor was not registered');
    }
    return new Ctor({ processorOptions: { wasmModule: MINIMAL_WASM_MODULE } });
}

function send(proc: ProofChamberProcessorLike, data: unknown): void {
    proc.port.onmessage?.({ data });
}

function stereo(frames: number, fill: number): Float32Array[] {
    return [new Float32Array(frames).fill(fill), new Float32Array(frames).fill(fill)];
}

function resetRecording(): void {
    paramCalls.length = 0;
    paramByIdCalls.length = 0;
    processCalls.length = 0;
    processShouldThrow = false;
    initShouldThrow = null;
}

describe('ProofChamberProcessor message handling', () => {
    beforeEach(() => {
        resetGrowableMemory(memory, HEAP_BYTES);
        resetRecording();
    });

    it('posts ready with the instance latency on init, and ignores a second init', async () => {
        const proc = await loadProcessor();
        send(proc, { type: 'init', wasmModule: MINIMAL_WASM_MODULE });
        send(proc, { type: 'init', wasmModule: MINIMAL_WASM_MODULE });

        const ready = proc.port.postMessage.mock.calls.filter((c) => (c[0] as { type: string }).type === 'ready');
        expect(ready).toHaveLength(1);
        expect((ready[0]![0] as { latency: number }).latency).toBe(128);
    });

    it('reports an init error when WASM instantiation throws', async () => {
        const proc = await loadProcessor();
        initShouldThrow = new Error('WASM instantiation failed');
        send(proc, { type: 'init', wasmModule: MINIMAL_WASM_MODULE });
        const errors = proc.port.postMessage.mock.calls.filter((c) => (c[0] as { type?: string }).type === 'error');
        expect(errors).toHaveLength(1);
    });

    it('forwards param name/value to the instance', async () => {
        const proc = await loadProcessor();
        send(proc, { type: 'init', wasmModule: MINIMAL_WASM_MODULE });
        resetRecording();
        send(proc, { type: 'param', name: 'decay', value: 3.5 });
        expect(paramCalls).toContainEqual({ name: 'decay', value: 3.5 });
    });

    it('toggles bypass and passthrough-copies input while bypassed', async () => {
        const proc = await loadProcessor();
        send(proc, { type: 'init', wasmModule: MINIMAL_WASM_MODULE });
        resetRecording();
        send(proc, { type: 'bypass', bypassed: true });

        const output = makeChannels(2, FRAMES, (_ch, _frame) => 0); // zeroed
        proc.process([stereo(FRAMES, 0.4)], [output]);
        // bypassed ⇒ passthrough copies input
        for (const sample of output[0]!) {
            expect(sample).toBeCloseTo(0.4, 6);
        }
        expect(processCalls).toEqual([]); // instance.process not called
    });

    it('ignores param and paramAutomation messages before init (no instance)', async () => {
        const proc = await loadProcessor();
        send(proc, { type: 'param', name: 'decay', value: 1 });
        send(proc, {
            type: 'paramAutomation',
            paramId: 0,
            segments: [{ startFrame: 0, endFrame: 10, startValue: 0, endValue: 1 }],
        });
        expect(paramCalls).toEqual([]);
        expect(paramByIdCalls).toEqual([]);
    });

    // ── onmessage catch arms (proofChamberProcessor.ts:71, 74) ────────────────

    it('reports String(error) when init throws a non-Error value', async () => {
        initShouldThrow = 'chamber-boom';
        const proc = await loadProcessor();
        send(proc, { type: 'init', wasmModule: MINIMAL_WASM_MODULE });

        const errorMsg = proc.port.postMessage.mock.calls.find((c) => (c[0] as { type?: string }).type === 'error');
        expect(errorMsg).toBeDefined();
        expect((errorMsg![0] as { message: string }).message).toBe('chamber-boom');
    });

    it('posts an error and stops taking work when set_param throws while already ready', async () => {
        const proc = await loadProcessor();
        send(proc, { type: 'init', wasmModule: MINIMAL_WASM_MODULE });
        resetRecording();
        proc.port.postMessage.mockClear();

        const spy = vi.spyOn(ProofChamberInstanceMock.prototype, 'set_param').mockImplementation(() => {
            throw new Error('param trap while ready');
        });
        send(proc, { type: 'param', name: 'decay', value: 2 });
        spy.mockRestore();

        const errors = proc.port.postMessage.mock.calls.filter((c) => (c[0] as { type?: string }).type === 'error');
        expect(errors).toHaveLength(1);
        expect((errors[0]![0] as { message: string }).message).toBe('param trap while ready');

        // A throw here may mean the instance is trapped, so it stops being fed.
        send(proc, { type: 'param', name: 'decay', value: 4 });
        expect(paramCalls).toEqual([]);
    });
});

describe('ProofChamberProcessor param automation', () => {
    beforeEach(() => {
        resetGrowableMemory(memory, HEAP_BYTES);
        resetRecording();
    });

    it('rejects automation for an out-of-range, non-integer, or empty-segment paramId', async () => {
        const proc = await loadProcessor();
        send(proc, { type: 'init', wasmModule: MINIMAL_WASM_MODULE });
        resetRecording();

        // Ordinals the shared table does not declare, plus the two shapes no
        // table membership can express: a non-integer and a negative id.
        send(proc, {
            type: 'paramAutomation',
            paramId: 2,
            segments: [{ startFrame: 0, endFrame: 10, startValue: 0, endValue: 1 }],
        });
        send(proc, {
            type: 'paramAutomation',
            paramId: 1.5,
            segments: [{ startFrame: 0, endFrame: 10, startValue: 0, endValue: 1 }],
        });
        send(proc, {
            type: 'paramAutomation',
            paramId: -1,
            segments: [{ startFrame: 0, endFrame: 10, startValue: 0, endValue: 1 }],
        });
        send(proc, { type: 'paramAutomation', paramId: 0, segments: [] });
        // A schedule the guard *does* admit, sent in the same batch. Without it
        // this assertion was vacuous in a second way: the `outputs` argument was
        // passed unwrapped (`makeChannels(...)` rather than `[makeChannels(...)]`),
        // so `process` bailed before `_applyParamAutomation` ever ran and
        // `paramByIdCalls` stayed empty no matter what the guard admitted.
        send(proc, {
            type: 'paramAutomation',
            paramId: declaredProofChamberOrdinals[0],
            segments: [{ startFrame: 0, endFrame: 0, startValue: 0, endValue: 7 }],
        });

        proc.process([stereo(FRAMES, 0)], [makeChannels(2, FRAMES, () => 0)]);
        expect(paramByIdCalls).toEqual([{ id: declaredProofChamberOrdinals[0], value: 7 }]);
    });

    // The accept side, which rejection cases alone cannot supply: they separate
    // "too high" from "correct" but never "correct" from "too low". The guard
    // was a bare inline `paramId > 1` restating a two-key table it could not
    // see, so a third parameter would have been dropped with every existing
    // assertion still green. Population derived from the table, with one ordinal
    // past the highest sent in the same batch, so one set equality pins both
    // ends — and the value carried proves each schedule was evaluated rather
    // than merely admitted.
    it('admits exactly the ordinals the shared table declares, and nothing past them', async () => {
        const proc = await loadProcessor();
        send(proc, { type: 'init', wasmModule: MINIMAL_WASM_MODULE });
        resetRecording();

        const declaredOrdinals = declaredProofChamberOrdinals;
        const firstUnmappedOrdinal = Math.max(...declaredOrdinals) + 1;

        for (const ordinal of [...declaredOrdinals, firstUnmappedOrdinal]) {
            send(proc, {
                type: 'paramAutomation',
                paramId: ordinal,
                // Degenerate segment (endFrame <= startFrame) so the applied
                // value is endValue on the very first block, with no ramp.
                segments: [{ startFrame: 0, endFrame: 0, startValue: 0, endValue: ordinal + 1 }],
            });
        }

        proc.process([stereo(FRAMES, 0)], [makeChannels(2, FRAMES, () => 0)]);

        expect(paramByIdCalls.sort((a, b) => a.id - b.id)).toEqual(
            declaredOrdinals.map((ordinal) => ({ id: ordinal, value: ordinal + 1 }))
        );
    });

    it('writes the interpolated value once per change and dedupes unchanged values', async () => {
        const proc = await loadProcessor();
        send(proc, { type: 'init', wasmModule: MINIMAL_WASM_MODULE });
        resetRecording();

        // Segment 0..256, 0→10. currentFrame is stubbed at 0.
        send(proc, {
            type: 'paramAutomation',
            paramId: 1,
            segments: [{ startFrame: 0, endFrame: 256, startValue: 0, endValue: 10 }],
        });

        // First process at frame 0: value = startValue (0), lastValue undefined ⇒ writes.
        proc.process([stereo(FRAMES, 0)], [makeChannels(2, FRAMES, () => 0)]);
        expect(paramByIdCalls).toEqual([{ id: 1, value: 0 }]);

        // Second process at frame 0 again (static currentFrame): value 0 == lastValue ⇒ deduped.
        paramByIdCalls.length = 0;
        proc.process([stereo(FRAMES, 0)], [makeChannels(2, FRAMES, () => 0)]);
        expect(paramByIdCalls).toEqual([]);
    });

    it('replaces an existing schedule for the same paramId', async () => {
        const proc = await loadProcessor();
        send(proc, { type: 'init', wasmModule: MINIMAL_WASM_MODULE });
        resetRecording();

        send(proc, {
            type: 'paramAutomation',
            paramId: 0,
            segments: [{ startFrame: 0, endFrame: 64, startValue: 0, endValue: 5 }],
        });
        send(proc, {
            type: 'paramAutomation',
            paramId: 0,
            segments: [{ startFrame: 0, endFrame: 64, startValue: 2, endValue: 9 }],
        });

        proc.process([stereo(FRAMES, 0)], [makeChannels(2, FRAMES, () => 0)]);
        // Second schedule's startValue wins.
        expect(paramByIdCalls).toEqual([{ id: 0, value: 2 }]);
    });

    // ── automation value math (lines 113, 120, 122) ──────────────────────────

    it('interpolates mid-segment, snaps to endValue at/after endFrame, and advances segments', async () => {
        const proc = await loadProcessor();
        send(proc, { type: 'init', wasmModule: MINIMAL_WASM_MODULE });
        resetRecording();

        // Two contiguous segments: 0..128 (0→10), 128..256 (10→0).
        send(proc, {
            type: 'paramAutomation',
            paramId: 0,
            segments: [
                { startFrame: 0, endFrame: 128, startValue: 0, endValue: 10 },
                { startFrame: 128, endFrame: 256, startValue: 10, endValue: 0 },
            ],
        });

        // Frame 64 ⇒ mid-segment interpolation: 0 + (10-0)*(64/128) = 5.
        paramByIdCalls.length = 0;
        vi.stubGlobal('currentFrame', 64);
        proc.process([stereo(FRAMES, 0)], [makeChannels(2, FRAMES, () => 0)]);
        expect(paramByIdCalls).toContainEqual({ id: 0, value: 5 });
        vi.stubGlobal('currentFrame', 0);

        // Frame 300 ⇒ past endFrame of the last segment ⇒ endValue 0. The
        // segment-advance while-loop (line 113) runs because frame >= endFrame(128).
        paramByIdCalls.length = 0;
        vi.stubGlobal('currentFrame', 300);
        proc.process([stereo(FRAMES, 0)], [makeChannels(2, FRAMES, () => 0)]);
        expect(paramByIdCalls).toContainEqual({ id: 0, value: 0 });
        vi.stubGlobal('currentFrame', 0);
    });
});

describe('ProofChamberProcessor process paths', () => {
    beforeEach(() => {
        resetGrowableMemory(memory, HEAP_BYTES);
        resetRecording();
    });

    it('passthrough-copies input when not ready', async () => {
        const proc = await loadProcessor();
        const output = makeChannels(2, FRAMES, () => 0);
        proc.process([stereo(FRAMES, 0.6)], [output]);
        for (const sample of output[0]!) {
            expect(sample).toBeCloseTo(0.6, 6);
        }
        expect(processCalls).toEqual([]);
    });

    it('returns early when the left input is absent', async () => {
        const proc = await loadProcessor();
        send(proc, { type: 'init', wasmModule: MINIMAL_WASM_MODULE });
        resetRecording();
        // input present but left channel missing
        const ok = proc.process([[]], [makeChannels(2, FRAMES, () => 0)]);
        expect(ok).toBe(true);
        expect(processCalls).toEqual([]);
    });

    it('returns early when output has fewer than 2 channels', async () => {
        const proc = await loadProcessor();
        send(proc, { type: 'init', wasmModule: MINIMAL_WASM_MODULE });
        resetRecording();
        const ok = proc.process([stereo(FRAMES, 0.1)], [makeChannels(1, FRAMES, () => 0)]);
        expect(ok).toBe(true);
        expect(processCalls).toEqual([]);
    });

    it('upmixes mono input to stereo and renders through the instance', async () => {
        const proc = await loadProcessor();
        send(proc, { type: 'init', wasmModule: MINIMAL_WASM_MODULE });
        resetRecording();

        const mono = new Float32Array(FRAMES).fill(0.7);
        const output = makeChannels(2, FRAMES, () => 0);
        proc.process([[mono]], [output]);

        expect(processCalls).toEqual([FRAMES]);
        // process copied leftIn→outL and rightIn(==leftIn upmix)→outR.
        for (const sample of output[0]!) {
            expect(sample).toBeCloseTo(0.7, 6);
        }
        for (const sample of output[1]!) {
            expect(sample).toBeCloseTo(0.7, 6);
        }
    });

    it('faults and passthrough-copies when instance.process throws, then stops processing', async () => {
        const proc = await loadProcessor();
        send(proc, { type: 'init', wasmModule: MINIMAL_WASM_MODULE });
        resetRecording();
        processShouldThrow = true;

        const output = makeChannels(2, FRAMES, () => 0);
        proc.process([stereo(FRAMES, 0.3)], [output]);

        const errors = proc.port.postMessage.mock.calls.filter((c) => (c[0] as { type?: string }).type === 'error');
        expect(errors).toHaveLength(1);
        // Fault path runs passthrough after the trap.
        for (const sample of output[0]!) {
            expect(sample).toBeCloseTo(0.3, 6);
        }

        // Subsequent process() short-circuits via passthrough (faulted).
        processCalls.length = 0;
        processShouldThrow = false;
        proc.process([stereo(FRAMES, 0.3)], [makeChannels(2, FRAMES, () => 0)]);
        expect(processCalls).toEqual([]);
    });

    it('skips passthrough when bypassed with no input and no output', async () => {
        const proc = await loadProcessor();
        send(proc, { type: 'init', wasmModule: MINIMAL_WASM_MODULE });
        resetRecording();
        send(proc, { type: 'bypass', bypassed: true });

        // inputs[0] and outputs[0] both absent ⇒ `if (input && output)` false arm.
        // Must not throw (passthrough is skipped entirely).
        expect(proc.process([], [])).toBe(true);
        expect(processCalls).toEqual([]);
    });
});
