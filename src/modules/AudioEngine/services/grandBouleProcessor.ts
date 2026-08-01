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
 *   [0..3]  writeHead (Int32, atomic) — total frames written by engine worker
 *   [4..7]  readHead  (Int32, atomic) — total frames read by this processor
 *   [8..]   left ring  (Float32, ringFrames entries)
 *   [8 + ringFrames*4..] right ring (Float32, ringFrames entries)
 */

const WRITE_HEAD_IDX = 0;
const READ_HEAD_IDX = 1;

/**
 * Slot in the one-Int32 sync SAB carrying `currentFrame - readHead` — how far
 * the context clock is ahead of the engine's own frame count.
 *
 * The engine worker schedules notes against the frames it produces, but every
 * `sampleFrame` in the app is a context frame; this is the only thing that
 * relates the two, and only this side can measure it. It is not a constant: a
 * ring underrun advances `currentFrame` while `readHead` stands still, so the
 * two clocks separate permanently at every dropout.
 */
const CONSUMER_OFFSET_IDX = 0;

/**
 * Int32 slot indices of the shared dropout SAB (audit RT-10) — mirrored by
 * literal from `engine/dropoutCounter.ts`, since worklet code stays isolated
 * from app modules.
 */
const DROPOUT_BLOCKS_IDX = 0;
const DROPOUT_SILENT_FRAMES_IDX = 1;
const DROPOUT_LAST_FRAME_IDX = 2;

type GrandBouleMsg = {
    type: 'init';
    sab: SharedArrayBuffer;
    dropoutSab?: SharedArrayBuffer;
    syncSab?: SharedArrayBuffer;
    countPreRollStarvation?: boolean;
};

/**
 * Acquire-read one block of stereo frames from the SPSC ring into `out0`/`out1`.
 *
 * `Atomics.load(controlInts, WRITE_HEAD_IDX)` is the acquire fence: it pairs
 * with the engine worker's `Atomics.store(WRITE_HEAD_IDX, ...)` release, so any
 * ring frame the published write head accounts for is visible to the bare
 * `subarray` reads below. When fewer than `frames` are published the ring is
 * left untouched (underrun) and `consumed` is 0 — no stale frames are copied.
 *
 * Returns the number of frames consumed and the advanced read head, so the
 * caller publishes the read head with a release store. Hot-path safe: no
 * allocation, no blocking.
 */
export function readBlockAcquire(
    controlInts: Int32Array,
    leftRing: Float32Array,
    rightRing: Float32Array,
    ringFrames: number,
    out0: Float32Array,
    out1: Float32Array | undefined,
    frames: number
): { consumed: number; nextReadHead: number } {
    // Acquire fence — must precede the ring reads below.
    const writeHead = Atomics.load(controlInts, WRITE_HEAD_IDX);
    const readHead = Atomics.load(controlInts, READ_HEAD_IDX);
    const available = (writeHead - readHead) | 0;

    if (available < frames) {
        // Underrun — caller outputs silence. The engine worker will catch up.
        return { consumed: 0, nextReadHead: readHead };
    }

    const offset = (readHead >>> 0) % ringFrames;
    const firstChunk = Math.min(frames, ringFrames - offset);
    const secondChunk = frames - firstChunk;

    out0.set(leftRing.subarray(offset, offset + firstChunk));
    if (secondChunk > 0) {
        out0.set(leftRing.subarray(0, secondChunk), firstChunk);
    }

    if (out1) {
        out1.set(rightRing.subarray(offset, offset + firstChunk));
        if (secondChunk > 0) {
            out1.set(rightRing.subarray(0, secondChunk), firstChunk);
        }
    }

    return { consumed: frames, nextReadHead: (readHead + frames) | 0 };
}

