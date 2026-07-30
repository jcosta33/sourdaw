type TimingAccumulator = {
    samples: number;
    total: number;
    last: number;
    max: number;
};

type TimingSnapshot = TimingAccumulator & {
    average: number;
};

type SchedulerTickTiming = {
    sequence: number;
    scheduledAtMs: number;
    sentAtMs: number;
    receivedAtMs: number;
};

type SchedulerTimingSnapshot = {
    intervalMs: number;
    messagesReceived: number;
    lastSequence: number;
    sequenceGaps: number;
    outOfOrderMessages: number;
    ticksSettled: number;
    ticksSkippedInFlight: number;
    deliveryDeadlineMisses: number;
    workerWakeLatenessMs: TimingSnapshot;
    mainDeliveryLatenessMs: TimingSnapshot;
    messageTransitMs: TimingSnapshot;
    tickExecutionMs: TimingSnapshot;
};

function createAccumulator(): TimingAccumulator {
    return { samples: 0, total: 0, last: 0, max: 0 };
}

function normalizeDuration(value: number): number {
    if (!Number.isFinite(value) || value <= 0) {
        return 0;
    }
    return value;
}

function recordTiming(accumulator: TimingAccumulator, value: number): void {
    const duration = normalizeDuration(value);
    accumulator.samples++;
    accumulator.total += duration;
    accumulator.last = duration;
    accumulator.max = Math.max(accumulator.max, duration);
}

function snapshotTiming(accumulator: TimingAccumulator): TimingSnapshot {
    const average = accumulator.samples === 0 ? 0 : accumulator.total / accumulator.samples;
    return { ...accumulator, average };
}

let intervalMs = 10;
let messagesReceived = 0;
let lastSequence = 0;
let sequenceGaps = 0;
let outOfOrderMessages = 0;
let ticksSettled = 0;
let ticksSkippedInFlight = 0;
let deliveryDeadlineMisses = 0;
let workerWakeLatenessMs = createAccumulator();
let mainDeliveryLatenessMs = createAccumulator();
let messageTransitMs = createAccumulator();
let tickExecutionMs = createAccumulator();

export const schedulerTimingDiagnostics = {
    reset(nextIntervalMs: number): void {
        intervalMs = Number.isFinite(nextIntervalMs) && nextIntervalMs > 0 ? nextIntervalMs : 10;
        messagesReceived = 0;
        lastSequence = 0;
        sequenceGaps = 0;
        outOfOrderMessages = 0;
        ticksSettled = 0;
        ticksSkippedInFlight = 0;
        deliveryDeadlineMisses = 0;
        workerWakeLatenessMs = createAccumulator();
        mainDeliveryLatenessMs = createAccumulator();
        messageTransitMs = createAccumulator();
        tickExecutionMs = createAccumulator();
    },

    recordTickMessage(input: SchedulerTickTiming): void {
        messagesReceived++;
        if (lastSequence === 0) {
            sequenceGaps += Math.max(0, input.sequence - 1);
        } else if (input.sequence <= lastSequence) {
            outOfOrderMessages++;
        } else if (input.sequence > lastSequence + 1) {
            sequenceGaps += input.sequence - lastSequence - 1;
        }
        lastSequence = Math.max(lastSequence, input.sequence);

        const workerWakeLateness = normalizeDuration(input.sentAtMs - input.scheduledAtMs);
        const mainDeliveryLateness = normalizeDuration(input.receivedAtMs - input.scheduledAtMs);
        const messageTransit = normalizeDuration(input.receivedAtMs - input.sentAtMs);
        recordTiming(workerWakeLatenessMs, workerWakeLateness);
        recordTiming(mainDeliveryLatenessMs, mainDeliveryLateness);
        recordTiming(messageTransitMs, messageTransit);
        if (mainDeliveryLateness > intervalMs) {
            deliveryDeadlineMisses++;
        }
    },

    recordTickSkipped(): void {
        ticksSkippedInFlight++;
    },

    recordTickSettled(durationMs: number): void {
        ticksSettled++;
        recordTiming(tickExecutionMs, durationMs);
    },

    snapshot(): SchedulerTimingSnapshot {
        return {
            intervalMs,
            messagesReceived,
            lastSequence,
            sequenceGaps,
            outOfOrderMessages,
            ticksSettled,
            ticksSkippedInFlight,
            deliveryDeadlineMisses,
            workerWakeLatenessMs: snapshotTiming(workerWakeLatenessMs),
            mainDeliveryLatenessMs: snapshotTiming(mainDeliveryLatenessMs),
            messageTransitMs: snapshotTiming(messageTransitMs),
            tickExecutionMs: snapshotTiming(tickExecutionMs),
        };
    },
};
