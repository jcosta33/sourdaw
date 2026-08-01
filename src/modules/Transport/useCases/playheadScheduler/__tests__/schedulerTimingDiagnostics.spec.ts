import { beforeEach, describe, expect, it } from 'vitest';

import { schedulerTimingDiagnostics } from '../schedulerTimingDiagnostics';

describe('schedulerTimingDiagnostics', () => {
    beforeEach(() => {
        schedulerTimingDiagnostics.reset(10);
    });

    it('records worker wake, main delivery, message transit, and async tick execution timing', () => {
        schedulerTimingDiagnostics.recordTickMessage(1, 1_000, 1_003, 1_007);
        schedulerTimingDiagnostics.recordTickSettled(12);

        expect(schedulerTimingDiagnostics.snapshot()).toEqual({
            intervalMs: 10,
            messagesReceived: 1,
            lastSequence: 1,
            sequenceGaps: 0,
            outOfOrderMessages: 0,
            ticksSettled: 1,
            ticksSkippedInFlight: 0,
            deliveryDeadlineMisses: 0,
            workerWakeLatenessMs: { samples: 1, total: 3, last: 3, max: 3, average: 3 },
            mainDeliveryLatenessMs: { samples: 1, total: 7, last: 7, max: 7, average: 7 },
            messageTransitMs: { samples: 1, total: 4, last: 4, max: 4, average: 4 },
            tickExecutionMs: { samples: 1, total: 12, last: 12, max: 12, average: 12 },
        });
    });

    it('counts missed delivery deadlines and in-flight skips without losing cumulative timing', () => {
        schedulerTimingDiagnostics.recordTickMessage(2, 2_000, 2_020, 2_025);
        schedulerTimingDiagnostics.recordTickMessage(4, 2_010, 2_012, 2_014);
        schedulerTimingDiagnostics.recordTickSkipped();

        const snapshot = schedulerTimingDiagnostics.snapshot();
        expect(snapshot.messagesReceived).toBe(2);
        expect(snapshot.lastSequence).toBe(4);
        expect(snapshot.sequenceGaps).toBe(2);
        expect(snapshot.deliveryDeadlineMisses).toBe(1);
        expect(snapshot.ticksSkippedInFlight).toBe(1);
        expect(snapshot.mainDeliveryLatenessMs).toEqual({
            samples: 2,
            total: 29,
            last: 4,
            max: 25,
            average: 14.5,
        });
    });

    it('clamps clock-domain noise below zero and resets every run-owned counter', () => {
        schedulerTimingDiagnostics.recordTickMessage(1, 3_000, 2_999, 2_998);
        schedulerTimingDiagnostics.recordTickSettled(-1);
        schedulerTimingDiagnostics.recordTickSkipped();

        expect(schedulerTimingDiagnostics.snapshot().workerWakeLatenessMs.last).toBe(0);
        expect(schedulerTimingDiagnostics.snapshot().tickExecutionMs.last).toBe(0);

        schedulerTimingDiagnostics.reset(25);

        expect(schedulerTimingDiagnostics.snapshot()).toEqual({
            intervalMs: 25,
            messagesReceived: 0,
            lastSequence: 0,
            sequenceGaps: 0,
            outOfOrderMessages: 0,
            ticksSettled: 0,
            ticksSkippedInFlight: 0,
            deliveryDeadlineMisses: 0,
            workerWakeLatenessMs: { samples: 0, total: 0, last: 0, max: 0, average: 0 },
            mainDeliveryLatenessMs: { samples: 0, total: 0, last: 0, max: 0, average: 0 },
            messageTransitMs: { samples: 0, total: 0, last: 0, max: 0, average: 0 },
            tickExecutionMs: { samples: 0, total: 0, last: 0, max: 0, average: 0 },
        });
    });
});