class GrandBouleProcessor extends AudioWorkletProcessor {
    _controlInts: Int32Array | null = null;
    _leftRing: Float32Array | null = null;
    _rightRing: Float32Array | null = null;
    _ringFrames = 0;
    _ready = false;
    /** Shared dropout counters (audit RT-10); null when the host supplied none. */
    _dropoutInts: Int32Array | null = null;
    /** Shared consumer-offset slot the engine worker schedules notes against. */
    _syncInts: Int32Array | null = null;
    /**
     * True once the ring has delivered at least one full block. Starvation
     * before that is the startup pre-roll, not a dropout, and is not counted.
     */
    _hasDelivered = false;
    /**
     * Count starvation from the very first quantum instead of waiting for the
     * ring to deliver once.
     *
     * Live, the quanta before the engine worker's first block are genuine
     * pre-roll — the context has been running for seconds and nothing is
     * scheduled yet — so counting them would put a few false dropouts into the
     * health metric every time a device is built. A render has no such window:
     * frame 0 of the export is content, and a quantum of silence there is a hole
     * in the file. Gating on `_hasDelivered` alone meant the *worst* offline
     * outcome — a ring that never delivers at all, so the whole export is
     * silence — reported zero dropouts, because the counter was still waiting
     * for the first delivery that would license it to count.
     */
    _countPreRoll = false;

    constructor() {
        super();
        this.port.onmessage = (event: MessageEvent<GrandBouleMsg>) => {
            const msg = event.data;
            if (msg.type === 'init' && !this._ready) {
                if (msg.dropoutSab) {
                    this._dropoutInts = new Int32Array(msg.dropoutSab);
                }
                if (msg.syncSab) {
                    this._syncInts = new Int32Array(msg.syncSab);
                }
                this._countPreRoll = msg.countPreRollStarvation === true;
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

    /**
     * Tell the engine worker where the context clock stands relative to the
     * frames it has produced, so it can place a scheduled note in the block that
     * will actually be heard at that frame.
     *
     * Published on every quantum, underruns included: while the ring is starved
     * `readHead` holds still and the gap genuinely grows, and the worker has to
     * see that or it schedules against a mapping that stopped being true. RT-safe
     * — one `Atomics` store on an already-mapped view, no allocation, no lock.
     */
    _publishConsumerOffset(readHead: number): void {
        const sync = this._syncInts;
        if (!sync) {
            return;
        }
        Atomics.store(sync, CONSUMER_OFFSET_IDX, (currentFrame - readHead) | 0);
    }

    _initSab(sab: SharedArrayBuffer): void {
        this._controlInts = new Int32Array(sab, 0, 2);
        const headerBytes = 2 * Int32Array.BYTES_PER_ELEMENT;
        const floatBytes = sab.byteLength - headerBytes;
        this._ringFrames = floatBytes / (2 * Float32Array.BYTES_PER_ELEMENT);
        this._leftRing = new Float32Array(sab, headerBytes, this._ringFrames);
        this._rightRing = new Float32Array(
            sab,
            headerBytes + this._ringFrames * Float32Array.BYTES_PER_ELEMENT,
            this._ringFrames
        );
        this._ready = true;
        this.port.postMessage({ type: 'ready' });
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

        const { consumed, nextReadHead } = readBlockAcquire(
            this._controlInts,
            this._leftRing,
            this._rightRing,
            this._ringFrames,
            out0,
            out1,
            frames
        );

        // `nextReadHead` equals the pre-call read head on an underrun, so this is
        // the head of the block being delivered either way.
        this._publishConsumerOffset(nextReadHead - consumed);

        if (consumed === 0) {
            // Underrun — output silence. The engine worker will catch up. This
            // used to vanish without a trace; now it lands in the shared dropout
            // counters so the glitch is diagnosable after the fact (audit RT-10).
            if (this._hasDelivered || this._countPreRoll) {
                this._recordUnderrun(frames);
            }
            return true;
        }
        this._hasDelivered = true;

        // Release the read head only after the frames have been copied out.
        Atomics.store(this._controlInts, READ_HEAD_IDX, nextReadHead);

        return true;
    }
}

registerProcessor('grand-boule-processor', GrandBouleProcessor);
