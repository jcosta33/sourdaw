import { schedulerSession } from './schedulerSession';

export function advanceSchedulerDiscontinuityEpoch(): number {
    if (
        !Number.isSafeInteger(schedulerSession.discontinuityEpoch) ||
        schedulerSession.discontinuityEpoch >= Number.MAX_SAFE_INTEGER
    ) {
        schedulerSession.discontinuityEpoch = 1;
        return schedulerSession.discontinuityEpoch;
    }

    schedulerSession.discontinuityEpoch += 1;
    return schedulerSession.discontinuityEpoch;
}
