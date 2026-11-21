import { type AgentRunVibeRunBatchSchedule } from '../../models/AgentRun';
import { readScheduledVibeRunPlan } from '../../validators/readScheduledVibeRunPlan';

/** The batches after the brief, which holds position 1 of its run. */
const FIRST_BATCH_POSITION = 2;

/** The planned batch at `position`, read back from the schedule's own plan, or `null` when it no longer reads. */
export function readStoredVibeRunBatch(schedule: AgentRunVibeRunBatchSchedule, position: number) {
    const plan = readScheduledVibeRunPlan(schedule.serializedPlan);
    const batch = plan?.batches[position - FIRST_BATCH_POSITION];
    if (plan === null || batch === undefined || plan.briefRevision !== schedule.briefRevision) {
        return null;
    }
    return { plan, batch };
}
