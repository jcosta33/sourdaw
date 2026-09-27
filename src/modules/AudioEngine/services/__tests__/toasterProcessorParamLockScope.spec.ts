import { describe, it, expect, vi, beforeEach } from 'vitest';

import { TOASTER_PAD_PARAM_IDS } from '../../models/ToasterPadParamIds';

/** The declared id for a pad parameter name; a missing entry fails the spec loudly. */
function padParamId(name: string): number {
    const id = TOASTER_PAD_PARAM_IDS[name];
    if (id === undefined) {
        throw new TypeError(`TOASTER_PAD_PARAM_IDS is missing ${name}`);
    }
    return id;
}

/** Reverse of TOASTER_PAD_PARAM_IDS, so the mock can key staged locks by name. */
const PAD_PARAM_NAMES_BY_ID: Readonly<Record<number, string>> = Object.fromEntries(
    Object.entries(TOASTER_PAD_PARAM_IDS).map(([name, id]) => [id, name])
);

// --- Worklet global scope shims -------------------------------------------
const registry = new Map<string, new (...args: unknown[]) => ToasterProcessorLike>();

class AudioWorkletProcessorShim {
    port = {
        onmessage: null as ((event: { data: unknown }) => void) | null,
        postMessage: vi.fn(),
    };
}

type ToasterProcessorLike = {
    port: {
        onmessage: ((event: { data: unknown }) => void) | null;
        postMessage: (msg: unknown) => void;
    };
    _queue: unknown[];
    _queueHead: number;
    process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean;
};

vi.stubGlobal('AudioWorkletProcessor', AudioWorkletProcessorShim);
vi.stubGlobal('registerProcessor', (name: string, proc: new (...args: unknown[]) => ToasterProcessorLike) => {
    registry.set(name, proc);
});
vi.stubGlobal('sampleRate', 48000);
vi.stubGlobal('currentFrame', 0);

// --- WASM module mock ------------------------------------------------------
const noteOffCalls: number[] = [];
const noteOnCalls: number[] = [];
const padParamCalls: Array<[number, string, number]> = [];
const padParamByIdCalls: Array<[number, number, number]> = [];
const padParamLockByIdCalls: Array<[number, number, number]> = [];
const padState = new Map<number, Map<string, number>>();
const padLockStage = new Map<number, Map<string, number>>();
const padStateAtNoteOn: Array<Record<string, number>> = [];
const padDryRoutedCalls: Array<[number, boolean]> = [];
const paramByIdCalls: Array<[number, number]> = [];
const kitParamCalls: Array<[string, number]> = [];
const processCalls: number[] = [];
const advanceSilenceCalls: number[] = [];
let padZeroDryRouted = false;
let lifecycleState = 0;
const WASM_BLOCK_SAMPLES = 4096;
const WASM_CHANNEL_BYTES = WASM_BLOCK_SAMPLES * Float32Array.BYTES_PER_ELEMENT;
const WASM_HEAP = new ArrayBuffer((2 + 16 * 2) * WASM_CHANNEL_BYTES);

class ToasterInstanceMock {
    note_on(pad: number): void {
        noteOnCalls.push(pad);
        // The engine consumes the pad's staged lock overlay at note_on: the hit
        // voices base state with the locks overlaid, and the overlay clears, so
        // nothing persists for the next hit (#4636).
        const staged = padLockStage.get(pad);
        padStateAtNoteOn.push(
            Object.assign(Object.fromEntries(padState.get(pad) ?? []), staged ? Object.fromEntries(staged) : {})
        );
        padLockStage.delete(pad);
        lifecycleState = 0;
    }
    note_off(pad: number): void {
        noteOffCalls.push(pad);
    }
    set_param(name: string, value: number): void {
        kitParamCalls.push([name, value]);
    }
    set_param_by_id(paramId: number, value: number): void {
        paramByIdCalls.push([paramId, value]);
    }
    set_pad_param(pad: number, name: string, value: number): void {
        padParamCalls.push([pad, name, value]);
        const params = padState.get(pad) ?? new Map<string, number>();
        params.set(name, value);
        padState.set(pad, params);
    }
    // The pre-#4636 scheduled-hit write: numeric id, persistent pad state — the
    // leak this spec catches. Kept so the pre-fix head REDs against this file.
    set_pad_param_by_id(pad: number, paramId: number, value: number): void {
        padParamByIdCalls.push([pad, paramId, value]);
        const name = PAD_PARAM_NAMES_BY_ID[paramId];
        if (name === undefined) {
            return;
        }
        const params = padState.get(pad) ?? new Map<string, number>();
        params.set(name, value);
        padState.set(pad, params);
    }
    // The per-hit lock overlay: staged, overlaid at note_on, cleared after.
    set_pad_param_lock_by_id(pad: number, paramId: number, value: number): void {
        padParamLockByIdCalls.push([pad, paramId, value]);
        const name = PAD_PARAM_NAMES_BY_ID[paramId];
        if (name === undefined) {
            return;
        }
        const staged = padLockStage.get(pad) ?? new Map<string, number>();
        staged.set(name, value);
        padLockStage.set(pad, staged);
    }
    set_pad_dry_routed(pad: number, routed: boolean): void {
        padDryRoutedCalls.push([pad, routed]);
        if (pad === 0) {
            padZeroDryRouted = routed;
        }
    }
    reset_pad_dry_routing(): void {
        padZeroDryRouted = false;
    }
    advance_silence(frames: number): void {
        advanceSilenceCalls.push(frames);
    }
    lifecycle_state(): number {
        return lifecycleState;
    }
    process(frames: number): number {
        processCalls.push(frames);
        const heap = new Float32Array(WASM_HEAP);
        heap.fill(0);
        heap.subarray(0, frames).fill(padZeroDryRouted ? 0 : 0.25);
        heap.subarray(WASM_BLOCK_SAMPLES, WASM_BLOCK_SAMPLES + frames).fill(padZeroDryRouted ? 0 : 0.5);
        heap.subarray(2 * WASM_BLOCK_SAMPLES, 2 * WASM_BLOCK_SAMPLES + frames).fill(0.75);
        heap.subarray(3 * WASM_BLOCK_SAMPLES, 3 * WASM_BLOCK_SAMPLES + frames).fill(1);
        heap.subarray(4 * WASM_BLOCK_SAMPLES, 4 * WASM_BLOCK_SAMPLES + frames).fill(-0.25);
        heap.subarray(5 * WASM_BLOCK_SAMPLES, 5 * WASM_BLOCK_SAMPLES + frames).fill(-0.5);
        return 0;
    }
    get_right_ptr(): number {
        return WASM_CHANNEL_BYTES;
    }
}

