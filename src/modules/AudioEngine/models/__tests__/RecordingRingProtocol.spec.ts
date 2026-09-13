import { describe, expect, it } from 'vitest';

import {
    beginRecordingRingWrite,
    clearRecordingSampleZeroContextFrame,
    completeRecordingRingWrite,
    readRecordingPublication,
    RECORDING_RING_CONTROL_INTS,
    RECORDING_RING_SAMPLE_ZERO_FRAME_HIGH_INDEX,
    RECORDING_RING_SAMPLE_ZERO_FRAME_LOW_INDEX,
    RECORDING_RING_SAMPLE_ZERO_FRAME_PRESENT_INDEX,
    storeRecordingSampleCount,
    storeRecordingSampleZeroContextFrame,
} from '../RecordingRingProtocol';

function makeControl(): Int32Array {
    return new Int32Array(new SharedArrayBuffer(RECORDING_RING_CONTROL_INTS * Int32Array.BYTES_PER_ELEMENT));
}

describe('RecordingRingProtocol', () => {
    it('distinguishes an absent sample-zero receipt from frame zero', () => {
        const control = makeControl();
        clearRecordingSampleZeroContextFrame(control);
        storeRecordingSampleCount(control, 0);
        expect(readRecordingPublication(control)).toMatchObject({
            status: 'stable',
            sampleCount: 0,
            sampleZeroContextFrame: null,
        });

        beginRecordingRingWrite(control);
        storeRecordingSampleZeroContextFrame(control, 0);
        storeRecordingSampleCount(control, 1);
        completeRecordingRingWrite(control);
        expect(readRecordingPublication(control)).toMatchObject({
            status: 'stable',
            sampleCount: 1,
            sampleZeroContextFrame: 0,
        });
    });

    it('round-trips a safe sample-zero frame above the unsigned low-word boundary', () => {
        const control = makeControl();
        const frame = 0x1_0000_0000 + 37;
        beginRecordingRingWrite(control);
        storeRecordingSampleZeroContextFrame(control, frame);
        storeRecordingSampleCount(control, 128);
        completeRecordingRingWrite(control);

        expect(readRecordingPublication(control)).toMatchObject({
            status: 'stable',
            sampleCount: 128,
            sampleZeroContextFrame: frame,
        });
    });

    it('refuses an odd publication and malformed receipt states', () => {
        const control = makeControl();
        beginRecordingRingWrite(control);
        expect(readRecordingPublication(control)).toEqual({ status: 'retry' });

        completeRecordingRingWrite(control);
        storeRecordingSampleCount(control, 1);
        expect(readRecordingPublication(control)).toEqual({ status: 'protocol-error' });

        storeRecordingSampleCount(control, 0);
        Atomics.store(control, RECORDING_RING_SAMPLE_ZERO_FRAME_PRESENT_INDEX, 1);
        expect(readRecordingPublication(control)).toEqual({ status: 'protocol-error' });

        clearRecordingSampleZeroContextFrame(control);
        Atomics.store(control, RECORDING_RING_SAMPLE_ZERO_FRAME_LOW_INDEX, 1);
        expect(readRecordingPublication(control)).toEqual({ status: 'protocol-error' });

        Atomics.store(control, RECORDING_RING_SAMPLE_ZERO_FRAME_LOW_INDEX, 0);
        Atomics.store(control, RECORDING_RING_SAMPLE_ZERO_FRAME_PRESENT_INDEX, 2);
        expect(readRecordingPublication(control)).toEqual({ status: 'protocol-error' });

        Atomics.store(control, RECORDING_RING_SAMPLE_ZERO_FRAME_PRESENT_INDEX, 1);
        Atomics.store(control, RECORDING_RING_SAMPLE_ZERO_FRAME_HIGH_INDEX, 0x20_0000);
        storeRecordingSampleCount(control, 1);
        expect(readRecordingPublication(control)).toEqual({ status: 'protocol-error' });
    });
});
