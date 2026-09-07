import { describe, it, expect, beforeEach, type vi } from 'vitest';

import {
    readRecordingPublication,
    RECORDING_RING_CONTROL_BYTES,
    RECORDING_RING_CONTROL_INTS,
    RECORDING_RING_SEQUENCE_INDEX,
    storeRecordingSampleCount,
} from '../../models/RecordingRingProtocol';

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

function makeSab(ringSamples: number): { sab: SharedArrayBuffer; control: Int32Array; ring: Float32Array } {
    const sab = new SharedArrayBuffer(RECORDING_RING_CONTROL_BYTES + ringSamples * Float32Array.BYTES_PER_ELEMENT);
    const control = new Int32Array(sab, 0, RECORDING_RING_CONTROL_INTS);
    const ring = new Float32Array(sab, RECORDING_RING_CONTROL_BYTES);
    return { sab, control, ring };
}

function publishedCount(control: Int32Array): number {
    const publication = readRecordingPublication(control);
    if (publication.status !== 'stable') {
        throw new Error(`expected stable publication, got ${publication.status}`);
    }
    return publication.sampleCount;
}

describe('RecordingWorkletProcessor (real instance)', () => {
    let proc: RecordingProcessorLike;

    beforeEach(async () => {
        proc = await loadProcessor();
    });

    it('init wires the control words and Float32 ring', () => {
        const { sab, control, ring } = makeSab(8);
        send(proc, { type: 'init', sab });
        // After init, advancing the ring through start+process proves the views
        // alias the same SAB bytes the main thread inspects.
        send(proc, { type: 'start' });
        proc.process([[new Float32Array([0.1, 0.2, 0.3])]]);
        expect(publishedCount(control)).toBe(3);
        expect(ring[0]).toBeCloseTo(0.1, 6);
        expect(ring[1]).toBeCloseTo(0.2, 6);
        expect(ring[2]).toBeCloseTo(0.3, 6);
    });

    it('process is a no-op before start (not active)', () => {
        const { sab, control } = makeSab(8);
        send(proc, { type: 'init', sab });
        proc.process([[new Float32Array([0.5, 0.6])]]);
        expect(publishedCount(control)).toBe(0);
    });

    it('process is a no-op before init (no ring/head)', () => {
        send(proc, { type: 'start' });
        proc.process([[new Float32Array([0.5, 0.6])]]);
        // No throw, no crash — guard returns early.
        expect(proc.process([[new Float32Array([0.5])]])).toBe(true);
    });

    it('process is a no-op when the input is absent or empty', () => {
        const { sab, control } = makeSab(8);
        send(proc, { type: 'init', sab });
        send(proc, { type: 'start' });
        // No input bus at all.
        proc.process([[]]);
        // Input channel present but zero-length.
        proc.process([[new Float32Array(0)]]);
        expect(publishedCount(control)).toBe(0);
    });

    it('records successive blocks and wraps around the ring', () => {
        const { sab, control, ring } = makeSab(4);
        send(proc, { type: 'init', sab });
        send(proc, { type: 'start' });
        // Block of 3 then 2 → head advances to 5, ring wraps (4-slot).
        proc.process([[new Float32Array([1, 2, 3])]]);
        proc.process([[new Float32Array([4, 5])]]);
        expect(publishedCount(control)).toBe(5);
        // Slot 0 overwritten by sample index 4 (value 5) of the second block.
        expect(ring[0]).toBe(5);
        expect(ring[1]).toBe(2);
        expect(ring[2]).toBe(3);
        expect(ring[3]).toBe(4);
    });

    it('stop sets inactive and acknowledges the final cumulative sample count', () => {
        const { sab, control } = makeSab(16);
        send(proc, { type: 'init', sab });
        send(proc, { type: 'start' });
        proc.process([[new Float32Array([0.1, 0.2])]]);
        send(proc, { type: 'stop' });
        expect(proc.port.postMessage).toHaveBeenCalledWith({ type: 'stopped', publishedSampleCount: 2 });
        // After stop, further process calls do not advance the head.
        proc.process([[new Float32Array([0.3, 0.4])]]);
        expect(publishedCount(control)).toBe(2);
    });

    it('acknowledges sample count 0 when stopped before init', () => {
        send(proc, { type: 'stop' });
        expect(proc.port.postMessage).toHaveBeenCalledWith({ type: 'stopped', publishedSampleCount: 0 });
    });
});

