import { describe, expect, it } from 'vitest';

import {
    buildTransportClockRecord,
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
        placementBudgetMs: 1 / 48,
        granularity,
        runs,
    };
}

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
    // percentile, which would misreport a run the stall never reached.
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

        expect(summary?.rawDeltaMs.samples).toBe(0);
        expect(summary?.discardedMs.samples).toBe(0);
        expect(summary?.totalLostSec).toBe(0);
        expect(summary?.beatsAt120Bpm).toBe(0);
    });

    // Fails if sampleCount is a stand-in for the array length elsewhere (e.g.
    // hardcoded, or read from a percentile's own `.samples`) rather than the
    // run's actual sample count, and fails if `samples` leaks into the
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
        expect(summary).not.toHaveProperty('samples');
    });

    // Fails if the caller's provenance (machine, browser) is dropped,
    // recomputed, or defaulted instead of carried through verbatim — this is
    // what makes the builder pure: it must never call `machineProvenance()`
    // or `browser.version()` itself.
    it('carries the supplied machine and browser provenance through verbatim', () => {
        const input = baseInput([]);

        const record = buildTransportClockRecord(input);

        expect(record.machine).toEqual(input.machine);
        expect(record.browser).toBe(input.browser);
        expect(record.schemaVersion).toBe(1);
        expect(record.measuredAt).toBe(input.measuredAt);
        expect(record.granularity).toBe(granularity);
    });
});
