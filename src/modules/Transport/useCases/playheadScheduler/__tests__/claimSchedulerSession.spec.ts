import { beforeEach, describe, expect, it } from 'vitest';

import { playheadWrapCountRef } from '../../../stores/playheadWrapCountRef';
import { claimSchedulerSession } from '../claimSchedulerSession';
import { schedulerSession } from '../schedulerSession';

describe('claimSchedulerSession', () => {
    beforeEach(() => {
        playheadWrapCountRef.current = 0;
    });

    it('drops the retired roll wrap count beside the generation bump', () => {
        // A pause left a session ticking and its roll wrapped three times; the
        // claiming play writes a fresh epoch beside this handover, so the count
        // must not survive it — a capture in the scheduler-start hold would
        // otherwise bound old events by the retired roll's wraps.
        playheadWrapCountRef.current = 3;
        const generation = schedulerSession.generation;

        const claimed = claimSchedulerSession();

        expect(claimed).toBe(generation + 1);
        expect(playheadWrapCountRef.current).toBe(0);
    });
});
