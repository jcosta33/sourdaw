/**
 * The shape `pnpm transport:clock --record` writes, and the percentile
 * summaries computed from it.
 *
 * Split from the driver in `scripts/measureTransportClock.ts` so that what a
 * baseline record *contains* can be read without reading how the browser
 * probe is launched and driven — the same reason `desktopLatencyRecord.ts`
 * is split from `measureDesktopLatency.ts`. `percentiles` lives here rather
 * than in the driver so the record and the printed report derive every
 * summary figure from one function; a second copy invites drift between what
 * the terminal prints and what the committed baseline says.
 *
 * A record outlives the run that produced it, and the native-cutover
 * comparison this exists for reads it to know what it is comparing against —
 * so it never carries the raw per-tick sample arrays, only the summaries a
 * later reader needs.
 */

import { type MachineRecord } from './desktopLatencyRecord.ts';

export type Percentiles = {
    samples: number;
    p50: number;
    p95: number;
    p99: number;
    max: number;
    min: number;
    mean: number;
};

export function percentiles(values: readonly number[]): Percentiles {
    if (values.length === 0) {
        return { samples: 0, p50: 0, p95: 0, p99: 0, max: 0, min: 0, mean: 0 };
    }
    const sorted = [...values].sort((a, b) => a - b);
    const at = (fraction: number): number => {
        const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(fraction * sorted.length) - 1));
        return sorted[index] ?? 0;
    };
    const total = sorted.reduce((sum, value) => sum + value, 0);
    return {
        samples: sorted.length,
        p50: at(0.5),
        p95: at(0.95),
        p99: at(0.99),
        max: sorted[sorted.length - 1] ?? 0,
        min: sorted[0] ?? 0,
        mean: total / sorted.length,
    };
}

/**
 * One `AudioContext.currentTime` granularity probe, structurally identical to
 * `measureTransportClock.ts`'s own `GranularityRun` — kept as a separate
 * declaration rather than an import so this module has no dependency back on
 * the driver, only the driver depends on this one.
 */
export type GranularityLegEntry = {
    label: string;
    requestedSampleRate: number | null;
    latencyHint: string | number;
    actualSampleRate: number;
    baseLatencySec: number;
    outputLatencySec: number;
    minStepSec: number;
    modalStepSec: number;
    distinctSteps: number;
    polls: number;
    advances: number;
};

/** One delivered scheduler-worker tick, exactly as `measureTicks` collects it. */
export type TickSample = {
    interArrivalMs: number;
    deliveryLatenessMs: number;
    workerWakeLatenessMs: number;
    sequenceJump: number;
    currentTimeDeltaSec: number;
};

/** One load condition's run (idle, ui-load, or one stall length), before summarizing. */
export type TickRunInput = {
    condition: string;
    loadDescription: string;
    sampleRate: number;
    baseLatencySec: number;
    outputLatencySec: number;
    samples: readonly TickSample[];
};

export type TickRunSummary = {
    condition: string;
    loadDescription: string;
    sampleRate: number;
    baseLatencySec: number;
    outputLatencySec: number;
    sampleCount: number;
    interArrivalMs: Percentiles;
    deliveryLatenessMs: Percentiles;
    workerWakeLatenessMs: Percentiles;
    /**
     * Only ticks whose `currentTimeDeltaSec` exceeded `lookAheadMs` — the
     * same `overBudget` filter `reportClamp` applies. Empty (all-zero
     * `Percentiles`) on idle and ui-load runs, where the stall never reached
     * the scheduler.
     */
    rawDeltaMs: Percentiles;
    /** `rawDeltaMs - lookAheadMs` per over-budget tick — what `startPlayheadScheduler.ts:195` actually discards. */
    discardedMs: Percentiles;
    totalLostSec: number;
    beatsAt120Bpm: number;
};

export type TransportClockRecord = {
    schemaVersion: 1;
    measuredAt: string;
    machine: MachineRecord;
    browser: string;
    grainMs: number;
    lookAheadMs: number;
    placementBudgetMs: number;
    granularity: readonly GranularityLegEntry[];
    runs: readonly TickRunSummary[];
};

export type BuildTransportClockRecordInput = {
    measuredAt: string;
    machine: MachineRecord;
    browser: string;
    grainMs: number;
    lookAheadMs: number;
    placementBudgetMs: number;
    granularity: readonly GranularityLegEntry[];
    runs: readonly TickRunInput[];
};

function summarizeTickRun(run: TickRunInput, lookAheadMs: number): TickRunSummary {
    const maxDeltaSeconds = lookAheadMs / 1000;
    const overBudget = run.samples.filter((sample) => sample.currentTimeDeltaSec > maxDeltaSeconds);
    const rawDeltasMs = overBudget.map((sample) => sample.currentTimeDeltaSec * 1000);
    const discardedMsValues = overBudget.map((sample) => sample.currentTimeDeltaSec * 1000 - lookAheadMs);
    const totalLostSec = discardedMsValues.reduce((sum, value) => sum + value, 0) / 1000;

    return {
        condition: run.condition,
        loadDescription: run.loadDescription,
        sampleRate: run.sampleRate,
        baseLatencySec: run.baseLatencySec,
        outputLatencySec: run.outputLatencySec,
        sampleCount: run.samples.length,
        interArrivalMs: percentiles(run.samples.map((sample) => sample.interArrivalMs)),
        deliveryLatenessMs: percentiles(run.samples.map((sample) => sample.deliveryLatenessMs)),
        workerWakeLatenessMs: percentiles(run.samples.map((sample) => sample.workerWakeLatenessMs)),
        rawDeltaMs: percentiles(rawDeltasMs),
        discardedMs: percentiles(discardedMsValues),
        totalLostSec,
        beatsAt120Bpm: totalLostSec * 2,
    };
}

/**
 * Pure: every input the record needs — including `machine`, since
 * `machineProvenance()` shells out to `git` — is supplied by the caller
 * rather than read here.
 */
export function buildTransportClockRecord(input: BuildTransportClockRecordInput): TransportClockRecord {
    return {
        schemaVersion: 1,
        measuredAt: input.measuredAt,
        machine: input.machine,
        browser: input.browser,
        grainMs: input.grainMs,
        lookAheadMs: input.lookAheadMs,
        placementBudgetMs: input.placementBudgetMs,
        granularity: input.granularity,
        runs: input.runs.map((run) => summarizeTickRun(run, input.lookAheadMs)),
    };
}