vi.mock('../../wasm/daw_dsp.js', () => ({
    initSync: vi.fn(() => ({ memory: { buffer: WASM_HEAP } })),
    ToasterInstance: ToasterInstanceMock,
}));

const MINIMAL_WASM_MODULE = new WebAssembly.Module(new Uint8Array([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]));

async function loadProcessor(): Promise<ToasterProcessorLike> {
    await import('../toasterProcessor');
    const Ctor = registry.get('toaster-processor');
    if (!Ctor) {
        throw new Error('toaster-processor was not registered');
    }
    return new Ctor({ processorOptions: { wasmModule: MINIMAL_WASM_MODULE } });
}

function send(proc: ToasterProcessorLike, data: unknown): void {
    proc.port.onmessage?.({ data });
}

// Audit #4591 / issue #4636 — a Toaster step's parameter lock (`step.paramLocks`)
// must apply to that step only. `sequencerPlayback` sends a locked step's values
// as `padParams` and an unlocked step with `padParams: []`; the worklet used to
// apply the lock through the persistent pad write and restore only the engine
// type, so the lock stayed on the pad for every later hit. Locks now cross as a
// per-hit overlay the engine consumes at `note_on` and clears.
//
// The issue's message inputs carried `{ name, value }`; the shipped wire
// contract is `{ id, value }` — names are translated to TOASTER_PAD_PARAM_IDS
// entries on the main thread (#4633) — so the inputs below carry the id. The
// `padParam` kit-sync message keeps its string name: panel/kit writes remain
// persistent pad state and never run on the render thread.
describe('ToasterProcessor parameter-lock scope', () => {
    beforeEach(() => {
        noteOnCalls.length = 0;
        padParamCalls.length = 0;
        padParamByIdCalls.length = 0;
        padParamLockByIdCalls.length = 0;
        padState.clear();
        padLockStage.clear();
        padStateAtNoteOn.length = 0;
        vi.stubGlobal('currentFrame', 1000);
    });

    it("voices the next unlocked step with the pad's own tune, not the previous step's lock", async () => {
        const proc = await loadProcessor();
        send(proc, { type: 'init', wasmModule: MINIMAL_WASM_MODULE });
        // Kit sync: the pad's own tune.
        send(proc, { type: 'padParam', pad: 0, name: 'tune', value: 0 });

        // Step 1 carries a tune lock of +7 semitones; step 2 is unlocked.
        send(proc, {
            type: 'scheduledHit',
            pad: 0,
            velocity: 1,
            sampleFrame: 1000,
            padParams: [{ id: padParamId('tune'), value: 7 }],
        });
        send(proc, { type: 'scheduledHit', pad: 0, velocity: 1, sampleFrame: 1000, padParams: [] });

        expect(noteOnCalls).toEqual([0, 0]);
        const tuneKeys = Object.keys(padStateAtNoteOn[0] ?? {});
        expect(tuneKeys).toHaveLength(1);
        const tuneKey = tuneKeys[0]!;
        expect(padStateAtNoteOn[0]?.[tuneKey]).toBe(7);
        expect(padStateAtNoteOn[1]?.[tuneKey]).toBe(0);
    });
});
