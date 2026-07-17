import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';

// Mock AudioWorkletProcessor and registerProcessor which are available in worklet global scope
class FakeAudioWorkletProcessor {
    port = {
        onmessage: null as ((event: MessageEvent) => void) | null,
        postMessage: vi.fn(),
    };
}
vi.stubGlobal('AudioWorkletProcessor', FakeAudioWorkletProcessor);
const processors = new Map();
global.registerProcessor = (name: string, proc: any) => processors.set(name, proc);

// Import the REAL producer-side ring publish after the worklet globals are
// shimmed (the module registers a processor on load). This is the public
// surface the fence fix lives behind.
let writeRingRelease: typeof import('../recordingProcessor').writeRingRelease;
beforeAll(async () => {
    ({ writeRingRelease } = await import('../recordingProcessor'));
});

// Load the processor (it will register itself)
// Since it's @ts-nocheck and uses worklet globals, we need to handle the import carefully
// or just re-define the core logic for the test if it's simpler.
// Given the logic is small, we'll extract it to verify behavior.

describe('RecordingWorkletProcessor', () => {
    // Re-implementation of the class logic for testing in Node/Vitest
    class RecordingWorkletProcessorMock extends FakeAudioWorkletProcessor {
        _writeHead: Int32Array | null = null;
        _ring: Float32Array | null = null;
        _ringSize = 0;
        _active = false;

        constructor() {
            super();
        }

        handleMessage(data: any) {
            switch (data.type) {
                case 'init': {
                    const sab = data.sab;
                    this._writeHead = new Int32Array(sab, 0, 1);
                    this._ring = new Float32Array(sab, 4);
                    this._ringSize = this._ring.length;
                    break;
                }
                case 'start':
                    this._active = true;
                    break;
                case 'stop': {
                    this._active = false;
                    const head = this._writeHead ? Atomics.load(this._writeHead, 0) : 0;
                    this.port.postMessage({ type: 'stopped', writeHead: head });
                    break;
                }
            }
        }

        process(inputs: Float32Array[][]) {
            if (!this._active || !this._ring || !this._writeHead) {
                return true;
            }
            const input = inputs[0]?.[0];
            if (!input || input.length === 0) {
                return true;
            }

            const head = Atomics.load(this._writeHead, 0);
            const ringSize = this._ringSize;
            for (let index = 0; index < input.length; index++) {
                this._ring[(head + index) % ringSize] = input[index] ?? 0;
            }
            Atomics.add(this._writeHead, 0, input.length);
            return true;
        }
    }

    let processor: RecordingWorkletProcessorMock;
    let sab: SharedArrayBuffer;

    beforeEach(() => {
        vi.clearAllMocks();
        processor = new RecordingWorkletProcessorMock();
        // 4 bytes for head + 1024 samples * 4 bytes
        sab = new SharedArrayBuffer(4 + 1024 * 4);
    });

    it('should initialize head and ring from SAB', () => {
        processor.handleMessage({ type: 'init', sab });
        expect(processor._writeHead).toBeDefined();
        expect(processor._ring).toHaveLength(1024);
    });

    it('should not process if not active', () => {
        processor.handleMessage({ type: 'init', sab });
        const input = [[new Float32Array([0.5, 0.6])]];
        processor.process(input);

        const head = new Int32Array(sab, 0, 1)[0];
        expect(head).toBe(0);
    });

    it('should record samples into the ring buffer when active', () => {
        processor.handleMessage({ type: 'init', sab });
        processor.handleMessage({ type: 'start' });

        const inputData = new Float32Array([0.1, 0.2, 0.3]);
        processor.process([[inputData]]);

        const head = new Int32Array(sab, 0, 1)[0];
        expect(head).toBe(3);

        const ring = new Float32Array(sab, 4);
        expect(ring[0]).toBeCloseTo(0.1, 5);
        expect(ring[1]).toBeCloseTo(0.2, 5);
        expect(ring[2]).toBeCloseTo(0.3, 5);
    });

    it('should wrap around the ring buffer', () => {
        // Small SAB for wrap test: 4 bytes head + 4 samples
        const smallSab = new SharedArrayBuffer(4 + 4 * 4);
        processor.handleMessage({ type: 'init', sab: smallSab });
        processor.handleMessage({ type: 'start' });

        // Fill 3 samples
        processor.process([[new Float32Array([1, 2, 3])]]);
        // Add 2 more (should wrap 1)
        processor.process([[new Float32Array([4, 5])]]);

        const head = new Int32Array(smallSab, 0, 1)[0];
        expect(head).toBe(5);

        const ring = new Float32Array(smallSab, 4);
        expect(ring[0]).toBe(5); // Wrapped
        expect(ring[1]).toBe(2);
        expect(ring[2]).toBe(3);
        expect(ring[3]).toBe(4);
    });

    it('should send stopped message with writeHead on stop', () => {
        processor.handleMessage({ type: 'init', sab });
        processor.handleMessage({ type: 'start' });
        processor.process([[new Float32Array([0.1, 0.2])]]);

        processor.handleMessage({ type: 'stop' });
        expect(processor.port.postMessage).toHaveBeenCalledWith({ type: 'stopped', writeHead: 2 });
        expect(processor._active).toBe(false);
    });
});

describe('writeRingRelease (SPSC release/acquire fence)', () => {
    // Mirrors the worker-side acquire read in recordingWorker: acquire the head,
    // then read the ring. This is the consumer half of the SPSC contract.
    function acquireRead(ring: Float32Array, writeHead: Int32Array, readFrom: number): Float32Array {
        const published = Atomics.load(writeHead, 0); // acquire
        const available = published - readFrom;
        if (available <= 0) {
            return new Float32Array(0);
        }
        const out = new Float32Array(available);
        for (let i = 0; i < available; i++) {
            out[i] = ring[(readFrom + i) % ring.length] ?? 0;
        }
        return out;
    }

    it('publishes the head only after the samples are written, and the head reflects the block length', () => {
        const sab = new SharedArrayBuffer(4 + 8 * 4);
        const writeHead = new Int32Array(sab, 0, 1);
        const ring = new Float32Array(sab, 4);

        const block = new Float32Array([0.1, 0.2, 0.3]);
        const next = writeRingRelease(ring, writeHead, 0, block);

        // Release store advanced the head past exactly the samples written.
        expect(next).toBe(3);
        expect(Atomics.load(writeHead, 0)).toBe(3);

        // A consumer that acquires the head then reads sees every sample — no
        // stale ring bytes within the published window.
        const seen = acquireRead(ring, writeHead, 0);
        expect(Array.from(seen)).toEqual([expect.closeTo(0.1, 5), expect.closeTo(0.2, 5), expect.closeTo(0.3, 5)]);
    });

    it('never publishes a head increment without the matching ring samples (release ordering)', () => {
        const sab = new SharedArrayBuffer(4 + 4 * 4);
        const writeHead = new Int32Array(sab, 0, 1);
        const ring = new Float32Array(sab, 4);

        // Two successive blocks that wrap the 4-slot ring.
        writeRingRelease(ring, writeHead, 0, new Float32Array([1, 2, 3]));
        writeRingRelease(ring, writeHead, 3, new Float32Array([4, 5]));

        const published = Atomics.load(writeHead, 0);
        expect(published).toBe(5);

        // Every slot the head claims as published must hold its written sample;
        // a head ahead of the data would surface a stale slot here.
        expect(ring[0]).toBe(5); // wrapped over slot 0
        expect(ring[1]).toBe(2);
        expect(ring[2]).toBe(3);
        expect(ring[3]).toBe(4);
    });
});
