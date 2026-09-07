import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import {
    beginRecordingRingWrite,
    completeRecordingRingWrite,
    RECORDING_RING_CONTROL_BYTES,
    RECORDING_RING_CONTROL_INTS,
    RECORDING_RING_SEQUENCE_INDEX,
    storeRecordingSampleCount,
} from '../../models/RecordingRingProtocol';

/**
 * Tests for the recording OPFS worker.
 *
 * Two concerns are covered through the worker's public surface:
 *   1. WAV header reservation — the 44-byte header must NOT clobber the first
 *      samples of audio (prior-audit #6). PCM begins at byte 44; the header is
 *      patched in place on stop.
 *   2. The exported pure helpers (`buildWavHeader`, `acquireRingChunk`) that the
 *      drain/stop paths are built from.
 *
 * The worker is an entry-point module: on import it wires `self.onmessage`.
 * jsdom provides `self`; we drive the real protocol and supply an in-memory
 * OPFS fake so `drain` + `stopWorker` run against real file semantics.
 */

// ── In-memory OPFS fake ──────────────────────────────────────────────────────
// A FileSystemWritableFileStream writes sequentially from position 0 unless a
// `{ type: 'write', position }` command seeks. `keepExistingData: true` preserves
// the prior contents; the default truncates. This mirrors the spec closely
// enough to prove the byte layout the fix depends on.
type WritableInput = ArrayBuffer | ArrayBufferView | { type: 'write'; position: number; data: ArrayBuffer };

let beforeWrite: ((input: WritableInput) => Promise<void>) | null = null;

class FakeWritable {
    private pos = 0;
    constructor(private readonly store: { bytes: Uint8Array }) {}

    private ensure(size: number): void {
        if (size > this.store.bytes.length) {
            const grown = new Uint8Array(size);
            grown.set(this.store.bytes);
            this.store.bytes = grown;
        }
    }

    async write(input: WritableInput): Promise<void> {
        await beforeWrite?.(input);
        let data: Uint8Array;
        if (input instanceof ArrayBuffer) {
            data = new Uint8Array(input);
        } else if (ArrayBuffer.isView(input)) {
            data = new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
        } else {
            this.pos = input.position;
            data = new Uint8Array(input.data);
        }
        this.ensure(this.pos + data.length);
        this.store.bytes.set(data, this.pos);
        this.pos += data.length;
    }

    close(): Promise<void> {
        return Promise.resolve();
    }
}

class FakeFileHandle {
    store = { bytes: new Uint8Array(0) };
    createWritable(opts?: { keepExistingData?: boolean }): Promise<FakeWritable> {
        if (!opts?.keepExistingData) {
            this.store.bytes = new Uint8Array(0);
        }
        return Promise.resolve(new FakeWritable(this.store));
    }
    getFile(): Promise<{ arrayBuffer: () => Promise<ArrayBuffer> }> {
        const snapshot = this.store.bytes.slice();
        return Promise.resolve({
            arrayBuffer: () =>
                Promise.resolve(snapshot.buffer.slice(snapshot.byteOffset, snapshot.byteOffset + snapshot.byteLength)),
        });
    }
}

class FakeDirectory {
    handle = new FakeFileHandle();
    removedEntries: string[] = [];
    getFileHandle(): Promise<FakeFileHandle> {
        return Promise.resolve(this.handle);
    }
    removeEntry(name: string): Promise<void> {
        this.removedEntries.push(name);
        return Promise.resolve();
    }
}

let fakeDir: FakeDirectory;

// ── Worker driver ────────────────────────────────────────────────────────────
type WorkerModule = typeof import('../recordingWorker');
let mod: WorkerModule;
let messages: Array<Record<string, unknown>>;

async function loadWorker(): Promise<void> {
    vi.resetModules();
    messages = [];
    fakeDir = new FakeDirectory();
    beforeWrite = null;
    // jsdom provides `navigator`; attach an OPFS-shaped `storage` for the worker.
    (navigator as unknown as { storage: unknown }).storage = {
        getDirectory: () => Promise.resolve(fakeDir),
    };
    const onmessageHolder: { fn: ((e: MessageEvent) => void) | null } = { fn: null };
    Object.defineProperty(globalThis, 'self', {
        configurable: true,
        value: {
            set onmessage(fn: ((e: MessageEvent) => void) | null) {
                onmessageHolder.fn = fn;
            },
            get onmessage() {
                return onmessageHolder.fn;
            },
            postMessage: (data: Record<string, unknown>) => messages.push(data),
        },
    });
    mod = await import('../recordingWorker');
    // Surface the handler the module installed on `self`.
    sendToWorker = (data: unknown) => onmessageHolder.fn?.({ data } as MessageEvent);
}

