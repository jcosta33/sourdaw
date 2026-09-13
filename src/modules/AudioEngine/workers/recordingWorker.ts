/// <reference lib="webworker" />

import {
    isRecordingSampleCount,
    readRecordingPublication,
    RECORDING_RING_CONTROL_BYTES,
    RECORDING_RING_CONTROL_INTS,
} from '../models/RecordingRingProtocol';
import { MAX_MONO_FLOAT32_RIFF_SAMPLES } from '../models/RecordingWavLimits';
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
 *   → { type: 'wav',   buffer: ArrayBuffer,
 *       sampleZeroContextFrame: number | null, sampleRate: number } (transferable)
 *   → { type: 'error', message: string, tempFile?: string }         (on failure)
 *
 * Integrity policy: if the producer laps the drain reader (ring overrun), the
 * overwritten history cannot be recovered, so the take is abandoned — an
 * 'error' is posted, no 'wav' is ever sent, and the temp file's name rides the
 * error payload: the main thread removes it, because this worker is terminated
 * on 'error' and a terminated worker never resumes its in-flight removeEntry.
 */

const POLL_MS = 50; // drain interval — plenty of margin ahead of worklet writes

/** Canonical WAV/RIFF header size, in bytes. The PCM payload begins here so the
 *  header can be patched in place on stop without clobbering the first samples. */
export const WAV_HEADER_BYTES = 44;
export function canAppendWavSamples(currentSamples: number, appendedSamples: number): boolean {
    return (
        Number.isInteger(currentSamples) &&
        currentSamples >= 0 &&
        Number.isInteger(appendedSamples) &&
        appendedSamples >= 0 &&
        appendedSamples <= MAX_MONO_FLOAT32_RIFF_SAMPLES - currentSamples
    );
}

/**
 * Build a 44-byte WAV/RIFF header for mono 32-bit IEEE-float PCM.
 *
 * Pure: takes the final sample count and sample rate, returns the header bytes.
 * Exported so the byte layout is verifiable independently of OPFS I/O.
 */
