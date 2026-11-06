/**
 * Shared memory between the Transient Shaper host and its worklet: the bypass
 * reset epoch and each immediate gain with the frame it is for. The host is the
 * only writer; the processor reads it at the head of every quantum, so a write
 * made while a live context is suspended is in force on the quantum it resumes
 * on. A port message gives no such promise: Chromium dispatches it as an
 * ordinary task on the rendering thread, which can run after that quantum.
 *
 * The fields sit behind a sequence counter: the writer makes it odd, writes,
 * then makes it even, and a reader keeps its last snapshot when the counter is
 * odd or moved while it read.
 */
export type TransientShaperGainName = 'attackGain' | 'sustainGain';

export type TransientShaperControl = {
    sequence: Int32Array;
    fields: Float64Array;
};

export type TransientShaperControlSnapshot = {
    resetEpoch: number;
    attackGain: { value: number; frame: number };
    sustainGain: { value: number; frame: number };
};

const SEQUENCE_BYTES = Float64Array.BYTES_PER_ELEMENT;
const RESET_EPOCH = 0;
const GAIN_FIELDS: Record<TransientShaperGainName, { value: number; frame: number }> = {
    attackGain: { value: 1, frame: 2 },
    sustainGain: { value: 3, frame: 4 },
};
const FIELD_COUNT = 5;

export const TRANSIENT_SHAPER_CONTROL_BYTES = SEQUENCE_BYTES + FIELD_COUNT * Float64Array.BYTES_PER_ELEMENT;

/** A frame no quantum renders: the gain has no immediate value. */
export const NO_IMMEDIATE_FRAME = -1;

export function viewTransientShaperControl(buffer: unknown): TransientShaperControl | null {
    if (
        typeof SharedArrayBuffer === 'undefined' ||
        !(buffer instanceof SharedArrayBuffer) ||
        buffer.byteLength < TRANSIENT_SHAPER_CONTROL_BYTES
    ) {
        return null;
    }
    return {
        sequence: new Int32Array(buffer, 0, 1),
        fields: new Float64Array(buffer, SEQUENCE_BYTES, FIELD_COUNT),
    };
}

function writeControl(control: TransientShaperControl, write: (fields: Float64Array) => void): void {
    const odd = Atomics.load(control.sequence, 0) + 1;
    Atomics.store(control.sequence, 0, odd);
    write(control.fields);
    Atomics.store(control.sequence, 0, odd + 1);
}

export function createTransientShaperControl(resetEpoch: number): {
    buffer: SharedArrayBuffer;
    control: TransientShaperControl;
} {
    const buffer = new SharedArrayBuffer(TRANSIENT_SHAPER_CONTROL_BYTES);
    const control = viewTransientShaperControl(buffer);
    if (!control) {
        throw new Error('Transient Shaper control block is unavailable');
    }
    writeControl(control, (fields) => {
        fields[RESET_EPOCH] = resetEpoch;
        for (const slot of Object.values(GAIN_FIELDS)) {
            fields[slot.value] = 1;
            fields[slot.frame] = NO_IMMEDIATE_FRAME;
        }
    });
    return { buffer, control };
}

export function writeTransientShaperResetEpoch(control: TransientShaperControl, epoch: number): void {
    writeControl(control, (fields) => {
        fields[RESET_EPOCH] = epoch;
    });
}

export function writeTransientShaperImmediateGain(
    control: TransientShaperControl,
    name: TransientShaperGainName,
    value: number,
    frame: number
): void {
    const slot = GAIN_FIELDS[name];
    writeControl(control, (fields) => {
        fields[slot.value] = value;
        fields[slot.frame] = frame;
    });
}

/** Copies a consistent snapshot into `into`; returns false, leaving it untouched, mid-write. */
export function readTransientShaperControl(
    control: TransientShaperControl,
    into: TransientShaperControlSnapshot
): boolean {
    const before = Atomics.load(control.sequence, 0);
    if ((before & 1) === 1) {
        return false;
    }
    const fields = control.fields;
    const resetEpoch = fields[RESET_EPOCH];
    const attackValue = fields[GAIN_FIELDS.attackGain.value];
    const attackFrame = fields[GAIN_FIELDS.attackGain.frame];
    const sustainValue = fields[GAIN_FIELDS.sustainGain.value];
    const sustainFrame = fields[GAIN_FIELDS.sustainGain.frame];
    if (
        resetEpoch === undefined ||
        attackValue === undefined ||
        attackFrame === undefined ||
        sustainValue === undefined ||
        sustainFrame === undefined ||
        Atomics.load(control.sequence, 0) !== before
    ) {
        return false;
    }
    into.resetEpoch = resetEpoch;
    into.attackGain.value = attackValue;
    into.attackGain.frame = attackFrame;
    into.sustainGain.value = sustainValue;
    into.sustainGain.frame = sustainFrame;
    return true;
}
