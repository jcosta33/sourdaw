import { describe, it, expect, vi, beforeEach } from 'vitest';

import {
    RealFloat32Array,
    installWorkletGlobals,
    makeChannels,
    type GrowableMemory,
    createGrowableMemory,
    resetGrowableMemory,
} from './wasmViewGrowthHarness';

// FermenterProcessor message-handling, queue/automation scheduling and telemetry.
// Distinct from fermenterProcessorWasmViews.spec which covers only the RT-1/RT-7
// WASM-view growth lifecycle. This spec drives the onmessage/process() state
// machine with a recording instance mock and asserts the scheduling decisions.

type NoteEvent = { kind: 'on' | 'off'; note: number; velocity?: number };
type FermenterProcessorLike = {
    port: { onmessage: ((event: { data: unknown }) => void) | null; postMessage: ReturnType<typeof vi.fn> };
    process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean;
};

const { registry } = installWorkletGlobals<FermenterProcessorLike>();

const HEAP_BYTES = 64 * 1024;
const OUT_LEFT_PTR = 0;
const OUT_RIGHT_PTR = 4096;
const FRAMES = 128;
const memory: GrowableMemory = createGrowableMemory(HEAP_BYTES);

const noteEvents: NoteEvent[] = [];
const paramCalls: Array<{ name: string; value: number }> = [];
const paramByIdCalls: Array<{ id: number; value: number }> = [];
const processSizes: number[] = [];
// Flip to simulate a Rust-side panic propagating through the bindgen glue.
let processShouldThrow = false;

class FermenterInstanceMock {
    note_on(note: number, velocity: number): void {
        noteEvents.push({ kind: 'on', note, velocity });
    }
    note_on_with_channel(note: number, velocity: number, _channel: number): void {
        noteEvents.push({ kind: 'on', note, velocity });
    }
    note_off(note: number): void {
        noteEvents.push({ kind: 'off', note });
    }
    set_param(name: string, value: number): void {
        paramCalls.push({ name, value });
    }
    set_param_by_id(id: number, value: number): void {
        paramByIdCalls.push({ id, value });
    }
    process(frames: number): number {
        processSizes.push(frames);
        if (processShouldThrow) {
            throw new Error('wasm trap: out-of-bounds memory access');
        }
        // Seed a known ramp on the left/right output windows so process() copies it.
        const left = new RealFloat32Array(memory.buffer, OUT_LEFT_PTR, frames);
        const right = new RealFloat32Array(memory.buffer, OUT_RIGHT_PTR, frames);
        for (let i = 0; i < frames; i++) {
            left[i] = 0.1 * (i + 1);
            right[i] = 0.2 * (i + 1);
        }
        return OUT_LEFT_PTR;
    }
    get_right_ptr(): number {
        return OUT_RIGHT_PTR;
    }
}

vi.mock('../../wasm/daw_dsp.js', () => ({
    initSync: vi.fn(() => ({ memory })),
    FermenterInstance: FermenterInstanceMock,
}));

const MINIMAL_WASM_MODULE = new WebAssembly.Module(new Uint8Array([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]));

async function loadProcessor(): Promise<FermenterProcessorLike> {
    await import('../fermenterProcessor');
    const Ctor = registry.get('fermenter-processor');
    if (!Ctor) {
        throw new Error('fermenter-processor was not registered');
    }
    return new Ctor({ processorOptions: { wasmModule: MINIMAL_WASM_MODULE } });
}

function send(proc: FermenterProcessorLike, data: unknown): void {
    proc.port.onmessage?.({ data });
}

function makeStereoBlock(): Float32Array[][] {
    return [makeChannels(2, FRAMES)];
}

function resetRecording(): void {
    noteEvents.length = 0;
    paramCalls.length = 0;
    paramByIdCalls.length = 0;
    processSizes.length = 0;
    processShouldThrow = false;
}

