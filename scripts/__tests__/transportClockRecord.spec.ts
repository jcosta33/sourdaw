import { describe, expect, it } from 'vitest';

import {
    buildTransportClockRecord,
    percentiles,
    recordPathFromArgv,
    type BuildTransportClockRecordInput,
    type GranularityLegEntry,
    type TickRunInput,
    type TickSample,
} from '../transportClockRecord.ts';

const granularity: readonly GranularityLegEntry[] = [
    {
        label: 'product default (interactive, device rate)',
        requestedSampleRate: null,
        latencyHint: 'interactive',
        actualSampleRate: 48_000,
        baseLatencySec: 0.005333333333333333,
        outputLatencySec: 0.016,
        minStepSec: 0.0026666666666666666,
        modalStepSec: 0.0026666666666666666,
        distinctSteps: 2,
        polls: 14_226_221,
        advances: 380,
    },
];

function sample(overrides: Partial<TickSample>): TickSample {
    return {
        interArrivalMs: 10,
        deliveryLatenessMs: 0,
        workerWakeLatenessMs: 0,
        sequenceJump: 1,
        currentTimeDeltaSec: 0,
        ...overrides,
    };
}

function baseInput(runs: readonly TickRunInput[]): BuildTransportClockRecordInput {
    return {
        measuredAt: '2026-09-04T00:00:00.000Z',
        machine: {
            checkoutGitSha: 'deadbeef',
            workingTree: 'clean',
            host: { platform: 'darwin', release: '25.6.0', arch: 'arm64', cores: 12 },
            loadAverage1m: 0.5,
        },
        browser: 'Chrome/152.0.7977.82',
        grainMs: 10,
        lookAheadMs: 100,
        placementBudgetMs: 0.02,
        granularity,
        runs,
    };
}

describe('percentiles', () => {
    // Fails if the ceil-minus-one index or the mean/samples/min/max
    // bookkeeping drifts: 1..100 pins p50/p95/p99 to their textbook values.
    it('computes exact percentiles over 1..100', () => {
        const values = Array.from({ length: 100 }, (_, index) => index + 1);

        expect(percentiles(values)).toEqual({
            samples: 100,
            p50: 50,
            p95: 95,
            p99: 99,
            max: 100,
            min: 1,
            mean: 50.5,
        });
    });

    // Fails if the input is read as already sorted (it is sorted internally,
    // but a regression that dropped the sort would read [2, 1] literally and
    // report p50 2 / p95 1 instead).
    it('sorts before selecting percentiles', () => {
        const result = percentiles([2, 1]);

        expect(result.p50).toBe(1);
        expect(result.p95).toBe(2);
    });

    // Fails if the empty-input guard is removed or narrowed: an unguarded
    // reduce over an empty array divides by zero and produces a NaN mean.
    it('returns the all-zero literal for no samples', () => {
        expect(percentiles([])).toEqual({
            samples: 0,
            p50: 0,
            p95: 0,
            p99: 0,
            max: 0,
            min: 0,
            mean: 0,
        });
    });
});

describe('recordPathFromArgv', () => {
    // Fails if the value-flag parse regresses to a plain indexOf/boolean read.
    it('returns the argument that follows --record', () => {
        expect(recordPathFromArgv(['--record', 'out.json'])).toBe('out.json');
    });

    // Fails if the function reports a flag as present when it was never given.
    it('returns undefined when --record is absent', () => {
        expect(recordPathFromArgv([])).toBeUndefined();
    });

    // Fails if a trailing --record with nothing after it is read as "no flag"
    // instead of a malformed invocation.
    it('throws when --record is the last argument', () => {
        expect(() => recordPathFromArgv(['--record'])).toThrow('--record needs a file path');
    });

    // Fails if the next argument is accepted as a path even when it is
    // actually the next flag (e.g. `--record --headed` silently writing to a
    // file named "--headed").
    it('throws when the following argument is itself a flag', () => {
        expect(() => recordPathFromArgv(['--record', '--headed'])).toThrow('--record needs a file path');
    });
});

