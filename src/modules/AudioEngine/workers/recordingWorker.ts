/// <reference lib="webworker" />
/**
 * Recording OPFS Worker — drains the SAB ring buffer to an OPFS temp file
 * during capture, then transfers the complete PCM Float32Array to the main
 * thread on stop.
 *
 * Keeping OPFS writes on this background thread means the main thread sees
 * zero memory growth and zero blocking during recording.
 *
 * Port protocol (self.onmessage):
 *   ← { type: 'init',  sab: SharedArrayBuffer, sampleRate: number }
 *   → { type: 'ready' }
 *   ← { type: 'start' }
 *   ← { type: 'stop'  }
 *   → { type: 'wav',   buffer: ArrayBuffer }                        (transferable)
 *   → { type: 'error', message: string }                            (on failure)
 */

const POLL_MS = 50; // drain interval — plenty of margin ahead of worklet writes

/** Canonical WAV/RIFF header size, in bytes. The PCM payload begins here so the
 *  header can be patched in place on stop without clobbering the first samples. */
export const WAV_HEADER_BYTES = 44;

/**
 * Build a 44-byte WAV/RIFF header for mono 32-bit IEEE-float PCM.
 *
 * Pure: takes the final sample count and sample rate, returns the header bytes.
 * Exported so the byte layout is verifiable independently of OPFS I/O.
 */
export function buildWavHeader(totalSamples: number, sampleRate: number): ArrayBuffer {
    const header = new ArrayBuffer(WAV_HEADER_BYTES);
    const view = new DataView(header);
    const dataBytes = totalSamples * 4;

    view.setUint32(0, 0x52494646, false); // "RIFF"
    view.setUint32(4, 36 + dataBytes, true);
    view.setUint32(8, 0x57415645, false); // "WAVE"
    view.setUint32(12, 0x666d7420, false); // "fmt "
    view.setUint32(16, 16, true);
    view.setUint16(20, 3, true); // IEEE float
    view.setUint16(22, 1, true); // Mono
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 4, true);
    view.setUint16(32, 4, true);
    view.setUint16(34, 32, true);
    view.setUint32(36, 0x64617461, false); // "data"
    view.setUint32(40, dataBytes, true);

    return header;
}

/**
 * Acquire-read of the SPSC ring's currently-published samples.
 *
 * `Atomics.load(writeHead, 0)` is the acquire fence: it pairs with the
 * producer's `Atomics.add`/`Atomics.store` release and guarantees every ring
 * write sequenced-before that publish is visible to the bare reads that follow.
 *
 * The drained samples are copied into a fresh, `ArrayBuffer`-backed `Uint8Array`
 * (not a view over the `SharedArrayBuffer` ring): `FileSystemWritableFileStream`
 * only accepts non-shared `BufferSource`, and decoupling from the ring lets the
 * producer keep writing while this chunk is in flight to OPFS. Returns the bytes
 * plus the advanced read head.
 *
 * Exported so the acquire ordering and wrap-around copy are testable without OPFS.
 */
export function acquireRingChunk(
    ring: Float32Array,
    writeHead: Int32Array,
    readFrom: number
): { chunk: Uint8Array<ArrayBuffer>; nextReadHead: number } {
    // Acquire fence — must precede the ring reads below.
    const currentWrite = Atomics.load(writeHead, 0);
    const available = currentWrite - readFrom;
    if (available <= 0) {
        return { chunk: new Uint8Array(0), nextReadHead: readFrom };
    }

    // Copy out of the ring into an owned, non-shared ArrayBuffer (handles
    // wrap-around). The backing buffer is allocated explicitly as `ArrayBuffer`
    // so its static type never widens to `ArrayBufferLike` — that lets the byte
    // view below satisfy `FileSystemWritableFileStream.write`'s non-shared
    // `BufferSource` requirement with no `as`-cast.
    const backing = new ArrayBuffer(available * Float32Array.BYTES_PER_ELEMENT);
    const samples = new Float32Array(backing);
    const ringSize = ring.length;
    for (let index = 0; index < available; index++) {
        samples[index] = ring[(readFrom + index) % ringSize] ?? 0;
    }
    return { chunk: new Uint8Array(backing), nextReadHead: readFrom + available };
}