describe('writeRingRelease (SPSC release/acquire fence)', () => {
    // Import the real producer-side publish (the processor re-uses it).
    let writeRingRelease: typeof import('../recordingProcessor').writeRingRelease;
    beforeEach(async () => {
        ({ writeRingRelease } = await import('../recordingProcessor'));
    });

    it('publishes the head only after the samples are written', () => {
        const { control, ring } = makeSab(8);
        const block = new Float32Array([0.1, 0.2, 0.3]);
        let sequenceDuringFirstWrite: number | null = null;
        const observedRing = new Proxy(ring, {
            set(target, property, value): boolean {
                if (sequenceDuringFirstWrite === null && typeof property === 'string' && /^\d+$/.test(property)) {
                    sequenceDuringFirstWrite = Atomics.load(control, RECORDING_RING_SEQUENCE_INDEX) >>> 0;
                }
                return Reflect.set(target, property, value, target);
            },
            get: (target, property) => Reflect.get(target, property, target),
        });
        const next = writeRingRelease(observedRing, control, 0, block);
        expect(next).toBe(3);
        expect(sequenceDuringFirstWrite).toBe(1);
        expect(publishedCount(control)).toBe(3);
        expect(ring[0]).toBeCloseTo(0.1, 6);
        expect(ring[1]).toBeCloseTo(0.2, 6);
        expect(ring[2]).toBeCloseTo(0.3, 6);
    });

    it('wraps the ring correctly across two blocks that overflow the slots', () => {
        const { control, ring } = makeSab(4);
        writeRingRelease(ring, control, 0, new Float32Array([1, 2, 3]));
        writeRingRelease(ring, control, 3, new Float32Array([4, 5]));
        expect(publishedCount(control)).toBe(5);
        expect(ring[0]).toBe(5); // wrapped over slot 0
        expect(ring[1]).toBe(2);
        expect(ring[2]).toBe(3);
        expect(ring[3]).toBe(4);
    });

    it('keeps indexing the ring after the Int32 publication crosses its signed boundary', () => {
        const { control, ring } = makeSab(512);
        const beforeRollover = 2_147_483_600;
        storeRecordingSampleCount(control, beforeRollover);
        const first = new Float32Array(128).fill(0.25);
        const second = new Float32Array(128).fill(0.75);

        const afterFirst = writeRingRelease(ring, control, beforeRollover, first);
        const afterSecond = writeRingRelease(ring, control, afterFirst, second);

        expect(afterSecond).toBe(beforeRollover + 256);
        expect(publishedCount(control)).toBe(beforeRollover + 256);
        expect(ring[beforeRollover % ring.length]).toBe(0.25);
        expect(ring[afterFirst % ring.length]).toBe(0.75);
    });

    it('keeps exact publication and indexing across the full unsigned boundary and sequence wrap', () => {
        const { control, ring } = makeSab(512);
        const beforeRollover = 0x1_0000_0000 - 64;
        storeRecordingSampleCount(control, beforeRollover);
        Atomics.store(control, RECORDING_RING_SEQUENCE_INDEX, -2);

        const afterFirst = writeRingRelease(ring, control, beforeRollover, new Float32Array(128).fill(0.5));
        writeRingRelease(ring, control, afterFirst, new Float32Array(128).fill(-0.5));

        expect(Atomics.load(control, RECORDING_RING_SEQUENCE_INDEX) >>> 0).toBe(2);
        expect(publishedCount(control)).toBe(0x1_0000_0000 + 192);
        expect(ring[448]).toBe(0.5);
        expect(ring[64]).toBe(-0.5);
    });
});
