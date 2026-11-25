import grinderAudioParamContract from '../services/grinderAudioParamContract.json';

const SLOTS_PER_PARAMETER = 64;
// A near-boundary native event can be clamped to the next render quantum.
const TICKET_REUSE_GRACE_FRAMES = 2048;
const SLOT_COUNT = grinderAudioParamContract.length * SLOTS_PER_PARAMETER;
const STAMP_BYTES = SLOT_COUNT * Int32Array.BYTES_PER_ELEMENT;
const BUFFER_BYTES = STAMP_BYTES + SLOT_COUNT * 2 * Float64Array.BYTES_PER_ELEMENT;

export const GRINDER_PARAMETER_TIME_CONSTANT = 0.01;
export const MAX_GRINDER_TIMED_PARAMETER_TICKET = 2 ** 24 - 1;

const ordinals = new Map(grinderAudioParamContract.map(({ name }, index) => [name, index]));

export function getGrinderContinuousParameterOrdinal(name: string): number | undefined {
    return ordinals.get(name);
}

export function getGrinderTimedParameterName(name: string): string {
    return `grinder-timed-${name}`;
}

/** A single AudioParam event carries a ticket to its already-published value. */
export class GrinderTimedParameterControl {
    private readonly stamps: Int32Array;
    private readonly slots: Float64Array;

    constructor(readonly buffer = new SharedArrayBuffer(BUFFER_BYTES)) {
        this.stamps = new Int32Array(buffer, 0, SLOT_COUNT);
        this.slots = new Float64Array(buffer, STAMP_BYTES, SLOT_COUNT * 2);
    }

    static fromProcessorOptions(options: unknown): GrinderTimedParameterControl | null {
        if (typeof options !== 'object' || options === null || !('processorOptions' in options)) {
            return null;
        }
        const value = options.processorOptions;
        if (typeof value !== 'object' || value === null || !('grinderTimedParameters' in value)) {
            return null;
        }
        const buffer = value.grinderTimedParameters;
        return typeof SharedArrayBuffer !== 'undefined' &&
            buffer instanceof SharedArrayBuffer &&
            buffer.byteLength === BUFFER_BYTES
            ? new GrinderTimedParameterControl(buffer)
            : null;
    }

    reserve(ordinal: number, value: number, frame: number, nextFrame: number): number {
        const first = ordinal * SLOTS_PER_PARAMETER;
        const reuseBefore = nextFrame - TICKET_REUSE_GRACE_FRAMES;
        for (let index = 0; index < SLOTS_PER_PARAMETER; index++) {
            const slot = first + index;
            const previous = Atomics.load(this.stamps, slot);
            if (previous !== 0 && (this.slots[slot * 2] ?? Infinity) >= reuseBefore) {
                continue;
            }
            const ticket = previous === 0 ? index + 1 : previous + SLOTS_PER_PARAMETER;
            if (ticket > MAX_GRINDER_TIMED_PARAMETER_TICKET) {
                continue;
            }
            Atomics.store(this.stamps, slot, 0);
            this.slots[slot * 2] = frame;
            this.slots[slot * 2 + 1] = value;
            Atomics.store(this.stamps, slot, ticket);
            return ticket;
        }
        throw new Error('Grinder timed parameter capacity exhausted');
    }

    read(ordinal: number, ticket: number, installedFrame: number): number | undefined {
        const slot = ordinal * SLOTS_PER_PARAMETER + ((ticket - 1) % SLOTS_PER_PARAMETER);
        if (Atomics.load(this.stamps, slot) !== ticket || (this.slots[slot * 2] ?? -1) < installedFrame) {
            return undefined;
        }
        const value = this.slots[slot * 2 + 1];
        return Atomics.load(this.stamps, slot) === ticket ? value : undefined;
    }
}