let ring: Float32Array | null = null;
let writeHead: Int32Array | null = null;
let localReadHead = 0;
let workerSampleRate = 48000;
let headerReserved = false;

let opfsWritable: FileSystemWritableFileStream | null = null;
let opfsFileHandle: FileSystemFileHandle | null = null;

let pollTimer: ReturnType<typeof setTimeout> | null = null;
let active = false;

// Unique temp filename per recording session to avoid collisions.
let tmpName = '';

async function initWorker(sab: SharedArrayBuffer, sampleRate: number): Promise<void> {
    writeHead = new Int32Array(sab, 0, 1);
    ring = new Float32Array(sab, 4);
    localReadHead = 0;
    headerReserved = false;
    workerSampleRate = sampleRate;
    tmpName = `rec-tmp-${Date.now()}.pcm`;

    const root = await navigator.storage.getDirectory();
    opfsFileHandle = await root.getFileHandle(tmpName, { create: true });
    opfsWritable = await opfsFileHandle.createWritable();
}

async function drain(): Promise<void> {
    if (!ring || !writeHead || !opfsWritable) {
        return;
    }

    // Reserve the WAV header slot before the first PCM byte lands, so the PCM
    // payload starts at byte WAV_HEADER_BYTES. The header is patched in place on
    // stop; without this reservation it would overwrite the first ~11 samples.
    if (!headerReserved) {
        await opfsWritable.write(new ArrayBuffer(WAV_HEADER_BYTES));
        headerReserved = true;
    }

    // Acquire-read the published samples out of the ring (handles wrap-around).
    const { chunk, nextReadHead } = acquireRingChunk(ring, writeHead, localReadHead);
    if (chunk.length === 0) {
        return;
    }
    localReadHead = nextReadHead;

    await opfsWritable.write(chunk);
}

function startPolling(): void {
    active = true;
    const tick = async (): Promise<void> => {
        if (!active) {
            return;
        }
        await drain();
        pollTimer = setTimeout(() => {
            void tick();
        }, POLL_MS);
    };
    void tick();
}

async function stopWorker(): Promise<void> {
    active = false;
    if (pollTimer !== null) {
        clearTimeout(pollTimer);
        pollTimer = null;
    }

    // Final drain — pick up any samples written between the last poll and stop.
    await drain();

    await opfsWritable?.close();
    opfsWritable = null;

    if (!opfsFileHandle) {
        self.postMessage({ type: 'error', message: 'OPFS file handle missing on stop' });
        return;
    }

    // Re-open the stream to patch the WAV header at the beginning. The 44-byte
    // slot was reserved by the first drain (see `headerReserved`), so the PCM
    // payload begins at byte WAV_HEADER_BYTES — patching position 0 here leaves
    // every sample intact.
    const patchStream = await opfsFileHandle.createWritable({ keepExistingData: true });
    const totalSamples = localReadHead;
    const header = buildWavHeader(totalSamples, workerSampleRate);

    await patchStream.write({ type: 'write', position: 0, data: header });
    await patchStream.close();

    // Read back the full WAV file and transfer ownership to the main thread.
    const file = await opfsFileHandle.getFile();
    const arrayBuffer = await file.arrayBuffer();

    self.postMessage({ type: 'wav', buffer: arrayBuffer }, [arrayBuffer]);

    // Remove the temp file — non-fatal if it fails.
    try {
        const root = await navigator.storage.getDirectory();
        await root.removeEntry(tmpName);
    } catch {
        // ignore
    }
    opfsFileHandle = null;
}

type WorkerMessage =
    | { type: 'init'; sab: SharedArrayBuffer; sampleRate: number }
    | { type: 'start' }
    | { type: 'stop' };

self.onmessage = ({ data }: MessageEvent<WorkerMessage>): void => {
    switch (data.type) {
        case 'init':
            void initWorker(data.sab, data.sampleRate).then(() => {
                self.postMessage({ type: 'ready' });
                return null;
            });
            break;
        case 'start':
            startPolling();
            break;
        case 'stop':
            void stopWorker();
            break;
    }
};
