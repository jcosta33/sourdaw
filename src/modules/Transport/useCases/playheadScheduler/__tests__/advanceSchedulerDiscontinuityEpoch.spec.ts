import { describe, it, expect, beforeEach } from 'vitest';

import { advanceSchedulerDiscontinuityEpoch } from '../advanceSchedulerDiscontinuityEpoch';
import { schedulerSession } from '../schedulerSession';

describe('advanceSchedulerDiscontinuityEpoch', () => {
    beforeEach(() => {
        schedulerSession.discontinuityEpoch = 0;
    });

    it('increments the epoch by one on each call', () => {
        expect(advanceSchedulerDiscontinuityEpoch()).toBe(1);
        expect(advanceSchedulerDiscontinuityEpoch()).toBe(2);
        expect(advanceSchedulerDiscontinuityEpoch()).toBe(3);
        expect(schedulerSession.discontinuityEpoch).toBe(3);
    });

    it('wraps back to 1 when the epoch reaches Number.MAX_SAFE_INTEGER', () => {
        schedulerSession.discontinuityEpoch = Number.MAX_SAFE_INTEGER;

        const result = advanceSchedulerDiscontinuityEpoch();

        expect(result).toBe(1);
        expect(schedulerSession.discontinuityEpoch).toBe(1);
    });

    it('wraps back to 1 when the epoch is not a safe integer (corrupted state)', () => {
        schedulerSession.discontinuityEpoch = Number.NaN;

        const result = advanceSchedulerDiscontinuityEpoch();

        expect(result).toBe(1);
        expect(schedulerSession.discontinuityEpoch).toBe(1);
    });

    it('wraps back to 1 when the epoch exceeds Number.MAX_SAFE_INTEGER', () => {
        schedulerSession.discontinuityEpoch = Number.MAX_SAFE_INTEGER + 1024;

        const result = advanceSchedulerDiscontinuityEpoch();

        expect(result).toBe(1);
    });
});
