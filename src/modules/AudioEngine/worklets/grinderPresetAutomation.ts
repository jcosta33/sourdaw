import {
    GRINDER_PARAMETER_TIME_CONSTANT,
    type GrinderTimedParameterControl,
    getGrinderContinuousParameterOrdinal,
} from '../models/GrinderTimedParameterControl';
import grinderAudioParamContract from '../services/grinderAudioParamContract.json';

const PARAMETER_COUNT = grinderAudioParamContract.length;

/** Continuous controls keep their native timeline until a grouped preset takes their base. */
export class GrinderPresetAutomation {
    private readonly values = Float64Array.from(grinderAudioParamContract, ({ defaultValue }) => defaultValue);
    private readonly targets = new Float64Array(PARAMETER_COUNT);
    private readonly installedFrames = new Float64Array(PARAMETER_COUNT).fill(-1);
    private readonly lastTickets = new Float64Array(PARAMETER_COUNT);
    private readonly coefficient: number;

    constructor(
        private readonly tickets: GrinderTimedParameterControl | null,
        private readonly stride: number
    ) {
        // One sample of the exponential AudioParam setTargetAtTime transition.
        this.coefficient = 1 - Math.exp(-1 / (sampleRate * GRINDER_PARAMETER_TIME_CONSTANT));
    }

    observeNative(ordinal: number, value: number): void {
        this.values[ordinal] = value;
    }

    adopt(ordinal: number, value: number): void {
        this.installedFrames[ordinal] = currentFrame;
        this.setTarget(ordinal, value);
    }

    setManualTarget(name: string, value: number): boolean {
        const ordinal = getGrinderContinuousParameterOrdinal(name);
        if (ordinal === undefined || (this.installedFrames[ordinal] ?? -1) < 0) {
            return false;
        }
        this.setTarget(ordinal, value);
        return true;
    }

    private setTarget(ordinal: number, value: number): void {
        const range = grinderAudioParamContract[ordinal];
        if (range) {
            this.targets[ordinal] = Math.min(range.maxValue, Math.max(range.minValue, value));
        }
    }

    private receiveTicket(ordinal: number, ticket: number): void {
        if (ticket === 0 || ticket === this.lastTickets[ordinal]) {
            return;
        }
        this.lastTickets[ordinal] = ticket;
        const target = this.tickets?.read(ordinal, ticket, this.installedFrames[ordinal] ?? 0);
        if (target !== undefined) {
            this.setTarget(ordinal, target);
        }
    }

    /** Copies the owned stream into the existing numerical WASM slab without allocating. */
    writeOwned(
        ordinal: number,
        ticketValues: Float32Array | undefined,
        automation: Float32Array,
        frames: number
    ): boolean {
        if ((this.installedFrames[ordinal] ?? -1) < 0) {
            return false;
        }

        this.receiveTicket(ordinal, ticketValues?.[0] ?? 0);
        const offset = PARAMETER_COUNT + ordinal * this.stride;
        const initial = this.values[ordinal] ?? 0;
        if ((ticketValues?.length ?? 0) < 2 && Math.fround(initial) === Math.fround(this.targets[ordinal] ?? 0)) {
            automation[ordinal] = 1;
            automation[offset] = initial;
            return true;
        }

        this.writeRamp(ordinal, ticketValues, automation, frames);
        return true;
    }

    private writeRamp(
        ordinal: number,
        ticketValues: Float32Array | undefined,
        automation: Float32Array,
        frames: number
    ): void {
        const offset = PARAMETER_COUNT + ordinal * this.stride;
        let value = this.values[ordinal] ?? 0;
        automation[ordinal] = frames;
        for (let frame = 0; frame < frames; frame++) {
            this.receiveTicket(ordinal, ticketValues?.[frame] ?? 0);
            automation[offset + frame] = value;
            value += ((this.targets[ordinal] ?? 0) - value) * this.coefficient;
        }
        this.values[ordinal] = value;
    }
}
