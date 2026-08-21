/**
 * Retained AudioWorklet ring consumer for the Grand Boule host design.
 *
 * It constructs no DSP instance. Focused host tests may inject a producer for
 * the SharedArrayBuffer ring; released product paths cannot obtain a Grand
 * Boule constructor from daw-dsp WASM and remain blocked by release admission.
 *
 * Messages from main thread:
 *   { type: 'init', sab: SharedArrayBuffer }
 *
 * SAB layout:
 *   [0] writeHead, [1] readHead, [2] render request generation,
 *   [3] sleep-after head, [4] DSP lifecycle, [5] hard-flush generation,
 *   [6] hard-flush write boundary, followed by the stereo Float32 rings.
 */

import {
    GRAND_BOULE_CONTROL_HEADER_BYTES,
    GRAND_BOULE_CONTROL_INT_COUNT,
    GRAND_BOULE_FLUSH_GENERATION_IDX,
    GRAND_BOULE_FLUSH_HEAD_IDX,
    GRAND_BOULE_LIFECYCLE_IDX,
    GRAND_BOULE_LIFECYCLE_SLEEP,
    GRAND_BOULE_READ_HEAD_IDX,
    GRAND_BOULE_RENDER_REQUEST_IDX,
    GRAND_BOULE_SLEEP_HEAD_IDX,
    GRAND_BOULE_WRITE_HEAD_IDX,
} from '../models/GrandBouleRingProtocol';

import { publishGrandBouleConsumerClock } from './grandBouleConsumerClock';

/**
 * Seqlocked sync SAB carrying an absolute context frame and the modular read
 * head that maps to it.
 *
 * The engine worker schedules notes against the frames it produces, but every
 * `sampleFrame` in the app is a context frame; this is the only thing that
 * relates the two, and only this side can measure it. It is not a constant: a
 * ring underrun advances `currentFrame` while `readHead` stands still, so the
 * two clocks separate permanently at every dropout.
 */
/**
 * Int32 slot indices of the shared dropout SAB (audit RT-10) — mirrored by
 * literal from `engine/dropoutCounter.ts`, since worklet code stays isolated
 * from app modules.
 */
const DROPOUT_BLOCKS_IDX = 0;
const DROPOUT_SILENT_FRAMES_IDX = 1;
const DROPOUT_LAST_FRAME_IDX = 2;

type GrandBouleMsg =
    | {
          type: 'init';
          sab: SharedArrayBuffer;
          dropoutSab?: SharedArrayBuffer;
          syncSab?: SharedArrayBuffer;
          countPreRollStarvation?: boolean;
      }
    | { type: 'engineError' };

