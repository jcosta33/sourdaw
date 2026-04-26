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
        const ringSize = this._ringSize;
        for (let index = 0; index < input.length; index++) {
            this._ring[(head + index) % ringSize] = input[index] ?? 0;
        }
        Atomics.add(this._writeHead, 0, input.length);
        return true;
    }
}

registerProcessor('recording-processor', RecordingWorkletProcessor);