describe('buildTransportClockRecord', () => {
    // Fails if any of the five per-run summaries reads a different sample
    // field than its name claims — each field carries a distinct constant
    // value, so a swap (e.g. deliveryLatenessMs reading workerWakeLatenessMs)
    // moves that summary's p50 away from its expected constant.
    it('computes each summary from its own named sample field, never a neighbour', () => {
        const run: TickRunInput = {
            condition: 'idle',
            loadDescription: 'no main-thread work beyond the probe itself',
            sampleRate: 48_000,
            baseLatencySec: 0.005333333333333333,
            outputLatencySec: 0.016,
            samples: [
                sample({ interArrivalMs: 10, deliveryLatenessMs: 20, workerWakeLatenessMs: 30 }),
                sample({ interArrivalMs: 10, deliveryLatenessMs: 20, workerWakeLatenessMs: 30 }),
                sample({ interArrivalMs: 10, deliveryLatenessMs: 20, workerWakeLatenessMs: 30 }),
            ],
        };

        const record = buildTransportClockRecord(baseInput([run]));
        const [summary] = record.runs;

        expect(summary?.interArrivalMs.p50).toBe(10);
        expect(summary?.deliveryLatenessMs.p50).toBe(20);
        expect(summary?.workerWakeLatenessMs.p50).toBe(30);
    });

    // Fails if rawDeltaMs/discardedMs are computed from every sample instead
    // of only the ones whose currentTimeDeltaSec exceeded lookAheadMs (the
    // `reportClamp` `overBudget` filter) — an unfiltered read would pull the
    // in-budget zero-delta samples into the percentile and pollute p50/mean.
    // Also includes a sample exactly at the budget boundary (100 ms) and
    // asserts it stays excluded — catches the filter's `>` becoming `>=`.
    it('restricts rawDeltaMs and discardedMs to ticks over the look-ahead budget, like reportClamp', () => {
        const run: TickRunInput = {
            condition: 'stall',
            loadDescription: '500 ms block every 1200 ms',
            sampleRate: 48_000,
            baseLatencySec: 0.005333333333333333,
            outputLatencySec: 0.016,
            samples: [
                sample({ currentTimeDeltaSec: 0.01 }), // in budget (100 ms lookAheadMs) — must not enter the clamp percentiles
                sample({ currentTimeDeltaSec: 0.01 }),
                sample({ currentTimeDeltaSec: 0.1 }), // exactly at the budget boundary — must stay excluded
                sample({ currentTimeDeltaSec: 0.506 }), // over budget by 406 ms
            ],
        };

        const record = buildTransportClockRecord(baseInput([run]));
        const [summary] = record.runs;

        expect(summary?.rawDeltaMs.samples).toBe(1);
        expect(summary?.rawDeltaMs.p50).toBeCloseTo(506, 6);
        expect(summary?.discardedMs.samples).toBe(1);
        expect(summary?.discardedMs.p50).toBeCloseTo(406, 6);
        expect(summary?.totalLostSec).toBeCloseTo(0.406, 6);
        expect(summary?.beatsAt120Bpm).toBeCloseTo(0.812, 6);
    });

    // Fails if a run with no over-budget tick (idle/ui-load in the real
    // driver) is summarized with a non-zero shortfall or a non-empty clamp
    // percentile, which would misreport a run the stall never reached. The
    // exact-literal equality also catches the empty-input guard being
    // dropped from `percentiles`, which would surface here as a NaN mean.
    it('reports an all-zero clamp summary when no tick exceeded the look-ahead budget', () => {
        const run: TickRunInput = {
            condition: 'idle',
            loadDescription: 'no main-thread work beyond the probe itself',
            sampleRate: 48_000,
            baseLatencySec: 0.005333333333333333,
            outputLatencySec: 0.016,
            samples: [sample({ currentTimeDeltaSec: 0.005 }), sample({ currentTimeDeltaSec: 0.01 })],
        };

        const record = buildTransportClockRecord(baseInput([run]));
        const [summary] = record.runs;
        const zero = { samples: 0, p50: 0, p95: 0, p99: 0, max: 0, min: 0, mean: 0 };

        expect(summary?.rawDeltaMs).toEqual(zero);
        expect(summary?.discardedMs).toEqual(zero);
        expect(summary?.totalLostSec).toBe(0);
        expect(summary?.beatsAt120Bpm).toBe(0);
    });

    // Fails if sampleCount is read from a summary's own `.samples` (for
    // example `rawDeltaMs.samples`) instead of the run's actual sample
    // count: this run has zero over-budget ticks, so `rawDeltaMs.samples` is
    // 0 while the run itself carries 4 samples — the three unfiltered
    // summaries' `.samples` equal the run length by construction and would
    // not catch this particular swap. Also fails if `samples` leaks into the
    // written record instead of being reduced to summaries.
    it('records sampleCount as the run length and drops the raw samples array', () => {
        const run: TickRunInput = {
            condition: 'ui-load',
            loadDescription: '12 ms synchronous spin every animation frame',
            sampleRate: 48_000,
            baseLatencySec: 0.005333333333333333,
            outputLatencySec: 0.016,
            samples: [sample({}), sample({}), sample({}), sample({})],
        };

        const record = buildTransportClockRecord(baseInput([run]));
        const [summary] = record.runs;

        expect(summary?.sampleCount).toBe(4);
        expect(summary?.rawDeltaMs.samples).toBe(0);
        expect(summary).not.toHaveProperty('samples');
    });

    // Fails if the caller's provenance (machine, browser, grainMs,
    // lookAheadMs, placementBudgetMs) is dropped, recomputed, or defaulted
    // instead of carried through verbatim — this is what makes the builder
    // pure: it must never call `machineProvenance()` or `browser.version()`
    // itself, and must never restate the driver's own constants.
    it('carries the supplied provenance and constants through verbatim', () => {
        const input = baseInput([]);

        const record = buildTransportClockRecord(input);

        expect(record.machine).toEqual(input.machine);
        expect(record.browser).toBe(input.browser);
        expect(record.grainMs).toBe(10);
        expect(record.lookAheadMs).toBe(100);
        expect(record.placementBudgetMs).toBe(0.02);
        expect(record.schemaVersion).toBe(1);
        expect(record.measuredAt).toBe(input.measuredAt);
        expect(record.granularity).toBe(granularity);
    });
});
