/**
 * RecordingWorkletProcessor — captures raw PCM on the isolated audio thread.
 *
 * Runs inside an AudioWorkletGlobalScope. Writes 128-sample input blocks
 * directly into a SharedArrayBuffer ring buffer. No allocations on the hot
 * path; no postMessage during capture.
 *
 * SAB layout is shared with the worker through `RecordingRingProtocol`:
 * a sequence word, unsigned low/high count words, then the Float32 ring.
 *
 * Port protocol:
 *   ← { type: 'init',  sab: SharedArrayBuffer }  wire up ring before start
 *   ← { type: 'start' }                           begin writing samples
 *   ← { type: 'stop'  }                           stop; ack with 'stopped'
 *   → { type: 'stopped', publishedSampleCount: number } total samples written
 */

import {
    beginRecordingRingWrite,
    clearRecordingSampleZeroContextFrame,
    completeRecordingRingWrite,
    RECORDING_RING_CONTROL_BYTES,
    RECORDING_RING_CONTROL_INTS,
    storeRecordingSampleCount,
    storeRecordingSampleZeroContextFrame,
} from '../models/RecordingRingProtocol';

type RecordingMsg = { type: 'init'; sab: SharedArrayBuffer } | { type: 'start' } | { type: 'stop' };

/**
 * Release-publish a block of samples into the SPSC ring.
 *
 * Marks publication in progress, writes every sample into the ring with
 * wrap-around, publishes the full cumulative count, then marks publication
 * complete. The sequence transition is the consumer's copy fence: a reader
 * accepts PCM only when the same even sequence and cumulative count bracket
 * the copy. Returns the new cumulative count for assertion.
 *
 * Hot-path safe: no allocation, no blocking; reused by `process`.
 */
export function writeRingRelease(
    ring: Float32Array,
    control: Int32Array,
    head: number,
    input: Float32Array,
    sampleZeroContextFrame: number
): number {
    const ringSize = ring.length;
    const nextHead = head + input.length;
    // An odd sequence invalidates any concurrent consumer copy before the
    // producer can overwrite a ring slot.
    beginRecordingRingWrite(control);
    if (head === 0) {
        storeRecordingSampleZeroContextFrame(control, sampleZeroContextFrame);
    }
    for (let index = 0; index < input.length; index++) {
        ring[(head + index) % ringSize] = input[index] ?? 0;
    }
    storeRecordingSampleCount(control, nextHead);
    // The even sequence release-publishes both the count words and samples.
    completeRecordingRingWrite(control);
    return nextHead;
}

class RecordingWorkletProcessor extends AudioWorkletProcessor {
    _control: Int32Array | null = null;
    _ring: Float32Array | null = null;
    _ringSize = 0;
    _publishedSampleCount = 0;
    _active = false;

    constructor() {
        super();
        this.port.onmessage = ({ data }: MessageEvent<RecordingMsg>) => {
            switch (data.type) {
                case 'init': {
                    const sab = data.sab;
                    this._control = new Int32Array(sab, 0, RECORDING_RING_CONTROL_INTS);
                    this._ring = new Float32Array(sab, RECORDING_RING_CONTROL_BYTES);
                    this._ringSize = this._ring.length;
                    this._publishedSampleCount = 0;
                    Atomics.store(this._control, 0, 0);
                    storeRecordingSampleCount(this._control, 0);
                    clearRecordingSampleZeroContextFrame(this._control);
                    break;
                }
                case 'start':
                    this._active = true;
                    break;
                case 'stop': {
                    this._active = false;
                    this.port.postMessage({
                        type: 'stopped',
                        publishedSampleCount: this._publishedSampleCount,
                    });
                    break;
                }
            }
        };
    }

    process(inputs: Float32Array[][]): boolean {
        if (!this._active || !this._ring || !this._control) {
            return true;
        }
        const input = inputs[0]?.[0];
        if (!input || input.length === 0) {
            return true;
        }

        this._publishedSampleCount = writeRingRelease(
            this._ring,
            this._control,
            this._publishedSampleCount,
            input,
            currentFrame
        );
        return true;
    }
}

registerProcessor('recording-processor', RecordingWorkletProcessor);
