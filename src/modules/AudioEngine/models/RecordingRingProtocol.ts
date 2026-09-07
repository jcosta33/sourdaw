export const RECORDING_RING_SEQUENCE_INDEX = 0;
export const RECORDING_RING_COUNT_LOW_INDEX = 1;
export const RECORDING_RING_COUNT_HIGH_INDEX = 2;
export const RECORDING_RING_CONTROL_INTS = 3;
export const RECORDING_RING_CONTROL_BYTES = RECORDING_RING_CONTROL_INTS * Int32Array.BYTES_PER_ELEMENT;

const UINT32_RADIX = 0x1_0000_0000;
const MAX_SAFE_HIGH_WORD = Math.floor(Number.MAX_SAFE_INTEGER / UINT32_RADIX);

export type RecordingPublication =
    { status: 'stable'; sequence: number; sampleCount: number } | { status: 'retry' } | { status: 'protocol-error' };

export function isRecordingSampleCount(value: number): boolean {
    return Number.isSafeInteger(value) && value >= 0;
}

export function storeRecordingSampleCount(control: Int32Array, sampleCount: number): void {
    const high = Math.floor(sampleCount / UINT32_RADIX);
    const low = sampleCount - high * UINT32_RADIX;
    Atomics.store(control, RECORDING_RING_COUNT_LOW_INDEX, low);
    Atomics.store(control, RECORDING_RING_COUNT_HIGH_INDEX, high);
}

export function beginRecordingRingWrite(control: Int32Array): void {
    Atomics.add(control, RECORDING_RING_SEQUENCE_INDEX, 1);
}

export function completeRecordingRingWrite(control: Int32Array): void {
    Atomics.add(control, RECORDING_RING_SEQUENCE_INDEX, 1);
}

export function readRecordingPublication(control: Int32Array): RecordingPublication {
    if (control.length < RECORDING_RING_CONTROL_INTS) {
        return { status: 'protocol-error' };
    }

    const sequenceBefore = Atomics.load(control, RECORDING_RING_SEQUENCE_INDEX) >>> 0;
    if ((sequenceBefore & 1) !== 0) {
        return { status: 'retry' };
    }

    const low = Atomics.load(control, RECORDING_RING_COUNT_LOW_INDEX) >>> 0;
    const high = Atomics.load(control, RECORDING_RING_COUNT_HIGH_INDEX) >>> 0;
    const sequenceAfter = Atomics.load(control, RECORDING_RING_SEQUENCE_INDEX) >>> 0;
    if (sequenceBefore !== sequenceAfter || (sequenceAfter & 1) !== 0) {
        return { status: 'retry' };
    }
    if (high > MAX_SAFE_HIGH_WORD) {
        return { status: 'protocol-error' };
    }

    const sampleCount = high * UINT32_RADIX + low;
    if (!isRecordingSampleCount(sampleCount)) {
        return { status: 'protocol-error' };
    }
    return { status: 'stable', sequence: sequenceAfter, sampleCount };
}
