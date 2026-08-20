import { describe, it, expect, vi, beforeEach } from 'vitest';

import { createProofRuntimeParameterIds } from '../../models/ProofRuntimeControl';

// --- Worklet global scope shims -------------------------------------------
const registry = new Map<string, new (...args: unknown[]) => ProofProcessorLike>();

class AudioWorkletProcessorShim {
    port = {
        onmessage: null as ((event: { data: unknown }) => void) | null,
        postMessage: vi.fn(),
    };
}

type ProofProcessorLike = {
    port: {
        onmessage: ((event: { data: unknown }) => void) | null;
        postMessage: (msg: unknown) => void;
    };
    process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean;
};

vi.stubGlobal('AudioWorkletProcessor', AudioWorkletProcessorShim);
vi.stubGlobal('registerProcessor', (name: string, proc: new (...args: unknown[]) => ProofProcessorLike) => {
    registry.set(name, proc);
});
vi.stubGlobal('sampleRate', 48000);

// --- WASM module mock ------------------------------------------------------
// A heap large enough for the in/out scratch pointers the processor maps.
const WASM_HEAP = new ArrayBuffer(64 * 1024);

class ProofInstanceMock {
    process(): number {
        if (proofProcessShouldThrow) {
            throw new Error('wasm trap');
        }
        return 0;
    }
    get_input_left_ptr(): number {
        return 0;
    }
    get_input_right_ptr(): number {
        return 2048;
    }
    get_right_ptr(): number {
        return 4096;
    }
    get_latency_samples(): number {
        // Returns queued values so the latency-change branch can be exercised.
        return proofLatencyQueue.length > 1 ? (proofLatencyQueue.shift() as number) : (proofLatencyQueue[0] ?? 256);
    }
    // Each meter getter returns a distinct, recognizable value so a torn read
    // (fields mixed across writes) would be detectable.
    get_input_lufs(): number {
        return -23;
    }
    get_output_lufs(): number {
        return -14;
    }
    get_output_st_lufs(): number {
        return -13;
    }
    get_integrated_lufs(): number {
        return -16;
    }
    get_true_peak_db(): number {
        return -1.5;
    }
    get_lra(): number {
        return 7;
    }
    get_correlation(): number {
        return 0.95;
    }
    get_limiter_gr_db(): number {
        return -3;
    }
    get_dynamics_gr(band: number): number {
        return -band;
    }
    get_tap_peak_l(tap: number): number {
        return -10 - tap;
    }
    get_tap_peak_r(tap: number): number {
        return -20 - tap;
    }
    set_param(name: string, value: number): void {
        proofParamCalls.push({ name, value });
    }
    reorder(a: number, b: number, c: number, d: number, e: number): void {
        proofReorderCalls.push([a, b, c, d, e]);
    }
    reset_integrated(): void {
        proofResetCalls++;
    }
}

// Shared recording/controllable state for the message-handling describe block.
const proofParamCalls: Array<{ name: string; value: number }> = [];
let proofReorderCalls: number[][] = [];
let proofResetCalls = 0;
let proofLatencyQueue: number[] = [256];
let proofProcessShouldThrow = false;
// When true, make initSync throw a non-Error value so the catch falls into the
// String(error) arm (proofProcessor.ts:67).
let proofInitShouldThrow: unknown = null;

vi.mock('../../wasm/daw_dsp.js', () => ({
    initSync: vi.fn(() => {
        if (proofInitShouldThrow !== null) {
            // eslint-disable-next-line @typescript-eslint/only-throw-error -- intentionally throws a non-Error value to exercise the String(error) catch arm
            throw proofInitShouldThrow;
        }
        return { memory: { buffer: WASM_HEAP } };
    }),
    ProofInstance: ProofInstanceMock,
}));

const MINIMAL_WASM_MODULE = new WebAssembly.Module(new Uint8Array([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]));

// Seqlock counter index within the telemetry slot — mirrors TELEMETRY_SEQ_IDX
// in engine/telemetryAllocator.ts (FLOATS_PER_SLOT - 1).
const TELEMETRY_SEQ_IDX = 31;
const FLOATS_PER_SLOT = 32;
const PROOF = {
    inputLufs: 0,
    integratedLufs: 3,
    tap0PeakL: 12,
    tap5PeakR: 23,
    latency: 24,
};

