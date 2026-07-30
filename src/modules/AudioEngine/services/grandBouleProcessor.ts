/**
 * AudioWorkletProcessor for the Grand Boule physical-modeling piano.
 *
 * This processor is a lightweight consumer — the heavy WASM DSP runs on a
 * dedicated Web Worker that renders ahead into a SharedArrayBuffer ring
 * buffer. This processor just copies from the ring to the WebAudio output,
 * which takes microseconds and never risks buffer underruns from DSP load.
 *
 * Messages from main thread:
 *   { type: 'init', sab: SharedArrayBuffer }
 *
 * SAB layout:
 *   [0] writeHead, [1] readHead, [2] render request generation,
 *   [3] sleep-after head, [4] DSP lifecycle, [5] hard-flush generation,
 *   [6] hard-flush write boundary,
 *   followed by the left and right Float32 rings.
 */

const WRITE_HEAD_IDX = 0;
const READ_HEAD_IDX = 1;
const RENDER_REQUEST_IDX = 2;
const SLEEP_HEAD_IDX = 3;
const LIFECYCLE_IDX = 4;
const FLUSH_GENERATION_IDX = 5;
const FLUSH_HEAD_IDX = 6;
const LIFECYCLE_SLEEP = 3;

/**
 * Int32 slot indices of the shared dropout SAB (audit RT-10) — mirrored by
 * literal from `engine/dropoutCounter.ts`, since worklet code stays isolated
 * from app modules.
 */
const DROPOUT_BLOCKS_IDX = 0;
const DROPOUT_SILENT_FRAMES_IDX = 1;
const DROPOUT_LAST_FRAME_IDX = 2;

type GrandBouleMsg = { type: 'init'; sab: SharedArrayBuffer; dropoutSab?: SharedArrayBuffer };

/**
 * Acquire-read one block of stereo frames from the SPSC ring into `out0`/`out1`.
 *
 * `Atomics.load(controlInts, WRITE_HEAD_IDX)` is the acquire fence: it pairs
 * with the engine worker's `Atomics.store(WRITE_HEAD_IDX, ...)` release, so any
 * ring frame the published write head accounts for is visible to the bare
 * `subarray` reads below. When fewer than `frames` are published the ring is
 * left untouched (underrun) and `consumed` is 0 — no stale frames are copied.
 *
 * Returns whether a complete block was consumed. Hot-path safe: no allocation,
 * no blocking.
 */
export function readBlockAcquire(
    controlInts: Int32Array,
    leftRing: Float32Array,
    rightRing: Float32Array,
    ringFrames: number,
    out0: Float32Array,
    out1: Float32Array | undefined,
    frames: number
): boolean {
    // Acquire fence — must precede the ring reads below.
    const writeHead = Atomics.load(controlInts, WRITE_HEAD_IDX);
    const readHead = Atomics.load(controlInts, READ_HEAD_IDX);
    const available = (writeHead - readHead) | 0;

    if (available < frames) {
        return false;
    }

    const offset = (readHead >>> 0) % ringFrames;
    const firstChunk = Math.min(frames, ringFrames - offset);
    const secondChunk = frames - firstChunk;

    for (let index = 0; index < firstChunk; index++) {
        out0[index] = leftRing[offset + index] ?? 0;
    }
    for (let index = 0; index < secondChunk; index++) {
        out0[firstChunk + index] = leftRing[index] ?? 0;
    }
    if (out1 !== undefined) {
        for (let index = 0; index < firstChunk; index++) {
            out1[index] = rightRing[offset + index] ?? 0;
        }
        for (let index = 0; index < secondChunk; index++) {
            out1[firstChunk + index] = rightRing[index] ?? 0;
        }
    }

    Atomics.store(controlInts, READ_HEAD_IDX, (readHead + frames) | 0);
    return true;
}

class GrandBouleProcessor extends AudioWorkletProcessor {
    _controlInts: Int32Array | null = null;
    _leftRing: Float32Array | null = null;
    _rightRing: Float32Array | null = null;
    _ringFrames = 0;
    _ready = false;
    /** Shared dropout counters (audit RT-10); null when the host supplied none. */
    _dropoutInts: Int32Array | null = null;
    /**
     * True once the ring has delivered at least one full block. Starvation
     * before that is the startup pre-roll, not a dropout, and is not counted.
     */
    _hasDelivered = false;
    _flushGeneration = 0;