let sendToWorker: (data: unknown) => void;

function makeRing(capacity: number): { sab: SharedArrayBuffer; control: Int32Array; ring: Float32Array } {
    const sab = new SharedArrayBuffer(RECORDING_RING_CONTROL_BYTES + capacity * Float32Array.BYTES_PER_ELEMENT);
    const control = new Int32Array(sab, 0, RECORDING_RING_CONTROL_INTS);
    const ring = new Float32Array(sab, RECORDING_RING_CONTROL_BYTES);
    return { sab, control, ring };
}

function publishCount(control: Int32Array, sampleCount: number): void {
    storeRecordingSampleCount(control, sampleCount);
}

async function loadActualProducer(): Promise<typeof import('../../services/recordingProcessor').writeRingRelease> {
    vi.stubGlobal('AudioWorkletProcessor', class {});
    vi.stubGlobal('registerProcessor', vi.fn());
    const { writeRingRelease } = await import('../../services/recordingProcessor');
    return writeRingRelease;
}

type AcquireResult = ReturnType<WorkerModule['acquireRingChunk']>;
type OkAcquireResult = Extract<AcquireResult, { status: 'ok' }>;

/** Narrow an acquire result to its `ok` variant, failing the test otherwise. */
function expectOkRead(result: AcquireResult): OkAcquireResult {
    if (result.status !== 'ok') {
        throw new Error(`expected an ok ring read, got '${result.status}'`);
    }
    return result;
}

/** Reinterpret a chunk's bytes as the Float32 samples that were copied. */
function chunkSamples(chunk: Uint8Array<ArrayBuffer>): number[] {
    const floats = new Float32Array(chunk.buffer, chunk.byteOffset, chunk.byteLength / 4);
    return Array.from(floats);
}

/** Wait for `postMessage` to emit a message of the given type. */
async function waitFor(type: string, timeoutMs = 1000): Promise<Record<string, unknown>> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        const found = messages.find((m) => m.type === type);
        if (found) {
            return found;
        }
        await new Promise((resolve) => setTimeout(resolve, 5));
    }
    throw new Error(`timed out waiting for '${type}' message; saw: ${messages.map((m) => m.type).join(', ')}`);
}

describe('buildWavHeader', () => {
    beforeEach(async () => {
        await loadWorker();
    });

    it('lays out a valid 44-byte mono float WAV header', () => {
        const header = mod.buildWavHeader(100, 48000);
        expect(header.byteLength).toBe(mod.WAV_HEADER_BYTES);
        const view = new DataView(header);
        expect(view.getUint32(0, false)).toBe(0x52494646); // RIFF
        expect(view.getUint32(4, true)).toBe(36 + 100 * 4); // chunk size
        expect(view.getUint32(8, false)).toBe(0x57415645); // WAVE
        expect(view.getUint16(20, true)).toBe(3); // IEEE float
        expect(view.getUint16(22, true)).toBe(1); // mono
        expect(view.getUint32(24, true)).toBe(48000); // sample rate
        expect(view.getUint32(40, true)).toBe(100 * 4); // data size
    });

    it('accepts the largest representable mono float32 RIFF and rejects the next sample', () => {
        const header = mod.buildWavHeader(mod.MAX_WAV_SAMPLES, 48000);
        const view = new DataView(header);
        expect(view.getUint32(4, true)).toBe(0xffff_fffc);
        expect(view.getUint32(40, true)).toBe(0xffff_ffd8);
        expect(() => mod.buildWavHeader(mod.MAX_WAV_SAMPLES + 1, 48000)).toThrow(RangeError);
        expect(mod.canAppendWavSamples(mod.MAX_WAV_SAMPLES - 1, 1)).toBe(true);
        expect(mod.canAppendWavSamples(mod.MAX_WAV_SAMPLES, 1)).toBe(false);
    });
});