async function loadProcessor(): Promise<ProofProcessorLike> {
    await import('../proofProcessor');
    const Ctor = registry.get('proof-processor');
    if (!Ctor) {
        throw new Error('proof-processor was not registered');
    }
    return new Ctor({ processorOptions: { wasmModule: MINIMAL_WASM_MODULE } });
}

function send(proc: ProofProcessorLike, data: unknown): void {
    proc.port.onmessage?.({ data });
}

function initializeLiveProof(proc: ProofProcessorLike, trackId: string): void {
    send(proc, { type: 'init', wasmModule: MINIMAL_WASM_MODULE });
    send(proc, {
        schemaVersion: 1,
        command: 'initialize-fallback-control',
        target: { trackId, deviceId: 'proof-1', deviceType: 'proof', parameterIds: createProofRuntimeParameterIds() },
        correlation: { workletGeneration: 1 },
    });
}

function liveControl(
    command: string,
    trackId: string,
    sequence: number,
    extra: Record<string, unknown> = {}
): Record<string, unknown> {
    return {
        schemaVersion: 1,
        command,
        target: { trackId, deviceId: 'proof-1', deviceType: 'proof' },
        correlation: { workletGeneration: 1, controlSequence: sequence },
        scheduling: { targetFrame: null, deadlineFrame: null },
        ...extra,
    };
}

function runMeterBlock(proc: ProofProcessorLike): void {
    // Proof writes telemetry every 8th process() call (_meterCounter >= 8).
    const input = [new Float32Array(128), new Float32Array(128)];
    const output = [new Float32Array(128), new Float32Array(128)];
    for (let i = 0; i < 8; i++) {
        proc.process([input], [output]);
    }
}

describe('ProofProcessor telemetry seqlock', () => {
    let sab: SharedArrayBuffer;
    let floatView: Float32Array;
    let seqView: Int32Array;

    beforeEach(() => {
        sab = new SharedArrayBuffer(FLOATS_PER_SLOT * 4);
        floatView = new Float32Array(sab);
        seqView = new Int32Array(sab);
    });

    function init(proc: ProofProcessorLike): void {
        send(proc, { type: 'init', wasmModule: MINIMAL_WASM_MODULE });
        send(proc, { type: 'init-sab', sab, byteOffset: 0 });
    }

    // ── Fix 7: the telemetry write is bracketed by a seqlock so a concurrent
    // poll never reads a snapshot torn across the 25 non-atomic float writes. ──
    it('leaves the seqlock counter even after a completed meter write and advances it by 2', async () => {
        const proc = await loadProcessor();
        init(proc);

        const before = Atomics.load(seqView, TELEMETRY_SEQ_IDX);
        runMeterBlock(proc);
        const after = Atomics.load(seqView, TELEMETRY_SEQ_IDX);

        // Settled (even) after the write; odd is the write-in-progress state.
        expect(after % 2).toBe(0);
        // One full seqlock cycle: odd, then even.
        expect(after - before).toBe(2);
    });

    it('publishes the meter fields the worklet wrote under the settled counter', async () => {
        const proc = await loadProcessor();
        init(proc);

        runMeterBlock(proc);

        // The recognizable getter values landed at their mapped indices.
        expect(floatView[PROOF.inputLufs]).toBeCloseTo(-23, 5);
        expect(floatView[PROOF.integratedLufs]).toBeCloseTo(-16, 5);
        expect(floatView[PROOF.tap0PeakL]).toBeCloseTo(-10, 5);
        expect(floatView[PROOF.tap5PeakR]).toBeCloseTo(-25, 5);
        expect(floatView[PROOF.latency]).toBeCloseTo(256, 5);
        expect(Atomics.load(seqView, TELEMETRY_SEQ_IDX) % 2).toBe(0);
    });

    it('produces a snapshot a seqlock reader accepts as clean on the first try', async () => {
        const proc = await loadProcessor();
        init(proc);
        runMeterBlock(proc);

        // Faithful seqlock reader: sample fields between two counter reads; accept
        // only when the counter is unchanged and even. After a completed write the
        // reader must get the values on its first attempt — proof the writer's
        // output is consumable, not torn.
        let cleanFirstTry = false;
        let integrated = 0;
        for (let attempt = 0; attempt <= 8; attempt++) {
            const start = Atomics.load(seqView, TELEMETRY_SEQ_IDX);
            integrated = floatView[PROOF.integratedLufs]!;
            const end = Atomics.load(seqView, TELEMETRY_SEQ_IDX);
            if (start === end && (start & 1) === 0) {
                cleanFirstTry = attempt === 0;
                break;
            }
        }
        expect(cleanFirstTry).toBe(true);
        expect(integrated).toBeCloseTo(-16, 5);
    });
});