    constructor() {
        super();
        this.port.onmessage = (event: MessageEvent<GrandBouleMsg>) => {
            const msg = event.data;
            if (msg.type === 'init' && !this._ready) {
                if (msg.dropoutSab) {
                    this._dropoutInts = new Int32Array(msg.dropoutSab);
                }
                this._initSab(msg.sab);
            }
        };
    }

    /**
     * Record one detected underrun. RT-safe: three `Atomics` ops on an
     * already-mapped view — no allocation, no lock, no port send.
     */
    _recordUnderrun(frames: number): void {
        const counters = this._dropoutInts;
        if (!counters) {
            return;
        }
        Atomics.add(counters, DROPOUT_BLOCKS_IDX, 1);
        Atomics.add(counters, DROPOUT_SILENT_FRAMES_IDX, frames);
        Atomics.store(counters, DROPOUT_LAST_FRAME_IDX, currentFrame | 0);
    }

    _initSab(sab: SharedArrayBuffer): void {
        this._controlInts = new Int32Array(sab, 0, 7);
        const headerBytes = 7 * Int32Array.BYTES_PER_ELEMENT;
        const floatBytes = sab.byteLength - headerBytes;
        this._ringFrames = floatBytes / (2 * Float32Array.BYTES_PER_ELEMENT);
        this._leftRing = new Float32Array(sab, headerBytes, this._ringFrames);
        this._rightRing = new Float32Array(
            sab,
            headerBytes + this._ringFrames * Float32Array.BYTES_PER_ELEMENT,
            this._ringFrames
        );
        this._flushGeneration = Atomics.load(this._controlInts, FLUSH_GENERATION_IDX);
        this._ready = true;
        this.port.postMessage({ type: 'ready' });
    }

    _requestRender(): void {
        const controls = this._controlInts;
        if (!controls) {
            return;
        }
        Atomics.add(controls, RENDER_REQUEST_IDX, 1);
        Atomics.notify(controls, RENDER_REQUEST_IDX);
    }

    process(_inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
        if (!this._ready || !this._controlInts || !this._leftRing || !this._rightRing) {
            return true;
        }

        const output = outputs[0];
        if (!output || output.length === 0) {
            return true;
        }

        const out0 = output[0];
        if (!out0) {
            return true;
        }
        const frames = out0.length;
        const out1 = output[1];

        const flushGeneration = Atomics.load(this._controlInts, FLUSH_GENERATION_IDX);
        if (flushGeneration !== this._flushGeneration) {
            this._flushGeneration = flushGeneration;
            const flushHead = Atomics.load(this._controlInts, FLUSH_HEAD_IDX);
            Atomics.store(this._controlInts, READ_HEAD_IDX, flushHead);
            out0.fill(0);
            out1?.fill(0);
            this._hasDelivered = false;
            if (Atomics.load(this._controlInts, LIFECYCLE_IDX) !== LIFECYCLE_SLEEP) {
                this._requestRender();
            }
            return true;
        }

        const consumed = readBlockAcquire(
            this._controlInts,
            this._leftRing,
            this._rightRing,
            this._ringFrames,
            out0,
            out1,
            frames
        );

        if (!consumed) {
            out0.fill(0);
            out1?.fill(0);
            const readHead = Atomics.load(this._controlInts, READ_HEAD_IDX);
            const sleepHead = Atomics.load(this._controlInts, SLEEP_HEAD_IDX);
            const lifecycleState = Atomics.load(this._controlInts, LIFECYCLE_IDX);
            const expectedSilence = lifecycleState === LIFECYCLE_SLEEP || sleepHead === readHead;
            if (!expectedSilence && this._hasDelivered) {
                this._recordUnderrun(frames);
            }
            if (lifecycleState !== LIFECYCLE_SLEEP) {
                this._requestRender();
            }
            return true;
        }
        this._hasDelivered = true;

        const readHead = Atomics.load(this._controlInts, READ_HEAD_IDX);
        const sleepHead = Atomics.load(this._controlInts, SLEEP_HEAD_IDX);
        if (readHead !== sleepHead) {
            this._requestRender();
        }

        return true;
    }
}

registerProcessor('grand-boule-processor', GrandBouleProcessor);