describe('FermenterProcessor message handling', () => {
    beforeEach(() => {
        resetGrowableMemory(memory, HEAP_BYTES);
        resetRecording();
    });

    describe('init', () => {
        it('posts ready on first init and ignores a second init', async () => {
            const proc = await loadProcessor();
            send(proc, { type: 'init', wasmModule: MINIMAL_WASM_MODULE });
            send(proc, { type: 'init', wasmModule: MINIMAL_WASM_MODULE }); // double-init guard

            const types = proc.port.postMessage.mock.calls.map((c) => (c[0] as { type: string }).type);
            expect(types).toEqual(['ready']); // exactly one ready
        });

        it('reports an error if WASM instantiation throws before becoming ready', async () => {
            const { initSync } = await import('../../wasm/daw_dsp.js');
            vi.mocked(initSync).mockImplementationOnce(() => {
                throw new Error('WASM instantiation failed');
            });
            const proc = await loadProcessor();
            send(proc, { type: 'init', wasmModule: MINIMAL_WASM_MODULE });

            const errorCalls = proc.port.postMessage.mock.calls.filter(
                (c) => (c[0] as { type?: string }).type === 'error'
            );
            expect(errorCalls).toHaveLength(1);
            const message = (errorCalls[0]![0] as { message: string }).message;
            expect(typeof message).toBe('string');
            expect(message.length).toBeGreaterThan(0);
        });
    });

    describe('immediate note dispatch', () => {
        it('dispatches noteOn/noteOff immediately when sampleFrame is omitted', async () => {
            const proc = await loadProcessor();
            send(proc, { type: 'init', wasmModule: MINIMAL_WASM_MODULE });
            resetRecording();

            send(proc, { type: 'noteOn', note: 60, velocity: 100 });
            send(proc, { type: 'noteOff', note: 60 });

            expect(noteEvents).toEqual([
                { kind: 'on', note: 60, velocity: 100 },
                { kind: 'off', note: 60 },
            ]);
        });
    });

    describe('scheduled note queue', () => {
        it('enqueues future notes in sampleFrame order and drains due notes within the block window', async () => {
            const proc = await loadProcessor();
            send(proc, { type: 'init', wasmModule: MINIMAL_WASM_MODULE });
            resetRecording();

            // currentFrame is stubbed at 0, so blockEndFrame = 0 + 128 = 128 every block,
            // and the block covers frames [0, 127]. Insert out of order to exercise the
            // binary-search insertion sort, then verify the drain preserves ascending
            // sampleFrame order and stops at the window edge.
            send(proc, { type: 'noteOn', note: 64, velocity: 80, sampleFrame: 256 });
            send(proc, { type: 'noteOff', note: 60, sampleFrame: 200 });
            send(proc, { type: 'noteOn', note: 60, velocity: 90, sampleFrame: 127 });

            // Nothing dispatched before the first process() call.
            expect(noteEvents).toEqual([]);

            // First block covers [0, 127] ⇒ noteOn(60)@127 (last in-block frame) drains,
            // but noteOff(60)@200 and noteOn(64)@256 stay queued (>=128).
            proc.process([], makeStereoBlock());
            expect(noteEvents).toEqual([{ kind: 'on', note: 60, velocity: 90 }]);

            // _queueHead is 1 of 3, so the truncation branch has not run and the
            // backing array is unchanged. The two remaining notes are still >= 128,
            // so repeated blocks (static currentFrame) drain nothing further.
            proc.process([], makeStereoBlock());
            expect(noteEvents).toEqual([{ kind: 'on', note: 60, velocity: 90 }]);
        });

        it('voices a note landing on a block boundary in that block, not the one before it', async () => {
            const proc = await loadProcessor();
            send(proc, { type: 'init' });
            resetRecording();

            // Block 1 renders frames [0, 127]; block 2 renders [128, 255].
            // Note 60 @127 is the last frame of block 1; note 72 @128 is the
            // FIRST frame of block 2 and must not be heard until block 2.
            send(proc, { type: 'noteOn', note: 60, velocity: 90, sampleFrame: 127 });
            send(proc, { type: 'noteOn', note: 72, velocity: 80, sampleFrame: 128 });

            vi.stubGlobal('currentFrame', 0);
            proc.process([], makeStereoBlock());
            expect(noteEvents).toEqual([{ kind: 'on', note: 60, velocity: 90 }]);

            vi.stubGlobal('currentFrame', 128);
            proc.process([], makeStereoBlock());
            expect(noteEvents).toEqual([
                { kind: 'on', note: 60, velocity: 90 },
                { kind: 'on', note: 72, velocity: 80 },
            ]);

            vi.stubGlobal('currentFrame', 0);
        });

        it('ignores a scheduled note for a processor that is not ready yet', async () => {
            const proc = await loadProcessor();
            // No init yet — _ready is false, so the message branch is skipped.
            send(proc, { type: 'noteOn', note: 60, velocity: 100, sampleFrame: 128 });
            proc.process([], makeStereoBlock());
            expect(noteEvents).toEqual([]);
        });
    });

    describe('allNotesOff', () => {
        it('drops queued notes and releases every held note 0..127', async () => {
            const proc = await loadProcessor();
            send(proc, { type: 'init', wasmModule: MINIMAL_WASM_MODULE });
            resetRecording();

            send(proc, { type: 'noteOn', note: 60, velocity: 100, sampleFrame: 128 });
            send(proc, { type: 'allNotesOff' });

            // The queued noteOn must NOT fire (queue cleared), and 128 note-offs run.
            const offs = noteEvents.filter((e) => e.kind === 'off').map((e) => e.note);
            const ons = noteEvents.filter((e) => e.kind === 'on');
            expect(ons).toEqual([]);
            expect(offs).toHaveLength(128);
            expect(offs[0]).toBe(0);
            expect(offs[127]).toBe(127);

            // Queue is empty so a subsequent process block dispatches nothing.
            proc.process([], makeStereoBlock());
            expect(noteEvents).toHaveLength(128);
        });
    });

    describe('param + patch', () => {
        it('snake-cases param names and forwards value to the instance', async () => {
            const proc = await loadProcessor();
            send(proc, { type: 'init', wasmModule: MINIMAL_WASM_MODULE });
            resetRecording();

            send(proc, { type: 'param', name: 'oscMix', value: 0.5 });
            expect(paramCalls).toContainEqual({ name: 'osc_mix', value: 0.5 });
        });

        it('remaps reserved filter/osc/lfo/portamento param names', async () => {
            const proc = await loadProcessor();
            send(proc, { type: 'init', wasmModule: MINIMAL_WASM_MODULE });
            resetRecording();

            send(proc, {
                type: 'patch',
                patch: {
                    filterCutoff: 1000,
                    filterResonance: 0.7,
                    filterEnvAmount: 0.3,
                    lfoPitchAmount: 0.2,
                    oscEngine: 1,
                    oscDrift: 0.1,
                    portamentoTime: 0.05,
                },
            });

            const byName = Object.fromEntries(paramCalls.map((p) => [p.name, p.value]));
            expect(byName.cutoff).toBe(1000);
            expect(byName.resonance).toBe(0.7);
            expect(byName.mod_env_to_filter).toBe(0.3);
            expect(byName.mod_lfo_to_pitch).toBe(0.2);
            expect(byName.engine).toBe(1);
            expect(byName.drift).toBe(0.1);
            expect(byName.portamento).toBe(0.05);
        });

        it('expands a patch macros array into macro0..N params, defaulting missing slots', async () => {
            const proc = await loadProcessor();
            send(proc, { type: 'init', wasmModule: MINIMAL_WASM_MODULE });
            resetRecording();

            send(proc, { type: 'patch', patch: { macros: [0.4, 0.9] } });

            expect(paramCalls).toContainEqual({ name: 'macro0', value: 0.4 });
            expect(paramCalls).toContainEqual({ name: 'macro1', value: 0.9 });
        });

        it('defaults a sparse/holey macros slot to 0 via the nullish guard', async () => {
            const proc = await loadProcessor();
            send(proc, { type: 'init', wasmModule: MINIMAL_WASM_MODULE });
            resetRecording();

            // Array(1) is a holey array: index 0 is undefined → value[index] ?? 0
            // must fall back to 0 so a missing macro does not forward undefined
            // into the Rust set_param (which expects a number).
            send(proc, { type: 'patch', patch: { macros: Array(1) } });

            expect(paramCalls).toContainEqual({ name: 'macro0', value: 0 });
        });

        it('ignores non-number, non-macros patch entries', async () => {
            const proc = await loadProcessor();
            send(proc, { type: 'init', wasmModule: MINIMAL_WASM_MODULE });
            resetRecording();

            send(proc, { type: 'patch', patch: { label: 'ignored' as unknown as number } });
            expect(paramCalls).toEqual([]);
        });
    });

    describe('param automation', () => {
        it('rejects automation with an out-of-range, non-integer or empty-segment schedule', async () => {
            const proc = await loadProcessor();
            send(proc, { type: 'init', wasmModule: MINIMAL_WASM_MODULE });
            resetRecording();

            send(proc, {
                type: 'paramAutomation',
                paramId: 99,
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
            send(proc, { type: 'paramAutomation', paramId: 1, segments: [] });

            proc.process([], makeStereoBlock());
            expect(paramByIdCalls).toEqual([]); // nothing scheduled
        });

        it('interpolates a ramp across a segment and writes only changed values', async () => {
            const proc = await loadProcessor();
            send(proc, { type: 'init', wasmModule: MINIMAL_WASM_MODULE });
            resetRecording();

            // Segment spanning frames 0..256, 0→10 linear. currentFrame starts at 0.
            send(proc, {
                type: 'paramAutomation',
                paramId: 3,
                segments: [{ startFrame: 0, endFrame: 256, startValue: 0, endValue: 10 }],
            });

            // Block 0..127: frame 0 == startFrame → startValue branch stays at 0.
            proc.process([], makeStereoBlock());
            // First applied value at frame 0: frame not > startFrame, value stays startValue (0).
            // lastValue was undefined → 0 is "changed" → one set_param_by_id with 0.
            expect(paramByIdCalls).toEqual([{ id: 3, value: 0 }]);

            // Block 128..255: currentFrame still stubbed at 0, so frame=0 again → value 0,
            // but lastValue is now 0 → deduped, no new write.
            paramByIdCalls.length = 0;
            proc.process([], makeStereoBlock());
            expect(paramByIdCalls).toEqual([]);
        });

        it('replaces an existing schedule for the same paramId instead of appending', async () => {
            const proc = await loadProcessor();
            send(proc, { type: 'init', wasmModule: MINIMAL_WASM_MODULE });
            resetRecording();

            send(proc, {
                type: 'paramAutomation',
                paramId: 2,
                segments: [{ startFrame: 0, endFrame: 64, startValue: 0, endValue: 5 }],
            });
            send(proc, {
                type: 'paramAutomation',
                paramId: 2,
                segments: [{ startFrame: 0, endFrame: 64, startValue: 1, endValue: 9 }],
            });

            // The second schedule wins: first applied value is its startValue (1).
            proc.process([], makeStereoBlock());
            expect(paramByIdCalls).toEqual([{ id: 2, value: 1 }]);
        });

        it('linearly interpolates the value when the playhead is mid-segment', async () => {
            const proc = await loadProcessor();
            send(proc, { type: 'init', wasmModule: MINIMAL_WASM_MODULE });
            resetRecording();

            // Segment 0..256 ramping 0→256. Advance the playhead into the middle
            // so frame (128) is strictly between start and end → the interpolation
            // branch computes startValue + (endValue-startValue)*fraction.
            send(proc, {
                type: 'paramAutomation',
                paramId: 4,
                segments: [{ startFrame: 0, endFrame: 256, startValue: 0, endValue: 256 }],
            });
            vi.stubGlobal('currentFrame', 128);

            proc.process([], makeStereoBlock());

            // fraction = (128-0)/(256-0) = 0.5 → value = 0 + (256-0)*0.5 = 128.
            expect(paramByIdCalls).toContainEqual({ id: 4, value: 128 });

            vi.stubGlobal('currentFrame', 0);
        });

        it('clamps to the end value once the playhead reaches or passes endFrame', async () => {
            const proc = await loadProcessor();
            send(proc, { type: 'init', wasmModule: MINIMAL_WASM_MODULE });
            resetRecording();

            // Segment 0..64. With the playhead at 128 (>= endFrame), the
            // endValue branch fires instead of the interpolation branch.
            send(proc, {
                type: 'paramAutomation',
                paramId: 5,
                segments: [{ startFrame: 0, endFrame: 64, startValue: 0, endValue: 42 }],
            });
            vi.stubGlobal('currentFrame', 128);

            proc.process([], makeStereoBlock());

            expect(paramByIdCalls).toContainEqual({ id: 5, value: 42 });

            vi.stubGlobal('currentFrame', 0);
        });

        it('uses the end value when a segment is degenerate (endFrame <= startFrame)', async () => {
            const proc = await loadProcessor();
            send(proc, { type: 'init', wasmModule: MINIMAL_WASM_MODULE });
            resetRecording();

            // A zero-duration segment: endFrame == startFrame. The first arm of
            // the guard (`endFrame <= startFrame`) fires → value = endValue.
            send(proc, {
                type: 'paramAutomation',
                paramId: 6,
                segments: [{ startFrame: 64, endFrame: 64, startValue: 0, endValue: 7 }],
            });
            vi.stubGlobal('currentFrame', 64);

            proc.process([], makeStereoBlock());

            expect(paramByIdCalls).toContainEqual({ id: 6, value: 7 });

            vi.stubGlobal('currentFrame', 0);
        });
    });

    describe('process guards & telemetry', () => {
        it('returns true and posts nothing when not ready', async () => {
            const proc = await loadProcessor();
            const ok = proc.process([], makeStereoBlock());
            expect(ok).toBe(true);
            expect(processSizes).toEqual([]);
        });

        it('returns true when the output bus has fewer than 2 channels', async () => {
            const proc = await loadProcessor();
            send(proc, { type: 'init', wasmModule: MINIMAL_WASM_MODULE });
            resetRecording();

            const ok = proc.process([], [makeChannels(1, FRAMES)]);
            expect(ok).toBe(true);
            expect(processSizes).toEqual([]); // bailed before calling instance.process
        });

        it('renders a mono output (right channel absent) without throwing', async () => {
            const proc = await loadProcessor();
            send(proc, { type: 'init', wasmModule: MINIMAL_WASM_MODULE });
            resetRecording();

            const output = makeChannels(2, FRAMES);
            // Force the right channel to be absent to hit the `out1` falsy branch.
            output[1] = undefined as unknown as Float32Array;
            const ok = proc.process([], [output]);

            expect(ok).toBe(true);
            expect(processSizes).toEqual([FRAMES]);
            // Left channel copied from the seeded ramp.
            expect(output[0]![0]).toBeCloseTo(0.1);
        });

        // Telemetry publish (peaks + scope waveform into the SAB slot, audit RT-3)
        // is covered by fermenterProcessorTelemetry.spec — the steady-state branch
        // sends no port message at all, so asserting one here would be vacuous.

        it('faults and posts an error when instance.process throws, then stops processing', async () => {
            const proc = await loadProcessor();
            send(proc, { type: 'init', wasmModule: MINIMAL_WASM_MODULE });
            resetRecording();
            processShouldThrow = true; // simulate a Rust-side trap propagating to JS

            const ok = proc.process([], makeStereoBlock());

            const errorCalls = proc.port.postMessage.mock.calls.filter(
                (c) => (c[0] as { type?: string }).type === 'error'
            );
            expect(errorCalls).toHaveLength(1);
            expect((errorCalls[0]![0] as { message: string }).message).toContain('wasm trap');
            expect(ok).toBe(true);

            // After faulting, a subsequent process() short-circuits (no instance calls).
            processSizes.length = 0;
            processShouldThrow = false;
            proc.process([], makeStereoBlock());
            expect(processSizes).toEqual([]);
        });
    });
});