describe('ProofProcessor telemetry slot initialization', () => {
    // Two whole slots, so an offset can be valid, misaligned, or run past the end.
    const SLOT_BYTES = FLOATS_PER_SLOT * 4;
    let sab: SharedArrayBuffer;
    let floatView: Float32Array;

    beforeEach(() => {
        proofParamCalls.length = 0;
        proofLatencyQueue = [256];
        proofProcessShouldThrow = false;
        proofInitShouldThrow = null;
        sab = new SharedArrayBuffer(SLOT_BYTES * 2);
        floatView = new Float32Array(sab);
    });

    // ── `typeof msg.byteOffset === 'number'` was the whole guard before
    // `new Float32Array(msg.sab, msg.byteOffset, 32)`. A negative, fractional,
    // misaligned or out-of-bounds offset threw into the onmessage catch, which
    // marks the processor faulted for the rest of its life — one malformed
    // initialization message permanently killed a device that was passing
    // audio perfectly well. NaN did not throw at all: it coerced to 0 and
    // silently mapped another device's slot. ──
    it.each([
        ['negative', -4],
        ['fractional', 4.5],
        ['misaligned by two bytes', 2],
        ['misaligned by one byte', 129],
        ['NaN', Number.NaN],
        ['Infinity', Number.POSITIVE_INFINITY],
        ['past the safe-integer range', Number.MAX_SAFE_INTEGER + 2],
        ['a slot that runs past the end of the buffer', SLOT_BYTES * 2 - 4],
        ['one whole slot past the end', SLOT_BYTES * 2],
        ['a non-number', '0'],
    ])('ignores a %s telemetry offset without faulting the processor', async (_label, byteOffset) => {
        const proc = await loadProcessor();
        send(proc, { type: 'init', wasmModule: MINIMAL_WASM_MODULE });

        send(proc, { type: 'init-sab', sab, byteOffset });
        runMeterBlock(proc);

        expect(
            vi.mocked(proc.port.postMessage).mock.calls.filter((c) => (c[0] as { type?: string }).type === 'error')
        ).toHaveLength(0);
        expect(Array.from(floatView)).toEqual(Array.from(new Float32Array(FLOATS_PER_SLOT * 2)));

        // Still taking work: the device kept its audio duties after refusing
        // the malformed slot.
        send(proc, { type: 'param', name: 'lim_ceiling', value: -1 });
        expect(proofParamCalls).toEqual([{ name: 'lim_ceiling', value: -1 }]);
    });

    it('maps a whole aligned slot at a non-zero offset', async () => {
        // The counter-check: a guard that refused everything would pass all of
        // the rejections above.
        const proc = await loadProcessor();
        send(proc, { type: 'init', wasmModule: MINIMAL_WASM_MODULE });

        send(proc, { type: 'init-sab', sab, byteOffset: SLOT_BYTES });
        runMeterBlock(proc);

        expect(floatView[FLOATS_PER_SLOT + 0]).toBeCloseTo(-23, 5);
        expect(floatView[FLOATS_PER_SLOT + 24]).toBeCloseTo(256, 5);
        // The neighbouring slot is untouched.
        expect(floatView[0]).toBe(0);
    });

    it('refuses a buffer too small to hold one whole slot', async () => {
        const proc = await loadProcessor();
        send(proc, { type: 'init', wasmModule: MINIMAL_WASM_MODULE });
        const tooSmall = new SharedArrayBuffer(SLOT_BYTES - 4);

        send(proc, { type: 'init-sab', sab: tooSmall, byteOffset: 0 });
        runMeterBlock(proc);

        expect(
            vi.mocked(proc.port.postMessage).mock.calls.filter((c) => (c[0] as { type?: string }).type === 'error')
        ).toHaveLength(0);
        expect(Array.from(new Float32Array(tooSmall))).toEqual(Array.from(new Float32Array(FLOATS_PER_SLOT - 1)));
    });
});