describe('acquireRingChunk', () => {
    beforeEach(async () => {
        await loadWorker();
    });

    it('reads published samples after an acquire load of the head, handling wrap-around', () => {
        const { control, ring } = makeRing(4);
        // Producer published 6 samples into a 4-slot ring: samples 4 and 5
        // wrapped into slots 0 and 1.
        ring[0] = 4;
        ring[1] = 5;
        ring[2] = 2;
        ring[3] = 3;
        publishCount(control, 6);

        // The reader already drained 0–3; the remaining interval 4–5 starts
        // inside surviving history and reads the wrapped slots 0–1.
        const { chunk, nextReadHead } = expectOkRead(mod.acquireRingChunk(ring, control, 4));
        expect(nextReadHead).toBe(6);
        // The chunk is a byte view over a fresh ArrayBuffer; reinterpret as floats.
        expect(chunkSamples(chunk)).toEqual([4, 5]);
    });

    it('returns the drained bytes over a non-shared ArrayBuffer, decoupled from the ring SAB', () => {
        const { sab, control, ring } = makeRing(4);
        ring[0] = 1;
        ring[1] = 2;
        publishCount(control, 2);

        const { chunk } = expectOkRead(mod.acquireRingChunk(ring, control, 0));
        // FileSystemWritableFileStream rejects SharedArrayBuffer-backed views; the
        // chunk's backing buffer must be a plain, owned ArrayBuffer.
        expect(chunk.buffer).toBeInstanceOf(ArrayBuffer);
        expect(chunk.buffer).not.toBe(sab);
    });

    it('returns an empty chunk when nothing new is published', () => {
        const { control, ring } = makeRing(4);
        publishCount(control, 3);
        const { chunk, nextReadHead } = expectOkRead(mod.acquireRingChunk(ring, control, 3));
        expect(chunk.length).toBe(0);
        expect(nextReadHead).toBe(3);
    });

    it('reports overrun at capacity plus one instead of duplicated samples when the producer lapped the reader', () => {
        const { control, ring } = makeRing(4);
        // Writes 0..4 into a 4-slot ring: sample 0 was overwritten by 4. A
        // reader still at 0 asks for five samples out of four slots — the
        // requested interval no longer exists in the ring.
        ring[0] = 4;
        ring[1] = 1;
        ring[2] = 2;
        ring[3] = 3;
        publishCount(control, 5);

        const result = mod.acquireRingChunk(ring, control, 0);
        expect(result.status).toBe('overrun');
        if (result.status !== 'overrun') {
            throw new Error('expected the overrun variant');
        }
        expect(result.currentWrite).toBe(5);
        // The original implementation would have returned newer PCM as the
        // original interval. A failed read carries no chunk at all.
        expect('chunk' in result).toBe(false);
    });

    it('flags overrun at production capacity when the interval exceeds 524288 samples', () => {
        const capacity = 524288;
        const { control, ring } = makeRing(capacity);
        for (let sample = 0; sample < capacity + 128; sample++) {
            ring[sample % capacity] = sample;
        }
        publishCount(control, capacity + 128);

        const result = mod.acquireRingChunk(ring, control, 0);
        // The defect returned all 524416 "samples" modulo capacity — 524288 of
        // them duplicated newer PCM, with the first sample reading `capacity`.
        expect(result.status).toBe('overrun');
    });

    it('succeeds when the read starts exactly at the oldest surviving sample', () => {
        const { control, ring } = makeRing(4);
        ring[0] = 4;
        ring[1] = 5;
        ring[2] = 2;
        ring[3] = 3;
        publishCount(control, 6);

        // writeHead - capacity = 2: the oldest surviving sample. Exactly at the
        // boundary is NOT an overrun — the full surviving history is readable.
        const { chunk, nextReadHead } = expectOkRead(mod.acquireRingChunk(ring, control, 2));
        expect(nextReadHead).toBe(6);
        expect(chunkSamples(chunk)).toEqual([2, 3, 4, 5]);
    });

    it('preserves exact PCM at capacity minus one and across signed and unsigned count boundaries', () => {
        const { control, ring } = makeRing(8);
        const signedRead = 2_147_483_646;
        const signedSamples = [1, 2, 3, 4, 5, 6, 7];
        for (let index = 0; index < signedSamples.length; index++) {
            ring[(signedRead + index) % ring.length] = signedSamples[index]!;
        }
        publishCount(control, signedRead + signedSamples.length);
        const signed = expectOkRead(mod.acquireRingChunk(ring, control, signedRead));
        expect(chunkSamples(signed.chunk)).toEqual(signedSamples);

        const unsignedRead = 0x1_0000_0000 - 2;
        const unsignedSamples = [-1, -2, -3, -4];
        for (let index = 0; index < unsignedSamples.length; index++) {
            ring[(unsignedRead + index) % ring.length] = unsignedSamples[index]!;
        }
        publishCount(control, unsignedRead + unsignedSamples.length);
        const unsigned = expectOkRead(mod.acquireRingChunk(ring, control, unsignedRead));
        expect(unsigned.nextReadHead).toBe(0x1_0000_0000 + 2);
        expect(chunkSamples(unsigned.chunk)).toEqual(unsignedSamples);
    });

    it('keeps two real 128-frame producer blocks ordered across the unsigned counter rollover', async () => {
        const writeRingRelease = await loadActualProducer();
        const { control, ring } = makeRing(512);
        const firstHead = 0x1_0000_0000 - 128;
        const firstBlock = new Float32Array(128).map((_, index) => index + 0.25);
        const secondBlock = new Float32Array(128).map((_, index) => -index - 0.5);
        publishCount(control, firstHead);

        const afterFirst = writeRingRelease(ring, control, firstHead, firstBlock);
        const afterSecond = writeRingRelease(ring, control, afterFirst, secondBlock);

        const copied = expectOkRead(mod.acquireRingChunk(ring, control, firstHead));
        expect(copied.nextReadHead).toBe(afterSecond);
        expect(chunkSamples(copied.chunk)).toEqual([...firstBlock, ...secondBlock]);
    });

    it('reports overrun after one or more complete unsigned low-word turns', () => {
        const { control, ring } = makeRing(8);
        publishCount(control, 2 * 0x1_0000_0000 + 3);

        const result = mod.acquireRingChunk(ring, control, 3);

        expect(result).toEqual({ status: 'overrun', currentWrite: 2 * 0x1_0000_0000 + 3 });
    });

    it('returns retry while a producer is writing and rejects the completed overtake', () => {
        const { control, ring } = makeRing(8);
        for (let index = 0; index < ring.length; index++) {
            ring[index] = index;
        }
        publishCount(control, 8);
        let injected = false;
        const observedRing = new Proxy(ring, {
            get(target, property): unknown {
                const value = Reflect.get(target, property, target);
                if (!injected && typeof property === 'string' && /^\d+$/.test(property)) {
                    injected = true;
                    beginRecordingRingWrite(control);
                    for (let index = 0; index < 9; index++) {
                        ring[(8 + index) % ring.length] = 100 + index;
                    }
                }
                return value;
            },
        });

        const duringWrite = mod.acquireRingChunk(observedRing, control, 4);
        expect(duringWrite).toEqual({ status: 'retry' });
        expect('chunk' in duringWrite).toBe(false);

        storeRecordingSampleCount(control, 17);
        completeRecordingRingWrite(control);
        expect(mod.acquireRingChunk(ring, control, 4)).toEqual({ status: 'overrun', currentWrite: 17 });
    });

    it('compares the cumulative count when the stable sequence value is unchanged', () => {
        const { control, ring } = makeRing(8);
        for (let index = 0; index < ring.length; index++) {
            ring[index] = index;
        }
        publishCount(control, 8);
        let injected = false;
        const observedRing = new Proxy(ring, {
            get(target, property): unknown {
                const value = Reflect.get(target, property, target);
                if (!injected && typeof property === 'string' && /^\d+$/.test(property)) {
                    injected = true;
                    storeRecordingSampleCount(control, 9);
                }
                return value;
            },
        });

        expect(mod.acquireRingChunk(observedRing, control, 4)).toEqual({ status: 'retry' });
        expect(Atomics.load(control, RECORDING_RING_SEQUENCE_INDEX)).toBe(0);
    });

    it('rejects invalid reader and publication counts as protocol errors', () => {
        const { control, ring } = makeRing(8);
        Atomics.store(control, 2, 0x20_0000);

        expect(mod.acquireRingChunk(ring, control, 0)).toEqual({ status: 'protocol-error' });
        expect(mod.acquireRingChunk(ring, control, -1)).toEqual({ status: 'protocol-error' });
    });
});