export function buildWavHeader(totalSamples: number, sampleRate: number): ArrayBuffer {
    if (!Number.isInteger(totalSamples) || totalSamples < 0 || totalSamples > MAX_MONO_FLOAT32_RIFF_SAMPLES) {
        throw new RangeError(`WAV sample count ${String(totalSamples)} is outside the mono float32 RIFF range`);
    }
    if (!isCaptureSampleRate(sampleRate)) {
        throw new RangeError(`WAV sample rate ${String(sampleRate)} is invalid`);
    }
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
 * The result of an acquire-read of the recording ring.
 *
 * `overrun` means the producer lapped this reader before it drained: the
 * requested interval's start was overwritten, so no intact chunk exists.
 * `currentWrite` is the head observed under the acquire fence, for diagnostics.
 */
export type AcquiredRingChunk =
    | {
          status: 'ok';
          chunk: Uint8Array<ArrayBuffer>;
          nextReadHead: number;
          sampleZeroContextFrame: number | null;
      }
    | { status: 'overrun'; currentWrite: number }
    | { status: 'retry' }
    | { status: 'protocol-error' };

/**
 * Acquire-read of the SPSC ring's currently-published samples.
 *
 * A stable even publication sequence brackets the snapshot. The consumer reads
 * the full cumulative count before and after copying, accepting PCM only when
 * neither the sequence nor count changed. This prevents a producer from
 * overwriting part of an in-flight copy while preserving nonblocking polling.
 *
 * The drained samples are copied into a fresh, `ArrayBuffer`-backed `Uint8Array`
 * (not a view over the `SharedArrayBuffer` ring): `FileSystemWritableFileStream`
 * only accepts non-shared `BufferSource`, and decoupling from the ring lets the
 * producer keep writing while this chunk is in flight to OPFS.
 *
 * If the producer lapped the reader — `writeHead - readFrom` exceeds the ring
 * capacity, i.e. the requested start predates the oldest surviving sample — the
 * interval no longer exists in the ring. Reading it modulo capacity would
 * silently return newer samples in place of the lost history, so the read
 * fails with `overrun` instead of returning duplicated PCM. A read starting
 * exactly at `writeHead - capacity` (the oldest surviving sample) succeeds.
 *
 * Exported so the acquire ordering, wrap-around copy, and overrun detection are
 * testable without OPFS.
 */
export function acquireRingChunk(ring: Float32Array, control: Int32Array, readFrom: number): AcquiredRingChunk {
    if (!isRecordingSampleCount(readFrom) || ring.length === 0) {
        return { status: 'protocol-error' };
    }

    const before = readRecordingPublication(control);
    if (before.status !== 'stable') {
        return before;
    }
    const available = before.sampleCount - readFrom;
    if (available < 0) {
        return { status: 'protocol-error' };
    }
    if (available === 0) {
        return {
            status: 'ok',
            chunk: new Uint8Array(0),
            nextReadHead: readFrom,
            sampleZeroContextFrame: before.sampleZeroContextFrame,
        };
    }
    // Lapped reader: sample `readFrom` was overwritten before it could be
    // drained, so the requested interval is gone. Never read it modulo
    // capacity — that would present newer samples as the original take.
    if (available > ring.length) {
        return { status: 'overrun', currentWrite: before.sampleCount };
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

    const after = readRecordingPublication(control);
    if (after.status !== 'stable') {
        return after;
    }
    const afterAvailable = after.sampleCount - readFrom;
    if (afterAvailable < 0) {
        return { status: 'protocol-error' };
    }
    if (afterAvailable > ring.length) {
        return { status: 'overrun', currentWrite: after.sampleCount };
    }
    if (
        after.sequence !== before.sequence ||
        after.sampleCount !== before.sampleCount ||
        after.sampleZeroContextFrame !== before.sampleZeroContextFrame
    ) {
        return { status: 'retry' };
    }
    return {
        status: 'ok',
        chunk: new Uint8Array(backing),
        nextReadHead: before.sampleCount,
        sampleZeroContextFrame: before.sampleZeroContextFrame,
    };
}

let ring: Float32Array | null = null;
let control: Int32Array | null = null;
let localReadHead = 0;
let totalSamplesWritten = 0;
let workerSampleRate = 48000;
let sampleZeroContextFrame: number | null = null;
let headerReserved = false;
// Set when a ring overrun abandons the take: no further drains run and no
// 'wav' is ever produced for the recording.
let takeAbandoned = false;

let opfsWritable: FileSystemWritableFileStream | null = null;
let opfsFileHandle: FileSystemFileHandle | null = null;

let pollTimer: ReturnType<typeof setTimeout> | null = null;
let active = false;
let stopRequested = false;
let initializationPromise: Promise<void> | null = null;
let drainInFlight: Promise<DrainResult> | null = null;

// Unique temp filename per recording session to avoid collisions.
let tmpName = '';

async function initWorker(sab: SharedArrayBuffer, sampleRate: number): Promise<void> {
    if (!isCaptureSampleRate(sampleRate)) {
        throw new RangeError(`Recording sample rate ${String(sampleRate)} is invalid`);
    }
    control = new Int32Array(sab, 0, RECORDING_RING_CONTROL_INTS);
    ring = new Float32Array(sab, RECORDING_RING_CONTROL_BYTES);
    localReadHead = 0;
    totalSamplesWritten = 0;
    headerReserved = false;
    takeAbandoned = false;
    stopRequested = false;
    workerSampleRate = sampleRate;
    sampleZeroContextFrame = null;
    tmpName = `rec-tmp-${crypto.randomUUID()}.pcm`;

    const root = await navigator.storage.getDirectory();
    opfsFileHandle = await root.getFileHandle(tmpName, { create: true });
    opfsWritable = await opfsFileHandle.createWritable();
}

type DrainResult = 'drained' | 'empty' | 'retry' | 'failed';

async function drain(): Promise<DrainResult> {
    if (!ring || !control || !opfsWritable || takeAbandoned) {
        return 'failed';
    }

    // Reserve the WAV header slot before the first PCM byte lands, so the PCM
    // payload starts at byte WAV_HEADER_BYTES. The header is patched in place on
    // stop; without this reservation it would overwrite the first ~11 samples.
    if (!headerReserved) {
        await opfsWritable.write(new ArrayBuffer(WAV_HEADER_BYTES));
        headerReserved = true;
    }

    // Acquire-read the published samples out of the ring (handles wrap-around).
    const acquired = acquireRingChunk(ring, control, localReadHead);
    if (acquired.status === 'retry') {
        return 'retry';
    }
    if (acquired.status === 'overrun') {
        abandonTake(
            `Recording ring overrun: ${String(acquired.currentWrite - localReadHead)} samples from ${String(localReadHead)} were overwritten before they could be drained; take abandoned`
        );
        return 'failed';
    }
    if (acquired.status === 'protocol-error') {
        abandonTake('Recording ring protocol became invalid; take abandoned');
        return 'failed';
    }
    const { chunk, nextReadHead, sampleZeroContextFrame: acquiredSampleZeroContextFrame } = acquired;
    if (acquiredSampleZeroContextFrame === null) {
        if (chunk.length > 0 || totalSamplesWritten > 0) {
            abandonTake('Recording sample-zero frame receipt was missing from a nonempty take; take abandoned');
            return 'failed';
        }
    } else if (sampleZeroContextFrame === null) {
        sampleZeroContextFrame = acquiredSampleZeroContextFrame;
    } else if (sampleZeroContextFrame !== acquiredSampleZeroContextFrame) {
        abandonTake('Recording sample-zero frame receipt changed during capture; take abandoned');
        return 'failed';
    }
    if (chunk.length === 0) {
        return 'empty';
    }

    const chunkSamples = chunk.byteLength / Float32Array.BYTES_PER_ELEMENT;
    if (!canAppendWavSamples(totalSamplesWritten, chunkSamples)) {
        abandonTake(
            `Recording exceeds the mono float32 RIFF limit of ${String(MAX_MONO_FLOAT32_RIFF_SAMPLES)} samples; take abandoned`
        );
        return 'failed';
    }
    const nextTotalSamples = totalSamplesWritten + chunkSamples;
    await opfsWritable.write(chunk);
    localReadHead = nextReadHead;
    totalSamplesWritten = nextTotalSamples;
    return 'drained';
}

async function runDrain(): Promise<DrainResult> {
    if (drainInFlight) {
        return drainInFlight;
    }
    const running = drain().catch((error: unknown) => {
        abandonTake(`Recording storage write failed: ${error instanceof Error ? error.message : String(error)}`);
        return 'failed' as const;
    });
    drainInFlight = running;
    const result = await running;
    if (drainInFlight === running) {
        drainInFlight = null;
    }
    return result;
}

/**
 * Defined drop policy for a lapped reader: the overwritten interval can never
 * be recovered, so the take is abandoned. Stop draining and notify the main
 * thread on the established error channel — it tears the session down on
 * 'error'. The temp file's name rides the payload: this worker is terminated
 * on 'error', and a terminated worker never resumes an in-flight
 * `removeEntry`, so the main thread — which outlives it — owns the removal.
 * No 'wav' is ever produced, so overwritten history is never presented as a
 * recording.
 */
function abandonTake(message: string): void {
    if (takeAbandoned) {
        return;
    }
    takeAbandoned = true;
    active = false;
    if (pollTimer !== null) {
        clearTimeout(pollTimer);
        pollTimer = null;
    }
    self.postMessage({
        type: 'error',
        message,
        tempFile: tmpName,
    });
}

function startPolling(): void {
    if (stopRequested || active) {
        return;
    }
    active = true;
    const tick = async (): Promise<void> => {
        if (!active) {
            return;
        }
        await runDrain();
        // A drain can abandon the take (ring overrun); stop the poll loop then.
        if (!active) {
            return;
        }
        pollTimer = setTimeout(() => {
            void tick();
        }, POLL_MS);
    };
    void tick();
}

async function stopWorker(expectedFinalSampleCount: number): Promise<void> {
    if (stopRequested) {
        return;
    }
    stopRequested = true;
    active = false;
    if (pollTimer !== null) {
        clearTimeout(pollTimer);
        pollTimer = null;
    }

    await initializationPromise;
    const pendingDrain = drainInFlight;
    if (pendingDrain) {
        await pendingDrain;
    }
    const finalDrain = await runDrain();
    if (finalDrain === 'retry') {
        abandonTake('Recording ring publication was unstable after the producer stopped; take abandoned');
    }
    if (!isRecordingSampleCount(expectedFinalSampleCount) || localReadHead !== expectedFinalSampleCount) {
        abandonTake(
            `Recording stopped at ${String(expectedFinalSampleCount)} published samples but drained ${String(localReadHead)}; take abandoned`
        );
    }

    await opfsWritable?.close();
    opfsWritable = null;

    if (takeAbandoned) {
        // The error — carrying the temp file name for main-thread removal —
        // was posted when the take was abandoned; never send a 'wav' for it.
        return;
    }

    if (!opfsFileHandle) {
        self.postMessage({ type: 'error', message: 'OPFS file handle missing on stop' });
        return;
    }

    // Re-open the stream to patch the WAV header at the beginning. The 44-byte
    // slot was reserved by the first drain (see `headerReserved`), so the PCM
    // payload begins at byte WAV_HEADER_BYTES — patching position 0 here leaves
    // every sample intact.
    const patchStream = await opfsFileHandle.createWritable({ keepExistingData: true });
    const header = buildWavHeader(totalSamplesWritten, workerSampleRate);

    await patchStream.write({ type: 'write', position: 0, data: header });
    await patchStream.close();

    // Read back the full WAV file and transfer ownership to the main thread.
    const file = await opfsFileHandle.getFile();
    const arrayBuffer = await file.arrayBuffer();

    if (totalSamplesWritten > 0 && sampleZeroContextFrame === null) {
        abandonTake('Recording sample-zero frame receipt was missing from a nonempty take; take abandoned');
        return;
    }

    self.postMessage(
        {
            type: 'wav',
            buffer: arrayBuffer,
            sampleZeroContextFrame,
            sampleRate: workerSampleRate,
        },
        [arrayBuffer]
    );

    await discardTempFile();
}

/** Best-effort removal of this session's OPFS temp file. Non-fatal on failure. */
async function discardTempFile(): Promise<void> {
    if (!opfsFileHandle) {
        return;
    }
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
    | { type: 'stop'; expectedFinalSampleCount: number };

function isCaptureSampleRate(value: number): boolean {
    return Number.isInteger(value) && value > 0 && value <= 0x3fff_ffff;
}

self.onmessage = ({ data }: MessageEvent<WorkerMessage>): void => {
    switch (data.type) {
        case 'init':
            initializationPromise = initWorker(data.sab, data.sampleRate);
            void initializationPromise
                .then(() => {
                    if (!stopRequested) {
                        self.postMessage({ type: 'ready' });
                    }
                    return null;
                })
                .catch((error: unknown) => {
                    abandonTake(
                        `Recording storage initialization failed: ${error instanceof Error ? error.message : String(error)}`
                    );
                });
            break;
        case 'start':
            startPolling();
            break;
        case 'stop':
            void stopWorker(data.expectedFinalSampleCount);
            break;
    }
};
