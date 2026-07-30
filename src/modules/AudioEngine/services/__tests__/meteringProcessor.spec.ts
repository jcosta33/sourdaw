import { describe, it, expect, vi, beforeEach } from 'vitest';

// --- Worklet global scope shims -------------------------------------------
// The processor runs in AudioWorklet global scope, which provides
// AudioWorkletProcessor and registerProcessor. Provide them so the real module
// can be imported and self-register.
const registry = new Map<string, new () => MeteringProcessorLike>();

class AudioWorkletProcessorShim {
    port = {
        onmessage: null as ((event: { data: unknown }) => void) | null,
        postMessage: vi.fn(),
    };
}

type MeteringProcessorLike = {
    port: {
        onmessage: ((event: { data: unknown }) => void) | null;
        postMessage: (msg: unknown) => void;
    };
    process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean;
};

vi.stubGlobal('AudioWorkletProcessor', AudioWorkletProcessorShim);
vi.stubGlobal('registerProcessor', (name: string, proc: new () => MeteringProcessorLike) => {
    registry.set(name, proc);
});
vi.stubGlobal('sampleRate', 48000);

async function loadProcessor(): Promise<MeteringProcessorLike> {
    await import('../meteringProcessor');
    const Ctor = registry.get('metering-processor');
    if (!Ctor) {
        throw new Error('metering-processor was not registered');
    }
    return new Ctor();
}

function sendInit(proc: MeteringProcessorLike, sab: SharedArrayBuffer): void {
    proc.port.onmessage?.({ data: { type: 'init', sab } });
}

describe('MeteringWorkletProcessor peak capture', () => {
    let sab: SharedArrayBuffer;
    let peakView: Float32Array;

    beforeEach(() => {
        sab = new SharedArrayBuffer(2 * Float32Array.BYTES_PER_ELEMENT);
        peakView = new Float32Array(sab);
    });

    // ── Fix 8: the meter must scan every input channel into its one peak slot ──
    //
    // The SAB holds a single combined peak and the read surface returns one
    // number, so the meter is mono-by-design. The defect was a caller-supplied
    // `channels` count gating the scan against a 1-float buffer: a hard-panned
    // signal whose peak lives in the right channel was under-reported whenever
    // the scan stopped short of it. The processor must scan all present channels.
    it('captures a peak that lives only in the right channel', async () => {
        const proc = await loadProcessor();
        sendInit(proc, sab);

        // Left channel silent, right channel carries the peak (hard-panned right).
        const left = new Float32Array(128); // all zeros
        const right = new Float32Array(128);
        right[10] = 0.8;

        const output = [new Float32Array(128), new Float32Array(128)];
        proc.process([[left, right]], [output]);

        // The single peak slot must reflect the right-channel peak, not 0.
        expect(peakView[0]).toBeCloseTo(0.8, 5);
    });

    it('reports the maximum absolute sample across both channels', async () => {
        const proc = await loadProcessor();
        sendInit(proc, sab);

        const left = new Float32Array(128);
        left[3] = -0.5; // abs 0.5
        const right = new Float32Array(128);
        right[7] = 0.9; // abs 0.9 — the larger of the two

        const output = [new Float32Array(128), new Float32Array(128)];
        proc.process([[left, right]], [output]);

        expect(peakView[0]).toBeCloseTo(0.9, 5);
    });

    it('keeps independent peaks for separate pooled inputs', async () => {
        const proc = await loadProcessor();
        sendInit(proc, sab);

        const first = new Float32Array(128);
        first[3] = 0.4;
        const second = new Float32Array(128);
        second[7] = -0.85;

        proc.process([[first], [second]], []);

        expect(peakView[0]).toBeCloseTo(0.4, 5);
        expect(peakView[1]).toBeCloseTo(0.85, 5);
    });

    it('accumulates the running peak across blocks (Math.max, not overwrite)', async () => {
        const proc = await loadProcessor();
        sendInit(proc, sab);

        const out = [new Float32Array(128), new Float32Array(128)];

        const loud = new Float32Array(128);
        loud[0] = 0.7;
        proc.process([[loud, new Float32Array(128)]], [out]);
        expect(peakView[0]).toBeCloseTo(0.7, 5);

        // A quieter block must NOT lower the held peak (the UI read-and-resets).
        const quiet = new Float32Array(128);
        quiet[0] = 0.2;
        proc.process([[quiet, new Float32Array(128)]], [out]);
        expect(peakView[0]).toBeCloseTo(0.7, 5);
    });

    it('terminates its render callback after shutdown', async () => {
        const proc = await loadProcessor();
        sendInit(proc, sab);

        proc.port.onmessage?.({ data: { type: 'shutdown' } });

        expect(proc.process([], [])).toBe(false);
    });

    it('ignores inputs beyond the bounded shared-memory slot count', async () => {
        const proc = await loadProcessor();
        sendInit(proc, sab);

        const signal = new Float32Array([0.7]);
        expect(proc.process([[signal], [signal], [signal]], [])).toBe(true);
        expect(peakView[0]).toBeCloseTo(0.7, 5);
        expect(peakView[1]).toBeCloseTo(0.7, 5);
    });
});
