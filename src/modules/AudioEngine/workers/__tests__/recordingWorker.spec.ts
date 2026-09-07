import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

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

    write(
        input: ArrayBuffer | ArrayBufferView | { type: 'write'; position: number; data: ArrayBuffer }
    ): Promise<void> {
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
        return Promise.resolve();
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
    getFileHandle(): Promise<FakeFileHandle> {
        return Promise.resolve(this.handle);
    }
    removeEntry(): Promise<void> {
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
});

describe('acquireRingChunk', () => {
    beforeEach(async () => {
        await loadWorker();
    });

    it('reads published samples after an acquire load of the head, handling wrap-around', () => {
        const sab = new SharedArrayBuffer(4 + 4 * 4);
        const writeHead = new Int32Array(sab, 0, 1);
        const ring = new Float32Array(sab, 4);
        // Producer published 6 samples into a 4-slot ring: samples 4 and 5
        // wrapped into slots 0 and 1.
        ring[0] = 4;
        ring[1] = 5;
        ring[2] = 2;
        ring[3] = 3;
        Atomics.store(writeHead, 0, 6);

        // The reader already drained 0–3; the remaining interval 4–5 starts
        // inside surviving history and reads the wrapped slots 0–1.
        const { chunk, nextReadHead } = expectOkRead(mod.acquireRingChunk(ring, writeHead, 4));
        expect(nextReadHead).toBe(6);
        // The chunk is a byte view over a fresh ArrayBuffer; reinterpret as floats.
        expect(chunkSamples(chunk)).toEqual([4, 5]);
    });

    it('returns the drained bytes over a non-shared ArrayBuffer, decoupled from the ring SAB', () => {
        const sab = new SharedArrayBuffer(4 + 4 * 4);
        const writeHead = new Int32Array(sab, 0, 1);
        const ring = new Float32Array(sab, 4);
        ring[0] = 1;
        ring[1] = 2;
        Atomics.store(writeHead, 0, 2);

        const { chunk } = expectOkRead(mod.acquireRingChunk(ring, writeHead, 0));
        // FileSystemWritableFileStream rejects SharedArrayBuffer-backed views; the
        // chunk's backing buffer must be a plain, owned ArrayBuffer.
        expect(chunk.buffer).toBeInstanceOf(ArrayBuffer);
        expect(chunk.buffer).not.toBe(sab);
    });

    it('returns an empty chunk when nothing new is published', () => {
        const sab = new SharedArrayBuffer(4 + 4 * 4);
        const writeHead = new Int32Array(sab, 0, 1);
        const ring = new Float32Array(sab, 4);
        Atomics.store(writeHead, 0, 3);
        const { chunk, nextReadHead } = expectOkRead(mod.acquireRingChunk(ring, writeHead, 3));
        expect(chunk.length).toBe(0);
        expect(nextReadHead).toBe(3);
    });

    it('reports overrun instead of duplicated samples when the producer lapped the reader', () => {
        const sab = new SharedArrayBuffer(4 + 4 * 4);
        const writeHead = new Int32Array(sab, 0, 1);
        const ring = new Float32Array(sab, 4);
        // Writes 0..5 into a 4-slot ring: sample 0 was overwritten by 4 and
        // sample 1 by 5. A reader still at 0 asks for six samples out of four
        // slots — the requested interval no longer exists in the ring.
        ring[0] = 4;
        ring[1] = 5;
        ring[2] = 2;
        ring[3] = 3;
        Atomics.store(writeHead, 0, 6);

        const result = mod.acquireRingChunk(ring, writeHead, 0);
        expect(result.status).toBe('overrun');
        if (result.status !== 'overrun') {
            throw new Error('expected the overrun variant');
        }
        expect(result.currentWrite).toBe(6);
        // The defect returned [4,5,2,3,4,5] — newer samples presented as the
        // original interval. A failed read carries no chunk at all.
        expect('chunk' in result).toBe(false);
    });

    it('flags overrun at production capacity when the interval exceeds 524288 samples', () => {
        const capacity = 524288;
        const sab = new SharedArrayBuffer(4 + capacity * 4);
        const writeHead = new Int32Array(sab, 0, 1);
        const ring = new Float32Array(sab, 4);
        for (let sample = 0; sample < capacity + 128; sample++) {
            ring[sample % capacity] = sample;
        }
        Atomics.store(writeHead, 0, capacity + 128);

        const result = mod.acquireRingChunk(ring, writeHead, 0);
        // The defect returned all 524416 "samples" modulo capacity — 524288 of
        // them duplicated newer PCM, with the first sample reading `capacity`.
        expect(result.status).toBe('overrun');
    });

    it('succeeds when the read starts exactly at the oldest surviving sample', () => {
        const sab = new SharedArrayBuffer(4 + 4 * 4);
        const writeHead = new Int32Array(sab, 0, 1);
        const ring = new Float32Array(sab, 4);
        ring[0] = 4;
        ring[1] = 5;
        ring[2] = 2;
        ring[3] = 3;
        Atomics.store(writeHead, 0, 6);

        // writeHead - capacity = 2: the oldest surviving sample. Exactly at the
        // boundary is NOT an overrun — the full surviving history is readable.
        const { chunk, nextReadHead } = expectOkRead(mod.acquireRingChunk(ring, writeHead, 2));
        expect(nextReadHead).toBe(6);
        expect(chunkSamples(chunk)).toEqual([2, 3, 4, 5]);
    });
});

