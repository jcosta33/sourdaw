import { createTelemetryReader, GRINDER_IDX, TELEMETRY_SEQ_IDX, type TelemetrySlot } from './telemetryAllocator';

export type GrinderMeterData = {
    inputDb: number;
    preampDb: number;
    powerAmpDb: number;
    outputDb: number;
    gateOpen: number;
    gateEnvelopeDb: number;
    sagVoltage: number;
    latency: number;
    neuralCpuPercent: number;
    neuralWarmupProgress: number;
};

/** Slot floats → meter snapshot. Pure: the seqlock reader may re-run it on retry. */
function projectGrinderMeter(view: Float32Array): GrinderMeterData {
    return {
        inputDb: view[GRINDER_IDX.inputDb] ?? 0,
        preampDb: view[GRINDER_IDX.preampDb] ?? 0,
        powerAmpDb: view[GRINDER_IDX.powerAmpDb] ?? 0,
        outputDb: view[GRINDER_IDX.outputDb] ?? 0,
        gateOpen: view[GRINDER_IDX.gateOpen] ?? 0,
        gateEnvelopeDb: view[GRINDER_IDX.gateEnvelopeDb] ?? 0,
        sagVoltage: view[GRINDER_IDX.sagVoltage] ?? 0,
        latency: view[GRINDER_IDX.latency] ?? 0,
        neuralCpuPercent: view[GRINDER_IDX.neuralCpuPercent] ?? 0,
        neuralWarmupProgress: view[GRINDER_IDX.neuralWarmupProgress] ?? 0,
    };
}

export function createGrinderNodeMeter(slot: TelemetrySlot | null) {
    let meterRafId: number | null = null;
    let latencyCallback: ((latency: number) => void) | null = null;
    let lastReportedLatency: number | null = null;
    let presetTelemetrySequence: number | null = null;
    const reportLatencyChange = (latency: number): void => {
        if (latency === lastReportedLatency) {
            return;
        }
        lastReportedLatency = latency;
        latencyCallback?.(latency);
    };

    const stop = (): void => {
        if (meterRafId !== null) {
            cancelAnimationFrame(meterRafId);
            meterRafId = null;
        }
    };

    return {
        start(cb: (data: GrinderMeterData) => void) {
            stop();
            if (!slot) {
                return;
            }
            // Read under the slot seqlock (audit RT-2): without it a poll could pair
            // a gate state with a latency reported from a different quantum. Built
            // once, outside the poll, since it retains the last consistent snapshot.
            const { seqView } = slot;
            const readMeter = createTelemetryReader({ slot, project: projectGrinderMeter });
            const poll = () => {
                const telemetrySequence = Atomics.load(seqView, TELEMETRY_SEQ_IDX);
                const data = readMeter();
                if (
                    presetTelemetrySequence !== null &&
                    (telemetrySequence === presetTelemetrySequence ||
                        (telemetrySequence & 1) !== 0 ||
                        telemetrySequence !== Atomics.load(seqView, TELEMETRY_SEQ_IDX))
                ) {
                    // A cached meter frame must not undo the acknowledged preset latency.
                    cb({ ...data, latency: lastReportedLatency ?? data.latency });
                } else {
                    presetTelemetrySequence = null;
                    reportLatencyChange(data.latency);
                    cb(data);
                }
                meterRafId = requestAnimationFrame(poll);
            };
            meterRafId = requestAnimationFrame(poll);
        },
        onLatencyChanged(cb: (latency: number) => void) {
            latencyCallback = cb;
        },
        reportLatencyChange,
        reportPresetLatency(latency: number) {
            presetTelemetrySequence = slot ? Atomics.load(slot.seqView, TELEMETRY_SEQ_IDX) : null;
            reportLatencyChange(latency);
        },
        stop,
    };
}
