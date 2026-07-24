import { describe, it, expect, beforeEach, type vi } from 'vitest';

import { installWorkletGlobals } from './wasmViewGrowthHarness';

// RecordingWorkletProcessor: REAL processor (instantiated from the worklet
// registry) covers init/start/stop message handling, the capture guards (not
// active / no ring / empty input), wrap-around, and the stopped ack. The
// exported `writeRingRelease` SPSC publish is covered directly below.

type RecordingProcessorLike = {
    port: { onmessage: ((event: { data: unknown }) => void) | null; postMessage: ReturnType<typeof vi.fn> };
    process(inputs: Float32Array[][]): boolean;
};

const { registry } = installWorkletGlobals<RecordingProcessorLike>();

async function loadProcessor(): Promise<RecordingProcessorLike> {
    await import('../recordingProcessor');
    const Ctor = registry.get('recording-processor');
    if (!Ctor) {
        throw new Error('recording-processor was not registered');
    }
    return new Ctor();
}

function send(proc: RecordingProcessorLike, data: unknown): void {
    proc.port.onmessage?.({ data });
}

// The ring layout the processor assumes: Int32 head at byte 0, Float32 ring
// after byte 4.
function makeSab(ringSamples: number): { sab: SharedArrayBuffer; head: Int32Array; ring: Float32Array } {
    const sab = new SharedArrayBuffer(4 + ringSamples * Float32Array.BYTES_PER_ELEMENT);
    const head = new Int32Array(sab, 0, 1);
    const ring = new Float32Array(sab, 4);
    return { sab, head, ring };
}

describe('RecordingWorkletProcessor (real instance)', () => {
    let proc: RecordingProcessorLike;

    beforeEach(async () => {
        proc = await loadProcessor();
    });

    it('init wires the write-head Int32 view and the Float32 ring', () => {
        const { sab, head, ring } = makeSab(8);
        send(proc, { type: 'init', sab });
        // After init, advancing the ring through start+process proves the views
        // alias the same SAB bytes the main thread inspects.
        send(proc, { type: 'start' });
        proc.process([[new Float32Array([0.1, 0.2, 0.3])]]);
        expect(Atomics.load(head, 0)).toBe(3);
        expect(ring[0]).toBeCloseTo(0.1, 6);
        expect(ring[1]).toBeCloseTo(0.2, 6);
        expect(ring[2]).toBeCloseTo(0.3, 6);
    });

    it('process is a no-op before start (not active)', () => {
        const { sab, head } = makeSab(8);
        send(proc, { type: 'init', sab });
        proc.process([[new Float32Array([0.5, 0.6])]]);
        expect(Atomics.load(head, 0)).toBe(0);
    });

    it('process is a no-op before init (no ring/head)', () => {
        send(proc, { type: 'start' });
        proc.process([[new Float32Array([0.5, 0.6])]]);
        // No throw, no crash — guard returns early.
        expect(proc.process([[new Float32Array([0.5])]])).toBe(true);
    });

    it('process is a no-op when the input is absent or empty', () => {
        const { sab, head } = makeSab(8);
        send(proc, { type: 'init', sab });
        send(proc, { type: 'start' });
        // No input bus at all.
        proc.process([[]]);
        // Input channel present but zero-length.
        proc.process([[new Float32Array(0)]]);
        expect(Atomics.load(head, 0)).toBe(0);
    });

    it('records successive blocks and wraps around the ring', () => {
        const { sab, head, ring } = makeSab(4);
        send(proc, { type: 'init', sab });
        send(proc, { type: 'start' });
        // Block of 3 then 2 → head advances to 5, ring wraps (4-slot).
        proc.process([[new Float32Array([1, 2, 3])]]);
        proc.process([[new Float32Array([4, 5])]]);
        expect(Atomics.load(head, 0)).toBe(5);
        // Slot 0 overwritten by sample index 4 (value 5) of the second block.
        expect(ring[0]).toBe(5);
        expect(ring[1]).toBe(2);
        expect(ring[2]).toBe(3);
        expect(ring[3]).toBe(4);
    });

    it('stop sets inactive and acks with the final writeHead', () => {
        const { sab, head } = makeSab(16);
        send(proc, { type: 'init', sab });
        send(proc, { type: 'start' });
        proc.process([[new Float32Array([0.1, 0.2])]]);
        send(proc, { type: 'stop' });
        expect(proc.port.postMessage).toHaveBeenCalledWith({ type: 'stopped', writeHead: 2 });
        // After stop, further process calls do not advance the head.
        proc.process([[new Float32Array([0.3, 0.4])]]);
        expect(Atomics.load(head, 0)).toBe(2);
    });

    it('stop acks writeHead 0 when stopped before init (no head view)', () => {
        send(proc, { type: 'stop' });
        expect(proc.port.postMessage).toHaveBeenCalledWith({ type: 'stopped', writeHead: 0 });
    });
});

describe('writeRingRelease (SPSC release/acquire fence)', () => {
    // Import the real producer-side publish (the processor re-uses it).
    let writeRingRelease: typeof import('../recordingProcessor').writeRingRelease;
    beforeEach(async () => {
        ({ writeRingRelease } = await import('../recordingProcessor'));
    });

    it('publishes the head only after the samples are written', () => {
        const { head, ring } = makeSab(8);
        const block = new Float32Array([0.1, 0.2, 0.3]);
        const next = writeRingRelease(ring, head, 0, block);
        expect(next).toBe(3);
        expect(Atomics.load(head, 0)).toBe(3);
        expect(ring[0]).toBeCloseTo(0.1, 6);
        expect(ring[1]).toBeCloseTo(0.2, 6);
        expect(ring[2]).toBeCloseTo(0.3, 6);
    });

    it('wraps the ring correctly across two blocks that overflow the slots', () => {
        const { head, ring } = makeSab(4);
        writeRingRelease(ring, head, 0, new Float32Array([1, 2, 3]));
        writeRingRelease(ring, head, 3, new Float32Array([4, 5]));
        expect(Atomics.load(head, 0)).toBe(5);
        expect(ring[0]).toBe(5); // wrapped over slot 0
        expect(ring[1]).toBe(2);
        expect(ring[2]).toBe(3);
        expect(ring[3]).toBe(4);
    });
});