describe('recordingWorker ring overrun drop policy', () => {
    beforeEach(async () => {
        await loadWorker();
    });

    /** Four-slot SAB lapped by the producer: writes 0..5, reader never drained. */
    function lappedRingSab(): SharedArrayBuffer {
        const sab = new SharedArrayBuffer(4 + 4 * 4);
        const writeHead = new Int32Array(sab, 0, 1);
        const ring = new Float32Array(sab, 4);
        ring[0] = 4;
        ring[1] = 5;
        ring[2] = 2;
        ring[3] = 3;
        Atomics.store(writeHead, 0, 6);
        return sab;
    }

    it('abandons the take when a poll drain discovers the overrun', async () => {
        sendToWorker({ type: 'init', sab: lappedRingSab(), sampleRate: 48000 });
        await waitFor('ready');

        sendToWorker({ type: 'start' });
        const error = await waitFor('error');
        expect(String(error.message)).toMatch(/overrun/i);

        sendToWorker({ type: 'stop' });
        await new Promise((resolve) => setTimeout(resolve, 80));
        // The defined drop policy: the corrupted interval is never written to
        // the OPFS history and no 'wav' is ever produced for the take.
        expect(messages.some((m) => m.type === 'wav')).toBe(false);
        expect(fakeDir.handle.store.bytes.length).toBeLessThanOrEqual(mod.WAV_HEADER_BYTES);
    });

    it('abandons the take when the final drain at stop discovers the overrun', async () => {
        sendToWorker({ type: 'init', sab: lappedRingSab(), sampleRate: 48000 });
        await waitFor('ready');

        sendToWorker({ type: 'stop' });
        await waitFor('error');
        expect(messages.some((m) => m.type === 'wav')).toBe(false);
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
        const sab = new SharedArrayBuffer(4 + 64 * 4);
        const writeHead = new Int32Array(sab, 0, 1);
        const ring = new Float32Array(sab, 4);

        // Distinct, easily-checked PCM so a clobber of the first 11 samples
        // (44 bytes / 4) is unmistakable. 20 samples > 11, per the task.
        const samples = Array.from({ length: 20 }, (_, i) => (i + 1) / 100);
        for (let i = 0; i < samples.length; i++) {
            ring[i] = samples[i]!;
        }
        Atomics.store(writeHead, 0, samples.length);

        sendToWorker({ type: 'init', sab, sampleRate });
        await waitFor('ready');

        sendToWorker({ type: 'start' });
        // Let one drain tick run, then stop.
        await new Promise((resolve) => setTimeout(resolve, 60));
        sendToWorker({ type: 'stop' });

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
