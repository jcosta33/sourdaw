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
        // Producer published 5 samples into a 4-slot ring (slot 0 wrapped).
        ring[0] = 5;
        ring[1] = 2;
        ring[2] = 3;
        ring[3] = 4;
        Atomics.store(writeHead, 0, 5);

        const { chunk, nextReadHead } = mod.acquireRingChunk(ring, writeHead, 0);
        expect(nextReadHead).toBe(5);
        // The chunk is a byte view over a fresh ArrayBuffer; reinterpret as floats.
        const floats = new Float32Array(chunk.buffer, chunk.byteOffset, chunk.byteLength / 4);
        expect(Array.from(floats)).toEqual([5, 2, 3, 4, 5]);
    });

    it('returns the drained bytes over a non-shared ArrayBuffer, decoupled from the ring SAB', () => {
        const sab = new SharedArrayBuffer(4 + 4 * 4);
        const writeHead = new Int32Array(sab, 0, 1);
        const ring = new Float32Array(sab, 4);
        ring[0] = 1;
        ring[1] = 2;
        Atomics.store(writeHead, 0, 2);

        const { chunk } = mod.acquireRingChunk(ring, writeHead, 0);
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
        const { chunk, nextReadHead } = mod.acquireRingChunk(ring, writeHead, 3);
        expect(chunk.length).toBe(0);
        expect(nextReadHead).toBe(3);
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
