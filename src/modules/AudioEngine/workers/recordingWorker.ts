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
 *   → { type: 'pcm',   samples: Float32Array, sampleRate: number }  (transferable)
 *   → { type: 'error', message: string }                            (on failure)
 */

const POLL_MS = 50; // drain interval — plenty of margin ahead of worklet writes

let ring: Float32Array | null = null;
let writeHead: Int32Array | null = null;
let localReadHead = 0;
let workerSampleRate = 48000;

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
    workerSampleRate = sampleRate;
    tmpName = `rec-tmp-${Date.now()}.pcm`;

    const root = await navigator.storage.getDirectory();
    opfsFileHandle = await root.getFileHandle(tmpName, { create: true });
    opfsWritable = await opfsFileHandle.createWritable();
}

async function drain(): Promise<void> {
    if (!ring || !writeHead || !opfsWritable) return;

    const currentWrite = Atomics.load(writeHead, 0);
    const available = currentWrite - localReadHead;
    if (available <= 0) return;

    // Copy the available samples out of the ring (handles wrap-around).
    const chunk = new Float32Array(available);
    const ringSize = ring.length;
    for (let i = 0; i < available; i++) {
        chunk[i] = ring[(localReadHead + i) % ringSize] ?? 0;
    }
    localReadHead += available;

    await opfsWritable.write(chunk.buffer);
}

function startPolling(): void {
    active = true;
    const tick = async (): Promise<void> => {
        if (!active) return;
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

    // Read back the full PCM file and transfer ownership to the main thread.
    const file = await opfsFileHandle.getFile();
    const arrayBuffer = await file.arrayBuffer();
    const samples = new Float32Array(arrayBuffer);

    self.postMessage({ type: 'pcm', samples, sampleRate: workerSampleRate }, [samples.buffer]);

    // Remove the temp file — non-fatal if it fails.
    try {
        const root = await navigator.storage.getDirectory();
        await root.removeEntry(tmpName);
    } catch {
        // ignore
    }
    opfsFileHandle = null;
}

self.onmessage = ({ data }: MessageEvent): void => {
    switch ((data as { type: string }).type) {
        case 'init':
            void initWorker(data.sab as SharedArrayBuffer, data.sampleRate as number).then(() => {
                self.postMessage({ type: 'ready' });
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
