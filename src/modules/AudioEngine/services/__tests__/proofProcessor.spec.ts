import { describe, it, expect, vi, beforeEach } from 'vitest';

// --- Worklet global scope shims -------------------------------------------
const registry = new Map<string, new () => ProofProcessorLike>();

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
vi.stubGlobal('registerProcessor', (name: string, proc: new () => ProofProcessorLike) => {
    registry.set(name, proc);
});
vi.stubGlobal('sampleRate', 48000);

// --- WASM module mock ------------------------------------------------------
// A heap large enough for the in/out scratch pointers the processor maps.
const WASM_HEAP = new ArrayBuffer(64 * 1024);

class ProofInstanceMock {
    process(): number {
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
        return 256;
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
    set_param(): void {}
    reorder(): void {}
    reset_integrated(): void {}
}

vi.mock('../../wasm/daw_dsp.js', () => ({
    initSync: vi.fn(() => ({ memory: { buffer: WASM_HEAP } })),
    ProofInstance: ProofInstanceMock,
}));

const MINIMAL_WASM = new Uint8Array([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]);

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
    return new Ctor();
}

function send(proc: ProofProcessorLike, data: unknown): void {
    proc.port.onmessage?.({ data });
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
        send(proc, { type: 'init', wasmBytes: MINIMAL_WASM });
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
