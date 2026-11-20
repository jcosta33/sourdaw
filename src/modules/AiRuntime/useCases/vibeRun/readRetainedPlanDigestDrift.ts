import { type BriefReading } from '../../models/BriefReading';

import { PLAN_NO_LONGER_PLANNED } from './briefReadingRefusals';
import { type PrepareVibeRunInput, prepareVibeRunSchedule } from './prepareVibeRunSchedule';

/**
 * Why the live project no longer plans the reading as it was offered, or `null` when preparing it
 * again, before anything is measured, yields exactly the retained plan.
 */
export function readRetainedPlanDigestDrift(reading: BriefReading, preparation: PrepareVibeRunInput): string | null {
    const prepared = prepareVibeRunSchedule(preparation);
    if (prepared.status === 'none') {
        return `The project ${PLAN_NO_LONGER_PLANNED}: no authored recipe plans it on the project now.`;
    }
    if (prepared.status === 'unscheduled') {
        return `The project ${PLAN_NO_LONGER_PLANNED}: ${prepared.lines.join(' ')}`;
    }
    if (prepared.planDigest !== reading.plan.planDigest) {
        return `The project ${PLAN_NO_LONGER_PLANNED}, so the reading no longer applies.`;
    }
    return null;
}