describe('recordingWorker ring overrun drop policy', () => {
    beforeEach(async () => {
        await loadWorker();
    });

    /** Four-slot SAB lapped by the producer: writes 0..5, reader never drained. */
    function lappedRingSab(): SharedArrayBuffer {
        const { sab, control, ring } = makeRing(4);
        ring[0] = 4;
        ring[1] = 5;
        ring[2] = 2;
        ring[3] = 3;
        publishCount(control, 6);
        return sab;
    }

    it('abandons the take when a poll drain discovers the overrun', async () => {
        sendToWorker({ type: 'init', sab: lappedRingSab(), sampleRate: 48000 });
        await waitFor('ready');

        sendToWorker({ type: 'start' });
        const error = await waitFor('error');
        expect(String(error.message)).toMatch(/overrun/i);
        // The main thread terminates this worker on 'error', so the worker
        // cannot remove its own temp file — it must hand the name over for
        // main-thread removal.
        expect(error.tempFile).toMatch(/^rec-tmp-\d+\.pcm$/);

        // The corrupted interval is never written to the OPFS history and no
        // 'wav' is ever produced for the take.
        expect(messages.some((m) => m.type === 'wav')).toBe(false);
        expect(fakeDir.handle.store.bytes.length).toBeLessThanOrEqual(mod.WAV_HEADER_BYTES);
    });

    it('abandons the take when the final drain at stop discovers the overrun', async () => {
        sendToWorker({ type: 'init', sab: lappedRingSab(), sampleRate: 48000 });
        await waitFor('ready');

        sendToWorker({ type: 'stop', expectedFinalSampleCount: 6 });
        const error = await waitFor('error');
        expect(error.tempFile).toMatch(/^rec-tmp-\d+\.pcm$/);
        expect(messages.some((m) => m.type === 'wav')).toBe(false);
    });

    it('discards its OPFS temp file after delivering the wav on a normal stop', async () => {
        const { sab, control, ring } = makeRing(64);
        ring[0] = 1;
        ring[1] = 2;
        publishCount(control, 2);

        sendToWorker({ type: 'init', sab, sampleRate: 48000 });
        await waitFor('ready');
        sendToWorker({ type: 'start' });
        // Let one drain tick run, then stop.
        await new Promise((resolve) => setTimeout(resolve, 60));
        sendToWorker({ type: 'stop', expectedFinalSampleCount: 2 });
        await waitFor('wav');

        // The worker owns cleanup on the normal path: the temp entry is gone
        // once the take has been delivered.
        await new Promise((resolve) => setTimeout(resolve, 20));
        expect(fakeDir.removedEntries).toEqual([expect.stringMatching(/^rec-tmp-\d+\.pcm$/)]);
    });

    it('waits for a pending PCM write before one final drain and finalizes only once', async () => {
        const { sab, control, ring } = makeRing(64);
        ring[0] = 0.25;
        ring[1] = -0.5;
        publishCount(control, 2);
        let releasePcmWrite: (() => void) | undefined;
        let markPcmWriteStarted: (() => void) | undefined;
        const pcmWriteStarted = new Promise<void>((resolve) => {
            markPcmWriteStarted = resolve;
        });
        const pcmWriteGate = new Promise<void>((resolve) => {
            releasePcmWrite = resolve;
        });
        beforeWrite = (input) => {
            if (ArrayBuffer.isView(input) && input.byteLength === 8) {
                markPcmWriteStarted?.();
                return pcmWriteGate;
            }
            return Promise.resolve();
        };

        sendToWorker({ type: 'init', sab, sampleRate: 48000 });
        await waitFor('ready');
        sendToWorker({ type: 'start' });
        await pcmWriteStarted;

        beginRecordingRingWrite(control);
        ring[2] = 0.75;
        ring[3] = -1;
        storeRecordingSampleCount(control, 4);
        completeRecordingRingWrite(control);

        sendToWorker({ type: 'stop', expectedFinalSampleCount: 4 });
        sendToWorker({ type: 'stop', expectedFinalSampleCount: 4 });
        await Promise.resolve();
        expect(messages.some((message) => message.type === 'wav')).toBe(false);

        releasePcmWrite?.();
        const wav = await waitFor('wav');
        expect(messages.filter((message) => message.type === 'wav')).toHaveLength(1);
        const wavBuffer = wav.buffer as ArrayBuffer;
        expect(wavBuffer.byteLength).toBe(mod.WAV_HEADER_BYTES + 4 * Float32Array.BYTES_PER_ELEMENT);
        expect(new DataView(wavBuffer).getUint32(40, true)).toBe(4 * Float32Array.BYTES_PER_ELEMENT);
        const pcm = new Float32Array(wavBuffer, mod.WAV_HEADER_BYTES, 4);
        expect(Array.from(pcm)).toEqual([0.25, -0.5, 0.75, -1]);
    });

    it('retries an in-progress active publication on a later poll without admitting uncertain PCM', async () => {
        const { sab, control, ring } = makeRing(64);
        ring[0] = 0.25;
        ring[1] = -0.5;
        beginRecordingRingWrite(control);
        let firstHeaderWrite: (() => void) | undefined;
        const headerWriteStarted = new Promise<void>((resolve) => {
            firstHeaderWrite = resolve;
        });
        beforeWrite = (input) => {
            if (input instanceof ArrayBuffer && input.byteLength === mod.WAV_HEADER_BYTES) {
                firstHeaderWrite?.();
            }
            return Promise.resolve();
        };

        sendToWorker({ type: 'init', sab, sampleRate: 48000 });
        await waitFor('ready');
        sendToWorker({ type: 'start' });
        await headerWriteStarted;
        await Promise.resolve();

        storeRecordingSampleCount(control, 2);
        completeRecordingRingWrite(control);

        await new Promise((resolve) => setTimeout(resolve, 60));
        sendToWorker({ type: 'stop', expectedFinalSampleCount: 2 });
        const wav = await waitFor('wav');
        const pcm = new Float32Array(wav.buffer as ArrayBuffer, mod.WAV_HEADER_BYTES, 2);
        expect(Array.from(pcm)).toEqual([0.25, -0.5]);
    });

    it('abandons without WAV when the final stable drain does not match the stopped acknowledgment', async () => {
        const { sab, control, ring } = makeRing(64);
        ring[0] = 0.25;
        ring[1] = -0.5;
        publishCount(control, 2);

        sendToWorker({ type: 'init', sab, sampleRate: 48000 });
        await waitFor('ready');
        sendToWorker({ type: 'stop', expectedFinalSampleCount: 3 });

        const error = await waitFor('error');
        expect(String(error.message)).toMatch(/stopped at 3 published samples but drained 2/i);
        expect(error.tempFile).toMatch(/^rec-tmp-\d+\.pcm$/);
        expect(messages.some((message) => message.type === 'wav')).toBe(false);
    });
});

