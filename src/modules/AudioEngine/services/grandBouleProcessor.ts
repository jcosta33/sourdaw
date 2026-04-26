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

type GrandBouleMsg = { type: 'init'; sab: SharedArrayBuffer };

class GrandBouleProcessor extends AudioWorkletProcessor {
    _controlInts: Int32Array | null = null;
    _leftRing: Float32Array | null = null;
    _rightRing: Float32Array | null = null;
    _ringFrames = 0;
    _ready = false;

    constructor() {
        super();
        this.port.onmessage = (event: MessageEvent<GrandBouleMsg>) => {
            const msg = event.data;
            if (msg.type === 'init' && !this._ready) {
                this._initSab(msg.sab);
            }
        };
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

        const writeHead = Atomics.load(this._controlInts, WRITE_HEAD_IDX);
        const readHead = Atomics.load(this._controlInts, READ_HEAD_IDX);
        const available = (writeHead - readHead) | 0;

        if (available < frames) {
            // Underrun — output silence. The engine worker will catch up.
            return true;
        }

        const offset = (readHead >>> 0) % this._ringFrames;
        const firstChunk = Math.min(frames, this._ringFrames - offset);
        const secondChunk = frames - firstChunk;

        // Copy left channel.
        out0.set(this._leftRing.subarray(offset, offset + firstChunk));
        if (secondChunk > 0) {
            out0.set(this._leftRing.subarray(0, secondChunk), firstChunk);
        }

        // Copy right channel.
        const out1 = output[1];
        if (out1) {
            out1.set(this._rightRing.subarray(offset, offset + firstChunk));
            if (secondChunk > 0) {
                out1.set(this._rightRing.subarray(0, secondChunk), firstChunk);
            }
        }

        Atomics.store(this._controlInts, READ_HEAD_IDX, (readHead + frames) | 0);

        return true;
    }
}

registerProcessor('grand-boule-processor', GrandBouleProcessor);
