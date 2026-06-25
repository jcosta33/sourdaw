/**
 * RecordingWorkletProcessor — captures raw PCM on the isolated audio thread.
 *
 * Runs inside an AudioWorkletGlobalScope. Writes 128-sample input blocks
 * directly into a SharedArrayBuffer ring buffer. No allocations on the hot
 * path; no postMessage during capture.
 *
 * SAB layout:
 *   Bytes 0–3  : writeHead (Int32, monotonically increasing sample count)
 *   Bytes 4+   : ring data (Float32, length = (sab.byteLength - 4) / 4)
 *
 * Port protocol:
 *   ← { type: 'init',  sab: SharedArrayBuffer }  wire up ring before start
 *   ← { type: 'start' }                           begin writing samples
 *   ← { type: 'stop'  }                           stop; ack with 'stopped'
 *   → { type: 'stopped', writeHead: number }      total samples written
 */

type RecordingMsg = { type: 'init'; sab: SharedArrayBuffer } | { type: 'start' } | { type: 'stop' };

/**
 * Release-publish a block of samples into the SPSC ring.
 *
 * Writes every sample into the ring (with wrap-around), then advances the head
 * with `Atomics.add`. That atomic is the release fence: it is sequenced after
 * the ring writes, so a consumer that acquires the head with `Atomics.load`
 * before reading the ring can never observe a head increment without the
 * corresponding samples. Returns the new head for assertion.
 *
 * Hot-path safe: no allocation, no blocking; reused by `process`.
 */
export function writeRingRelease(ring: Float32Array, writeHead: Int32Array, head: number, input: Float32Array): number {
    const ringSize = ring.length;
    // Data writes — must be sequenced-before the release store below.
    for (let index = 0; index < input.length; index++) {
        ring[(head + index) % ringSize] = input[index] ?? 0;
    }
    // Release fence: publish the samples atomically after they are all written.
    Atomics.add(writeHead, 0, input.length);
    return head + input.length;
}

class RecordingWorkletProcessor extends AudioWorkletProcessor {
    _writeHead: Int32Array | null = null;
    _ring: Float32Array | null = null;
    _ringSize = 0;
    _active = false;

    constructor() {
        super();
        this.port.onmessage = ({ data }: MessageEvent<RecordingMsg>) => {
            switch (data.type) {
                case 'init': {
                    const sab = data.sab;
                    this._writeHead = new Int32Array(sab, 0, 1);
                    this._ring = new Float32Array(sab, 4);
                    this._ringSize = this._ring.length;
                    break;
                }
                case 'start':
                    this._active = true;
                    break;
                case 'stop': {
                    this._active = false;
                    const head = this._writeHead ? Atomics.load(this._writeHead, 0) : 0;
                    this.port.postMessage({ type: 'stopped', writeHead: head });
                    break;
                }
            }
        };
    }

    process(inputs: Float32Array[][]): boolean {
        if (!this._active || !this._ring || !this._writeHead) {
            return true;
        }
        const input = inputs[0]?.[0];
        if (!input || input.length === 0) {
            return true;
        }

        const head = Atomics.load(this._writeHead, 0);
        writeRingRelease(this._ring, this._writeHead, head, input);
        return true;
    }
}

registerProcessor('recording-processor', RecordingWorkletProcessor);