describe('recordingWorker WAV header does not clobber the first samples', () => {
    beforeEach(async () => {
        await loadWorker();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('reserves the header slot so PCM begins at byte 44 and survives the stop-time patch', async () => {
        const sampleRate = 48000;
        // 64 ring slots is plenty for the 20 samples we publish.
        const { sab, control, ring } = makeRing(64);

        // Distinct, easily-checked PCM so a clobber of the first 11 samples
        // (44 bytes / 4) is unmistakable. 20 samples > 11, per the task.
        const samples = Array.from({ length: 20 }, (_, i) => (i + 1) / 100);
        for (let i = 0; i < samples.length; i++) {
            ring[i] = samples[i]!;
        }
        publishCount(control, samples.length);

        sendToWorker({ type: 'init', sab, sampleRate });
        await waitFor('ready');

        sendToWorker({ type: 'start' });
        // Let one drain tick run, then stop.
        await new Promise((resolve) => setTimeout(resolve, 60));
        sendToWorker({ type: 'stop', expectedFinalSampleCount: samples.length });

        const wav = await waitFor('wav');
        const buffer = wav.buffer as ArrayBuffer;
        const bytes = new Uint8Array(buffer);

        // Header occupies the first 44 bytes.
        expect(bytes.length).toBe(mod.WAV_HEADER_BYTES + samples.length * 4);
        const headerView = new DataView(buffer, 0, mod.WAV_HEADER_BYTES);
        expect(headerView.getUint32(0, false)).toBe(0x52494646); // RIFF
        expect(headerView.getUint32(40, true)).toBe(samples.length * 4); // data size

        // PCM payload begins at byte 44 — the FIRST sample must be intact, not
        // overwritten by the header (this is the regression).
        const pcm = new Float32Array(buffer, mod.WAV_HEADER_BYTES, samples.length);
        for (let i = 0; i < samples.length; i++) {
            expect(pcm[i]).toBeCloseTo(samples[i]!, 5);
        }
        // Spell out the first-sample guarantee that the bug broke.
        expect(pcm[0]).toBeCloseTo(0.01, 5);
    });
});