/**
 * Acquire-read one block of stereo frames from the SPSC ring into `out0`/`out1`.
 *
 * `Atomics.load(controlInts, WRITE_HEAD_IDX)` is the acquire fence: it pairs
 * with the engine worker's `Atomics.store(WRITE_HEAD_IDX, ...)` release, so any
 * ring frame the published write head accounts for is visible to the bare
 * `subarray` reads below. When fewer than `frames` are published the ring is
 * left untouched (underrun) and `consumed` is 0 — no stale frames are copied.
 *
 * Returns whether a complete block was copied. The caller publishes the
 * matching clock offset before releasing the advanced read head to the Worker.
 * Hot-path safe: no allocation, no blocking.
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
    const writeHead = Atomics.load(controlInts, GRAND_BOULE_WRITE_HEAD_IDX);
    const readHead = Atomics.load(controlInts, GRAND_BOULE_READ_HEAD_IDX);
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

    return true;
}

class GrandBouleProcessor extends AudioWorkletProcessor {
    _controlInts: Int32Array | null = null;
    _leftRing: Float32Array | null = null;
    _rightRing: Float32Array | null = null;
    _ringFrames = 0;
    _ready = false;
    _failed = false;
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
    /** Last hard-flush generation observed from the engine worker. */
    _flushGeneration = 0;

    constructor() {
        super();
        this.port.onmessage = (event: MessageEvent<GrandBouleMsg>) => {
            const msg = event.data;
            if (msg.type === 'engineError') {
                this._failed = true;
                this.port.close();
            } else if (!this._ready) {
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
     * — bounded `Atomics` operations on an already-mapped view, no allocation
     * and no blocking lock.
     */
    _publishConsumerClock(readHead: number, audibleContextFrame = currentFrame): void {
        const sync = this._syncInts;
        if (!sync) {
            return;
        }
        publishGrandBouleConsumerClock(sync, audibleContextFrame, readHead);
    }

    _initSab(sab: SharedArrayBuffer): void {
        this._controlInts = new Int32Array(sab, 0, GRAND_BOULE_CONTROL_INT_COUNT);
        const floatBytes = sab.byteLength - GRAND_BOULE_CONTROL_HEADER_BYTES;
        this._ringFrames = floatBytes / (2 * Float32Array.BYTES_PER_ELEMENT);
        this._leftRing = new Float32Array(sab, GRAND_BOULE_CONTROL_HEADER_BYTES, this._ringFrames);
        this._rightRing = new Float32Array(
            sab,
            GRAND_BOULE_CONTROL_HEADER_BYTES + this._ringFrames * Float32Array.BYTES_PER_ELEMENT,
            this._ringFrames
        );
        this._flushGeneration = Atomics.load(this._controlInts, GRAND_BOULE_FLUSH_GENERATION_IDX);
        this._ready = true;
        this.port.postMessage({ type: 'ready' });
    }

    _requestRender(): void {
        const controls = this._controlInts;
        if (!controls) {
            return;
        }
        Atomics.add(controls, GRAND_BOULE_RENDER_REQUEST_IDX, 1);
        Atomics.notify(controls, GRAND_BOULE_RENDER_REQUEST_IDX);
    }

    process(_inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
        if (this._failed) {
            return false;
        }
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

        const flushGeneration = Atomics.load(this._controlInts, GRAND_BOULE_FLUSH_GENERATION_IDX);
        if (flushGeneration !== this._flushGeneration) {
            this._flushGeneration = flushGeneration;
            const flushHead = Atomics.load(this._controlInts, GRAND_BOULE_FLUSH_HEAD_IDX);
            // This quantum is forced to silence. The first preserved or newly
            // rendered frame at `flushHead` can be audible only next quantum.
            this._publishConsumerClock(flushHead, currentFrame + frames);
            Atomics.store(this._controlInts, GRAND_BOULE_READ_HEAD_IDX, flushHead);
            out0.fill(0);
            out1?.fill(0);
            this._hasDelivered = false;
            if (Atomics.load(this._controlInts, GRAND_BOULE_LIFECYCLE_IDX) !== GRAND_BOULE_LIFECYCLE_SLEEP) {
                this._requestRender();
            }
            return true;
        }

        const readHead = Atomics.load(this._controlInts, GRAND_BOULE_READ_HEAD_IDX);
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
            // This quantum is forced to silence. The unchanged read head can
            // first become audible in the following context quantum.
            this._publishConsumerClock(readHead, currentFrame + frames);
            out0.fill(0);
            out1?.fill(0);
            // Underrun — output silence. The engine worker will catch up. This
            // used to vanish without a trace; now it lands in the shared dropout
            // counters so the glitch is diagnosable after the fact (audit RT-10).
            const sleepHead = Atomics.load(this._controlInts, GRAND_BOULE_SLEEP_HEAD_IDX);
            const lifecycleState = Atomics.load(this._controlInts, GRAND_BOULE_LIFECYCLE_IDX);
            const expectedSilence = lifecycleState === GRAND_BOULE_LIFECYCLE_SLEEP || sleepHead === readHead;
            if (!expectedSilence && (this._hasDelivered || this._countPreRoll)) {
                this._recordUnderrun(frames);
            }
            if (lifecycleState !== GRAND_BOULE_LIFECYCLE_SLEEP) {
                this._requestRender();
            }
            return true;
        }
        this._publishConsumerClock(readHead);
        this._hasDelivered = true;

        const nextReadHead = (readHead + frames) | 0;
        // Publish the context-to-engine clock mapping before release-publishing
        // capacity. A Worker that sees the advanced read head must also see the
        // offset for the block that freed it.
        Atomics.store(this._controlInts, GRAND_BOULE_READ_HEAD_IDX, nextReadHead);
        const sleepHead = Atomics.load(this._controlInts, GRAND_BOULE_SLEEP_HEAD_IDX);
        if (nextReadHead !== sleepHead) {
            this._requestRender();
        }

        return true;
    }
}

registerProcessor('grand-boule-processor', GrandBouleProcessor);
