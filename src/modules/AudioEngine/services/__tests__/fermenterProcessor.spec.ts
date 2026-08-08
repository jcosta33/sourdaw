import { describe, it, expect, vi, beforeEach } from 'vitest';

import { FERMENTER_AUTOMATION_PARAM_IDS } from '../../models/FermenterAutomationParams';

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
let advanceSilenceCalls = 0;
let lifecycleState = 0;
let pendingBlockEventCount = 0;
// Flip to simulate a Rust-side panic propagating through the bindgen glue.
let processShouldThrow = false;
let pushShouldThrow = false;

class FermenterInstanceMock {
    note_on(note: number, velocity: number): void {
        lifecycleState = 0;
        noteEvents.push({ kind: 'on', note, velocity });
    }
    note_on_with_channel(note: number, velocity: number, _channel: number): void {
        lifecycleState = 0;
        noteEvents.push({ kind: 'on', note, velocity });
    }
    note_off(note: number): void {
        noteEvents.push({ kind: 'off', note });
    }
    // Scheduled events reach the engine through the offset-carrying per-block
    // list instead of the immediate setters. This spec asserts *which block* an
    // event lands in, so the offset is dropped here; the offset within the
    // block is asserted in fermenterProcessorEventOffsets.spec.ts.
    push_note_on(note: number, velocity: number, _channel: number, _offset: number): boolean {
        if (pushShouldThrow) {
            throw new Error('wasm trap: queued event rejected by faulted runtime');
        }
        noteEvents.push({ kind: 'on', note, velocity });
        pendingBlockEventCount++;
        return true;
    }
    push_note_off(note: number, _offset: number): boolean {
        noteEvents.push({ kind: 'off', note });
        pendingBlockEventCount++;
        return true;
    }
    push_note_off_on_channel(note: number, _channel: number, _offset: number): boolean {
        noteEvents.push({ kind: 'off', note });
        pendingBlockEventCount++;
        return true;
    }
    set_param(name: string, value: number): void {
        paramCalls.push({ name, value });
    }
    set_param_by_id(id: number, value: number): void {
        paramByIdCalls.push({ id, value });
    }
    process(frames: number): number {
        processSizes.push(frames);
        pendingBlockEventCount = 0;
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
    lifecycle_state(): number {
        return pendingBlockEventCount > 0 ? 0 : lifecycleState;
    }
    advance_silence(): void {
        advanceSilenceCalls++;
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
    advanceSilenceCalls = 0;
    lifecycleState = 0;
    pendingBlockEventCount = 0;
    processShouldThrow = false;
    pushShouldThrow = false;
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
            expect(proc.process([], makeStereoBlock())).toBe(false);
        });
    });

    describe('DSP lifecycle', () => {
        it('advances silent state without rendering when the engine owns sleep', async () => {
            const proc = await loadProcessor();
            send(proc, { type: 'init' });
            resetRecording();
            lifecycleState = 3;
            const output = makeStereoBlock();
            output[0]![0]!.fill(1);
            output[0]![1]!.fill(1);

            proc.process([], output);

            expect(processSizes).toEqual([]);
            expect(advanceSilenceCalls).toBe(1);
            expect(Array.from(output[0]![0]!.slice(0, 2))).toEqual([0, 0]);
            expect(Array.from(output[0]![1]!.slice(0, 2))).toEqual([0, 0]);
        });

        it('drains a scheduled note before deciding whether the quantum can sleep', async () => {
            const proc = await loadProcessor();
            send(proc, { type: 'init' });
            resetRecording();
            lifecycleState = 3;
            vi.stubGlobal('currentFrame', 0);
            send(proc, { type: 'noteOn', note: 60, velocity: 100, sampleFrame: 37 });

            proc.process([], makeStereoBlock());

            expect(noteEvents).toEqual([{ kind: 'on', note: 60, velocity: 100 }]);
            expect(processSizes).toEqual([FRAMES]);
            expect(advanceSilenceCalls).toBe(0);
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

            // Derived, not a literal. A restated "obviously out of range"
            // ordinal rots the moment the table grows: this was `99`, which
            // stopped being out of range when the map went from 16 entries to
            // 102 and the case silently started asserting the opposite of what
            // it names.
            send(proc, {
                type: 'paramAutomation',
                paramId: Object.keys(FERMENTER_AUTOMATION_PARAM_IDS).length,
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

        // The `paramId >= AUTOMATION_PARAM_COUNT` guard is only observable from
        // outside by what it *admits*. Rejection cases alone cannot separate a
        // correct bound from one set too low, which is how the count stayed at
        // 15 after `oscWaveform` was added at ordinal 15: every offline waveform
        // automation message was dropped by a guard whose only tests passed.
        // So the admitted population is derived from the shared ordinal table
        // rather than restated here, and one ordinal past the table is sent in
        // the same batch — the single set equality then pins both sides of the
        // bound, and a table that grows without the count following reds here.
        it('admits exactly the ordinals the shared table declares, and nothing past them', async () => {
            const proc = await loadProcessor();
            send(proc, { type: 'init', wasmModule: MINIMAL_WASM_MODULE });
            resetRecording();

            const declaredOrdinals = Object.values(FERMENTER_AUTOMATION_PARAM_IDS).sort((a, b) => a - b);
            const firstUnmappedOrdinal = declaredOrdinals[declaredOrdinals.length - 1]! + 1;

            for (const ordinal of [...declaredOrdinals, firstUnmappedOrdinal]) {
                send(proc, {
                    type: 'paramAutomation',
                    paramId: ordinal,
                    // Degenerate segment (endFrame <= startFrame) so the applied
                    // value is endValue on the very first block, with no ramp.
                    segments: [{ startFrame: 0, endFrame: 0, startValue: 0, endValue: ordinal + 1 }],
                });
            }

            proc.process([], makeStereoBlock());

            const admittedOrdinals = paramByIdCalls.map((call) => call.id).sort((a, b) => a - b);
            expect(admittedOrdinals).toEqual(declaredOrdinals);
        });

        // The user-facing half of #1351: a waveform automation lane in an offline
        // bounce must reach the engine. `set_param_by_id` indexes Rust's
        // AUTOMATION_PARAM_NAMES positionally, so the id carried here is the
        // whole contract — and the value proves the segment was evaluated, not
        // merely that some id survived the guard.
        it('delivers an oscWaveform automation value to the engine under its table ordinal', async () => {
            const proc = await loadProcessor();
            send(proc, { type: 'init', wasmModule: MINIMAL_WASM_MODULE });
            resetRecording();

            // `?? NaN` rather than a non-null assertion: if the key is ever
            // removed from the table this must red on the missing delivery, not
            // crash on a bad index or quietly pass on some other ordinal.
            const oscWaveformOrdinal = FERMENTER_AUTOMATION_PARAM_IDS.oscWaveform ?? Number.NaN;
            send(proc, {
                type: 'paramAutomation',
                paramId: oscWaveformOrdinal,
                segments: [{ startFrame: 0, endFrame: 0, startValue: 0, endValue: 3 }],
            });

            proc.process([], makeStereoBlock());

            expect(paramByIdCalls).toEqual([{ id: oscWaveformOrdinal, value: 3 }]);
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

        it('reports a caught process fault without terminating graph ownership', async () => {
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
            const afterFault = proc.process([], makeStereoBlock());
            expect(processSizes).toEqual([]);
            expect(afterFault).toBe(true);
        });

        it('faults and posts an error when a scheduled-event push traps', async () => {
            const proc = await loadProcessor();
            send(proc, { type: 'init', wasmModule: MINIMAL_WASM_MODULE });
            resetRecording();
            send(proc, { type: 'noteOn', note: 60, velocity: 100, sampleFrame: 64 });
            pushShouldThrow = true;

            const ok = proc.process([], makeStereoBlock());

            const errorCalls = proc.port.postMessage.mock.calls.filter(
                (call) => (call[0] as { type?: string }).type === 'error'
            );
            expect(errorCalls).toHaveLength(1);
            expect((errorCalls[0]![0] as { message: string }).message).toContain('queued event');
            expect(ok).toBe(true);

            pushShouldThrow = false;
            proc.process([], makeStereoBlock());
            expect(processSizes).toEqual([]);
        });
    });
});
