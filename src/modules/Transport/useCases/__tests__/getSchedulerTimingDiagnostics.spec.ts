import { beforeEach, describe, expect, it } from 'vitest';

import { getSchedulerTimingDiagnostics } from '../getSchedulerTimingDiagnostics';
import { schedulerTimingDiagnostics } from '../playheadScheduler/schedulerTimingDiagnostics';

describe('getSchedulerTimingDiagnostics', () => {
    beforeEach(() => {
        schedulerTimingDiagnostics.reset(25);
    });

    it('returns the latest scheduler-run timing snapshot', () => {
        schedulerTimingDiagnostics.recordTickMessage({
            sequence: 1,
            scheduledAtMs: 1_000,
            sentAtMs: 1_003,
            receivedAtMs: 1_005,
        });
        schedulerTimingDiagnostics.recordTickSettled(7);

        const snapshot = getSchedulerTimingDiagnostics();

        expect(snapshot.intervalMs).toBe(25);
        expect(snapshot.messagesReceived).toBe(1);
        expect(snapshot.ticksSettled).toBe(1);
        expect(snapshot.mainDeliveryLatenessMs.last).toBe(5);
        expect(snapshot.tickExecutionMs.last).toBe(7);
    });
});