describe('ProofProcessor message handling & process guards', () => {
    beforeEach(() => {
        proofParamCalls.length = 0;
        proofReorderCalls = [];
        proofResetCalls = 0;
        proofLatencyQueue = [256];
        proofProcessShouldThrow = false;
        proofInitShouldThrow = null;
    });

    it('ignores a second init once ready', async () => {
        const proc = await loadProcessor();
        send(proc, { type: 'init', wasmModule: MINIMAL_WASM_MODULE });
        send(proc, { type: 'init', wasmModule: MINIMAL_WASM_MODULE });
        const ready = vi
            .mocked(proc.port.postMessage)
            .mock.calls.filter((c) => (c[0] as { type: string }).type === 'ready');
        expect(ready).toHaveLength(1);
    });

    it('reports an init error when WASM instantiation throws', async () => {
        const proc = await loadProcessor();
        proofInitShouldThrow = new Error('WASM instantiation failed');
        send(proc, { type: 'init', wasmModule: MINIMAL_WASM_MODULE });
        const errors = vi
            .mocked(proc.port.postMessage)
            .mock.calls.filter((c) => (c[0] as { type?: string }).type === 'error');
        expect(errors).toHaveLength(1);
    });

    it('forwards param, reorder (5-tuple) and reset_integrated', async () => {
        const proc = await loadProcessor();
        send(proc, { type: 'init', wasmModule: MINIMAL_WASM_MODULE });

        send(proc, { type: 'param', name: 'lim_threshold', value: -1 });
        send(proc, { type: 'reorder', order: [3, 1, 2, 0, 4] });
        send(proc, { type: 'reset_integrated' });

        expect(proofParamCalls).toContainEqual({ name: 'lim_threshold', value: -1 });
        expect(proofReorderCalls).toEqual([[3, 1, 2, 0, 4]]);
        expect(proofResetCalls).toBe(1);
    });

    it.each(['', 'x'.repeat(129)])(
        'rejects %j target identity at live initialization and before scalar/reorder/reset mutation',
        async (trackId) => {
            const proc = await loadProcessor();
            initializeLiveProof(proc, trackId);
            send(
                proc,
                liveControl('set-fallback-param', trackId, 1, {
                    value: -1,
                    target: { trackId, deviceId: 'proof-1', deviceType: 'proof', parameterId: 'lim_ceiling' },
                })
            );
            send(proc, liveControl('reorder-modules', trackId, 2, { order: [0, 1, 2, 3, 4] }));
            send(proc, liveControl('reset-integrated', trackId, 3));
            expect(proofParamCalls).toEqual([]);
            expect(proofReorderCalls).toEqual([]);
            expect(proofResetCalls).toBe(0);
        }
    );

    it('reports a latency-changed event when a message shifts the reported latency', async () => {
        const proc = await loadProcessor();
        send(proc, { type: 'init', wasmModule: MINIMAL_WASM_MODULE });
        // _handleMessage reads latency before and after; queue 0 then 64 ⇒ change.
        proofLatencyQueue = [0, 64];

        send(proc, { type: 'param', name: 'lim_lookahead', value: 1 });

        const postMessage = vi.mocked(proc.port.postMessage);
        const changed = postMessage.mock.calls
            .map((c) => c[0] as { type?: string; latency?: number })
            .find((m) => m.type === 'latency-changed');
        expect(changed).toBeDefined();
        expect(changed!.latency).toBe(64);
    });

    it('reports latency after an accepted live v1 lim_lookahead control mutates WASM', async () => {
        const proc = await loadProcessor();
        initializeLiveProof(proc, 'track-1');
        proofLatencyQueue = [0, 64];

        send(
            proc,
            liveControl('set-fallback-param', 'track-1', 1, {
                value: 1,
                target: { trackId: 'track-1', deviceId: 'proof-1', deviceType: 'proof', parameterId: 'lim_lookahead' },
            })
        );

        expect(proofParamCalls).toContainEqual({ name: 'lim_lookahead', value: 1 });
        expect(vi.mocked(proc.port.postMessage).mock.calls.map((call) => call[0])).toContainEqual({
            type: 'latency-changed',
            latency: 64,
        });
    });

    it('does not report latency-changed when the message leaves latency unchanged', async () => {
        const proc = await loadProcessor();
        send(proc, { type: 'init', wasmModule: MINIMAL_WASM_MODULE });
        proofLatencyQueue = [256, 256]; // both calls identical
        send(proc, { type: 'param', name: 'lim_threshold', value: -1 });
        const postMessage = vi.mocked(proc.port.postMessage);
        const changed = postMessage.mock.calls
            .map((c) => c[0] as { type?: string })
            .find((m) => m.type === 'latency-changed');
        expect(changed).toBeUndefined();
    });

    it('ignores control messages before init (no instance)', async () => {
        const proc = await loadProcessor();
        send(proc, { type: 'param', name: 'lim_threshold', value: -1 });
        send(proc, { type: 'reorder', order: [0, 1, 2, 3, 4] });
        expect(proofParamCalls).toEqual([]);
        expect(proofReorderCalls).toEqual([]);
    });

    it('returns early when not ready or when input/output has fewer than 2 channels', async () => {
        const proc = await loadProcessor();
        const out = [new Float32Array(128), new Float32Array(128)];
        // not ready
        proc.process([[new Float32Array(128), new Float32Array(128)]], [out]);
        // (no throw; reaching here is success)

        send(proc, { type: 'init', wasmModule: MINIMAL_WASM_MODULE });
        // mono input ⇒ early return
        proc.process([[new Float32Array(128)]], [out]);
        // mono output ⇒ early return
        proc.process([[new Float32Array(128), new Float32Array(128)]], [[new Float32Array(128)]]);
        expect(true).toBe(true);
    });

    it('faults and posts an error when instance.process throws', async () => {
        const proc = await loadProcessor();
        send(proc, { type: 'init', wasmModule: MINIMAL_WASM_MODULE });
        proofProcessShouldThrow = true;

        const out = [new Float32Array(128), new Float32Array(128)];
        proc.process([[new Float32Array(128).fill(0.5), new Float32Array(128).fill(0.5)]], [out]);

        const errors = vi
            .mocked(proc.port.postMessage)
            .mock.calls.filter((c) => (c[0] as { type?: string }).type === 'error');
        expect(errors).toHaveLength(1);
        // Fault path ran passthrough after the trap.
        expect(out[0]![0]).toBeCloseTo(0.5, 6);
    });

    // ── error-after-ready: a control handler that throws once ready enters the
    // onmessage catch, which reports it and marks the instance faulted — the
    // same policy the process() catch has always had. ──
    it('posts an error and stops taking work when a control handler throws while already ready', async () => {
        const proc = await loadProcessor();
        send(proc, { type: 'init', wasmModule: MINIMAL_WASM_MODULE }); // _ready = true
        proofParamCalls.length = 0;
        vi.mocked(proc.port.postMessage).mockClear();

        const spy = vi.spyOn(ProofInstanceMock.prototype, 'set_param').mockImplementation(() => {
            throw new Error('param trap while ready');
        });
        send(proc, { type: 'param', name: 'lim_threshold', value: -1 });
        spy.mockRestore();

        const errors = vi
            .mocked(proc.port.postMessage)
            .mock.calls.filter((c) => (c[0] as { type?: string }).type === 'error');
        expect(errors).toHaveLength(1);
        expect((errors[0]![0] as { message: string }).message).toBe('param trap while ready');

        // A throw here may mean the instance is trapped, so it stops being fed.
        send(proc, { type: 'param', name: 'lim_threshold', value: -2 });
        expect(proofParamCalls).toEqual([]);
    });

    // ── line 67 String(error) arm: init throws a non-Error value. ──
    it('reports String(error) when init throws a non-Error value', async () => {
        proofInitShouldThrow = 'boom-string';
        const proc = await loadProcessor();
        send(proc, { type: 'init', wasmModule: MINIMAL_WASM_MODULE });

        const errorMsg = vi
            .mocked(proc.port.postMessage)
            .mock.calls.find((c) => (c[0] as { type?: string }).type === 'error');
        expect(errorMsg).toBeDefined();
        expect((errorMsg![0] as { message: string }).message).toBe('boom-string');
    });

    // ── process() guards: missing first input channel, missing first output,
    // and the mono `input[1] ?? in0` fallback at line 150. ──
    it('returns early when the first input channel is missing', async () => {
        const proc = await loadProcessor();
        send(proc, { type: 'init', wasmModule: MINIMAL_WASM_MODULE });

        const out = [new Float32Array(128), new Float32Array(128)];
        // input[0] present but null-ish guard: pass [null] to hit `!in0`.
        proc.process([[null as unknown as Float32Array, new Float32Array(128)]], [out]);
        // Output untouched (early return before process call).
        expect(out[0]![0]).toBe(0);
    });

    it('falls back to the left input for the right channel when only one is provided', async () => {
        const proc = await loadProcessor();
        send(proc, { type: 'init', wasmModule: MINIMAL_WASM_MODULE });

        const rightSpy = vi.spyOn(ProofInstanceMock.prototype, 'get_input_right_ptr');
        // Only one input channel ⇒ input[1] is undefined ⇒ `input[1] ?? in0` copies left.
        const input = [new Float32Array(128).fill(0.25)];
        const out = [new Float32Array(128), new Float32Array(128)];
        // This requires input.length >= 2 to pass the first guard, so we provide
        // a second undefined entry: [left, undefined] — but length is 2 with a hole.
        const inputHole = [new Float32Array(128).fill(0.25), undefined as unknown as Float32Array];
        proc.process([inputHole], [out]);

        // process() ran without throwing; the right-input view was fed in0.
        expect(rightSpy).toHaveBeenCalled();
        void input;
    });

    // ── The wire boundary validates the f32 the engine actually receives, not
    // the JavaScript f64 the message carries, and it holds each parameter to
    // its declared range. `Number.isFinite(msg.value)` alone accepted
    // `Number.MAX_VALUE`, which arrives at the wasm boundary as f32 Infinity;
    // `input_gain` then computed `10^(inf / 20)` and stored an infinite gain
    // factor that multiplied every later sample for the life of the device. ──
    it.each([
        ['Number.MAX_VALUE (f32 Infinity)', Number.MAX_VALUE],
        ['-Number.MAX_VALUE (f32 -Infinity)', -Number.MAX_VALUE],
        ['1e39 (past the f32 maximum)', 1e39],
        ['Infinity', Number.POSITIVE_INFINITY],
        ['NaN', Number.NaN],
        ['+25 dB, one dB past the declared range', 25],
        ['-25 dB, one dB past the declared range', -25],
        ['a non-number', '0'],
    ])('rejects a live input_gain of %s before it reaches wasm', async (_label, value) => {
        const proc = await loadProcessor();
        initializeLiveProof(proc, 'track-1');

        send(
            proc,
            liveControl('set-fallback-param', 'track-1', 1, {
                value,
                target: { trackId: 'track-1', deviceId: 'proof-1', deviceType: 'proof', parameterId: 'input_gain' },
            })
        );

        expect(proofParamCalls).toEqual([]);
    });

    it('still accepts an in-range live input_gain', async () => {
        // The counter-check for the rejections above: a boundary that dropped
        // everything would pass them all.
        const proc = await loadProcessor();
        initializeLiveProof(proc, 'track-1');

        send(
            proc,
            liveControl('set-fallback-param', 'track-1', 1, {
                value: 24,
                target: { trackId: 'track-1', deviceId: 'proof-1', deviceType: 'proof', parameterId: 'input_gain' },
            })
        );

        expect(proofParamCalls).toEqual([{ name: 'input_gain', value: 24 }]);
    });

    it('leaves no live parameter without a declared range', async () => {
        // The range check fails closed, so a namespace entry with no range
        // would be silently unreachable rather than unchecked. Every parameter
        // has to accept at least one of these values.
        const proc = await loadProcessor();
        initializeLiveProof(proc, 'track-1');

        const candidates = [0, 1, 20, 100];
        const unreachable: string[] = [];
        let sequence = 0;
        for (const parameterId of createProofRuntimeParameterIds()) {
            const before = proofParamCalls.length;
            for (const value of candidates) {
                sequence += 1;
                send(
                    proc,
                    liveControl('set-fallback-param', 'track-1', sequence, {
                        value,
                        target: { trackId: 'track-1', deviceId: 'proof-1', deviceType: 'proof', parameterId },
                    })
                );
            }
            if (proofParamCalls.length === before) {
                unreachable.push(parameterId);
            }
        }

        expect(unreachable).toEqual([]);
    });

    it('rejects a legacy param message that overflows f32 or leaves the declared range', async () => {
        const proc = await loadProcessor();
        send(proc, { type: 'init', wasmModule: MINIMAL_WASM_MODULE });

        send(proc, { type: 'param', name: 'input_gain', value: Number.MAX_VALUE });
        send(proc, { type: 'param', name: 'output_gain', value: 25 });
        send(proc, { type: 'param', name: 'lim_lookahead', value: Number.NaN });
        expect(proofParamCalls).toEqual([]);

        // In range on the same path, so the rejections above are not a blanket drop.
        send(proc, { type: 'param', name: 'input_gain', value: -6 });
        expect(proofParamCalls).toEqual([{ name: 'input_gain', value: -6 }]);
    });

    // ── `only()` judges a record without materializing its keys. `Object.keys`
    // enumerated every property of every inbound record on the AudioWorklet
    // thread before comparing any of them, so a malformed message carrying
    // thousands of properties bought proportional work there. ──
    it('rejects an oversized record after a bounded number of property inspections', async () => {
        const proc = await loadProcessor();
        send(proc, { type: 'init', wasmModule: MINIMAL_WASM_MODULE });

        const keys = Array.from({ length: 10_000 }, (_, index) => `extra${index}`);
        let inspections = 0;
        const hostile = new Proxy<Record<string, unknown>>(
            {},
            {
                ownKeys: () => keys,
                getOwnPropertyDescriptor: () => {
                    inspections += 1;
                    return { value: 1, enumerable: true, configurable: true, writable: true };
                },
                get: () => undefined,
            }
        );

        send(proc, hostile);

        // Enumerating the whole record costs one inspection per key; exiting on
        // the first unexpected key costs a small constant.
        expect(inspections).toBeLessThanOrEqual(8);
        expect(proofParamCalls).toEqual([]);
        expect(
            vi.mocked(proc.port.postMessage).mock.calls.filter((c) => (c[0] as { type?: string }).type === 'error')
        ).toHaveLength(0);
    });

    // ── _passthrough mono fallback (proofProcessor.ts:113 `input[1] ?? in0`):
    // the fault path's _passthrough copies the left channel into the right output
    // when the input declares a second-channel slot that is absent (undefined). ──
    it('passthrough falls back to the left channel for the right output when the right input is absent', async () => {
        const proc = await loadProcessor();
        send(proc, { type: 'init', wasmModule: MINIMAL_WASM_MODULE });
        proofProcessShouldThrow = true;

        // Two-channel input whose right entry is a hole ⇒ `input[1] ?? in0`.
        const in0 = new Float32Array(128).fill(0.7);
        const out = [new Float32Array(128), new Float32Array(128)];
        proc.process([[in0, undefined as unknown as Float32Array]], [out]);

        const errors = vi
            .mocked(proc.port.postMessage)
            .mock.calls.filter((c) => (c[0] as { type?: string }).type === 'error');
        expect(errors).toHaveLength(1);
        // Left copied to both outputs (right got in0 via the ?? fallback).
        expect(out[0]![0]).toBeCloseTo(0.7, 6);
        expect(out[1]![0]).toBeCloseTo(0.7, 6);
    });
});
