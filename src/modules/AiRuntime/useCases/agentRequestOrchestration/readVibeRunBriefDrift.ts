import { type AgentRunVibeRunBatchSchedule } from '../../models/AgentRun';

/**
 * Why a vibe run's later batch may no longer be grounded from its plan: the plan read the brief at
 * one revision, and any brief edit since, an undo of the brief included, may have changed the roles,
 * locks or goals the plan was built from. `null` while the live brief is still that revision.
 */
export function readVibeRunBriefDrift(
    schedule: Pick<AgentRunVibeRunBatchSchedule, 'briefRevision'>,
    live: number | null
): string | null {
    if (live === schedule.briefRevision) {
        return null;
    }
    return `production brief changed since this run was planned (rev ${String(schedule.briefRevision)} → ${live === null ? 'none' : String(live)})`;
}
