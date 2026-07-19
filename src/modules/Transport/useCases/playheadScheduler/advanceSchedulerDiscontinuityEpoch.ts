import { schedulerSession } from './schedulerSession';

export function advanceSchedulerDiscontinuityEpoch(): number {
    schedulerSession.discontinuityEpoch =
        Number.isSafeInteger(schedulerSession.discontinuityEpoch) &&
        schedulerSession.discontinuityEpoch < Number.MAX_SAFE_INTEGER
            ? schedulerSession.discontinuityEpoch + 1
            : 1;
    return schedulerSession.discontinuityEpoch;
}
